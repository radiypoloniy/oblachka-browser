// Загрузчик GGUF-моделей — потоковое скачивание файла на 5+ ГБ с прогрессом, отменой и атомарной
// публикацией. Скелет по образцу HistoryContentBackfill.ts (module-level running/cancelRequested/
// onProgress-колбэк) — не изобретаем новый.
//
// Уборка осиротевших .part-файлов — cleanupOrphanedParts(), зовётся из main.ts синхронно при
// старте (ДО того, как пользователь может запустить новую загрузку) — см. её же комментарий.
//
// ⚠️ net.fetch (модуль Electron), НЕ глобальный fetch() — тот не уважает session.setProxy(),
// см. AdBlockManager.ts:268-272 (тот же живой аудит утечек VPN). Скачивание с HuggingFace обязано
// идти через тот же туннель, что и остальной трафик, когда VPN включён.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { net } from 'electron'
import * as ModelRegistry from './ModelRegistry'
import { ensureDir, getFreeSpaceBytes } from './FsUtils'
import type { DownloadProgress, ModelDownloadSpec } from '../shared/ipc'

// ~4 раза в секунду — троттлинг пуша прогресса в UI (не на каждый чанк: на 5+ ГБ чанков могут
// быть десятки тысяч, IPC-шторм). Внутренний счётчик receivedBytes обновляется на каждом чанке
// всегда, троттлится только СООБЩЕНИЕ наружу.
const PROGRESS_THROTTLE_MS = 250

// Запас сверх ожидаемого размера файла при проверке места — не точный расчёт, страховка от
// разночтений (резервируемые ФС блоки, округление кластеров и т.п.).
const FREE_SPACE_MARGIN_BYTES = 1024 ** 3 // 1 ГБ

// Порог "недокачка ещё годна для докачки" в cleanupOrphanedParts() — если пользователь начал
// докачку и забыл о ней на неделю, гигабайты недокачанного не должны занимать место на диске
// вечно "на всякий случай". Старше срока — убираем как обычный осиротевший .part.
const RESUMABLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

let running = false
let cancelRequested = false
let progress: DownloadProgress = {
  modelId: null,
  receivedBytes: 0,
  totalBytes: null,
  running: false,
  cancelled: false,
  error: null,
}
let onProgress: ((p: DownloadProgress) => void) | null = null
let lastProgressPushAt = 0

export function setProgressListener(cb: ((p: DownloadProgress) => void) | null): void {
  onProgress = cb
}

export function getProgress(): DownloadProgress {
  return progress
}

export function cancelDownload(): void {
  cancelRequested = true
}

// Безусловный пуш — на смену состояния (старт/финал/ошибка), не троттлится: таких событий мало.
function report(patch: Partial<DownloadProgress>): void {
  progress = { ...progress, ...patch }
  onProgress?.(progress)
}

// Троттлится: зовётся на КАЖДОМ чанке, но наружу уходит не чаще PROGRESS_THROTTLE_MS.
function reportProgressThrottled(receivedBytes: number): void {
  progress = { ...progress, receivedBytes }
  const now = Date.now()
  if (now - lastProgressPushAt < PROGRESS_THROTTLE_MS) return
  lastProgressPushAt = now
  onProgress?.(progress)
}

function closeWriteStream(ws: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.end((err: Error | null | undefined) => (err ? reject(err) : resolve()))
  })
}

function removePartFile(partPath: string): void {
  try {
    fs.rmSync(partPath, { force: true })
  } catch (e) {
    console.warn(`[model-download] не удалось удалить .part-файл ${partPath}:`, (e as Error).message)
  }
}

// Sidecar-метаданные рядом с .part — снимок того, ЧТО именно докачивается, снятый ДО начала
// потоковой записи тела: url/fileName — на случай если сам .part потеряет расширение/переименуется
// (не должно, но не полагаемся), totalBytes/etag — то, с чем сверяем сервер при докачке
// (см. startDownload), startedAt — для RESUMABLE_MAX_AGE_MS в cleanupOrphanedParts().
// expectedSha256 — сохраняется здесь же (не берётся заново из каталога при возобновлении после
// перезапуска браузера: к тому моменту вызывающая сторона может передать другой spec, а сверять
// докачку нужно с тем же эталоном, с которым начинали, см. её же комментарий у startDownload).
interface PartSidecar {
  url: string
  fileName: string
  totalBytes: number
  etag: string
  startedAt: number
  expectedSha256: string | null
}

function sidecarPathFor(partPath: string): string {
  return `${partPath}.json`
}

// Атомарно — tmp+rename, тот же приём, что ModelRegistry.ts/SettingsManager.ts. Вызывается ДО
// начала чтения тела ответа (см. startDownload) — если процесс убьют секунду спустя, sidecar уже
// на диске и описывает ровно тот .part, который начнёт расти следом.
function writeSidecar(partPath: string, sidecar: PartSidecar): void {
  const target = sidecarPathFor(partPath)
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(sidecar, null, 2), 'utf8')
  fs.renameSync(tmp, target)
}

// null — файла нет, битый JSON, или не хватает обязательных полей: ВСЕ эти случаи вызывающая
// сторона обязана трактовать одинаково — "доверять нечему, докачка невозможна", а не пытаться
// докачивать по частично прочитанным данным.
function readSidecar(partPath: string): PartSidecar | null {
  try {
    const raw = fs.readFileSync(sidecarPathFor(partPath), 'utf8')
    const data = JSON.parse(raw) as unknown
    if (typeof data !== 'object' || data === null) return null
    const d = data as Record<string, unknown>
    const validExpectedSha256 = d.expectedSha256 === null ||
      (typeof d.expectedSha256 === 'string' && d.expectedSha256.length > 0)
    if (
      typeof d.url === 'string' && d.url.length > 0 &&
      typeof d.fileName === 'string' && d.fileName.length > 0 &&
      typeof d.totalBytes === 'number' && Number.isFinite(d.totalBytes) &&
      typeof d.etag === 'string' && d.etag.length > 0 &&
      typeof d.startedAt === 'number' && Number.isFinite(d.startedAt) &&
      validExpectedSha256
    ) {
      return {
        url: d.url, fileName: d.fileName, totalBytes: d.totalBytes, etag: d.etag, startedAt: d.startedAt,
        expectedSha256: (d.expectedSha256 as string | null | undefined) ?? null,
      }
    }
    return null
  } catch {
    return null
  }
}

// Пара .part+.part.json удаляется вместе везде, где недокачка признаётся негодной (отмена
// пользователем, провал докачки при старте, несовпадение размера после завершения) — оставлять
// один файл без другого бессмысленно: голый .part без sidecar cleanupOrphanedParts() всё равно
// сочтёт неподлежащим докачке, а голый sidecar без .part описывает то, чего уже нет на диске.
function removePartAndSidecar(partPath: string): void {
  removePartFile(partPath)
  try {
    fs.rmSync(sidecarPathFor(partPath), { force: true })
  } catch (e) {
    console.warn(`[model-download] не удалось удалить sidecar ${sidecarPathFor(partPath)}:`, (e as Error).message)
  }
}

// Скармливает хэшеру уже скачанные байты .part ПОТОКОМ (не читает файл целиком в память) —
// нужно ТОЛЬКО при возобновлении: SHA256 всегда эталон для ПОЛНОГО файла, а без этого шага хэш
// посчитался бы только по новым байтам этой сессии и никогда бы не сошёлся. Await'ится ДО начала
// чтения новых чанков из сети — порядок update() должен быть строго "старые байты, потом новые".
function seedHashFromExistingPart(partPath: string, hasher: crypto.Hash): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(partPath)
    stream.on('data', (chunk) => hasher.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
}

export async function startDownload(spec: ModelDownloadSpec): Promise<void> {
  if (running) {
    console.log('[model-download] загрузка уже идёт — повторный start() игнорируется')
    return
  }

  const modelId = ModelRegistry.slugify(spec.fileName)

  // Предварительная проверка ДО сетевого запроса — главный смысл этого коммита: не тратить
  // гигабайты трафика на файл, который заведомо не попадёт в реестр (финальный add() ниже всё
  // равно откажет по той же причине). running module-level флаг не трогаем — реальная загрузка
  // не стартовала.
  const alreadyInstalled = ModelRegistry.getById(modelId)
  if (alreadyInstalled) {
    console.log(`[model-download] "${modelId}" уже в реестре — отказ до сетевого запроса`)
    progress = { modelId, receivedBytes: 0, totalBytes: null, running: false, cancelled: false, error: 'Эта модель уже установлена' }
    onProgress?.(progress)
    return
  }

  running = true
  cancelRequested = false
  lastProgressPushAt = 0
  progress = { modelId, receivedBytes: 0, totalBytes: null, running: true, cancelled: false, error: null }
  report({})

  const dir = ModelRegistry.userGgufDir()
  const partPath = path.join(dir, `${spec.fileName}.part`)
  const finalPath = path.join(dir, spec.fileName)

  try {
    // 1. Каталог может не существовать (первое скачивание вообще).
    ensureDir(dir)

    // 2-3. Докачка: валидная пара .part+.part.json — сигнал, что здесь уже есть кусок ЭТОГО же
    // файла (см. startDownload ниже — sidecar пишется ДО начала чтения тела, поэтому её наличие
    // гарантирует, что .part описан, а не просто мусор от чего-то ещё). Несогласованная пара
    // (только один из двух файлов) или битый sidecar — доверять нечему, чистим и качаем с нуля.
    let resumeFromBytes = 0
    let sidecar: PartSidecar | null = null
    const partExists = fs.existsSync(partPath)
    const sidecarExists = fs.existsSync(sidecarPathFor(partPath))
    if (partExists && sidecarExists) {
      sidecar = readSidecar(partPath)
      if (sidecar === null) {
        console.log(`[model-download] "${spec.fileName}": sidecar повреждён — удаляю .part, качаю с нуля`)
        removePartAndSidecar(partPath)
      }
    } else if (partExists || sidecarExists) {
      console.log(`[model-download] "${spec.fileName}": .part и sidecar не парные — удаляю, качаю с нуля`)
      removePartAndSidecar(partPath)
    }

    // Один запрос: смотрим заголовки (Content-Length/ETag) ДО того, как начать читать тело — тело
    // ещё не тронуто, поэтому при отказе (не хватает места, докачка не подтвердилась) можно
    // спокойно освободить соединение, не потратив ни байта на диск. redirect:'follow' —
    // HuggingFace редиректит resolve-ссылку на реальный CDN (см. разведку — Xet, отдаёт 206
    // на Range уже ПОСЛЕ редиректа, net.fetch с redirect:'follow' отдаёт заголовки именно
    // конечного ответа).
    let res: Awaited<ReturnType<typeof net.fetch>>
    let totalBytes: number | null = null
    let needSidecarWrite = false
    // Эталон для проверки — сначала из spec (обычный путь). При подтверждённой докачке НИЖЕ
    // подменяется на сохранённый в sidecar: тот же принцип, что и totalBytes = sidecar.totalBytes —
    // сверяем с тем, с чем начинали ЭТУ загрузку, а не с тем, что вызывающая сторона передала
    // заново (после перезапуска браузера это может быть другой вызов с тем же spec, но не факт).
    let expectedSha256: string | null = spec.expectedSha256 ?? null

    if (sidecar !== null) {
      resumeFromBytes = fs.statSync(partPath).size
      const resumeRes = await net.fetch(spec.url, { redirect: 'follow', headers: { Range: `bytes=${resumeFromBytes}-` } })
      const resumeEtag = resumeRes.headers.get('etag')
      if (resumeRes.status === 206 && resumeEtag !== null && resumeEtag === sidecar.etag) {
        console.log(`[model-download] "${spec.fileName}": докачка с ${resumeFromBytes} байт (код 206, ETag совпал)`)
        res = resumeRes
        totalBytes = sidecar.totalBytes
        expectedSha256 = sidecar.expectedSha256
      } else {
        // ⚠️ Молча продолжать дописывать НЕЛЬЗЯ — совпадение размера у склейки байт от другой
        // ревизии файла и правда возможно, но сами байты будут чужими: получим файл правильной
        // длины и битый GGUF. Код не 206, ETag пуст или разошёлся — не тот файл (или сервер вообще
        // не поддержал Range на этот раз) — единственный безопасный выход - с нуля.
        console.log(
          `[model-download] "${spec.fileName}": сервер не подтвердил докачку (код ${resumeRes.status}, ` +
          `ETag "${resumeEtag ?? '(нет)'}" против сохранённого "${sidecar.etag}") — удаляю .part, качаю с нуля`,
        )
        await resumeRes.body?.cancel().catch(() => {})
        removePartAndSidecar(partPath)
        resumeFromBytes = 0
        res = await net.fetch(spec.url, { redirect: 'follow' })
        needSidecarWrite = true
        expectedSha256 = spec.expectedSha256 ?? null
      }
    } else {
      res = await net.fetch(spec.url, { redirect: 'follow' })
      needSidecarWrite = true
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} — ${spec.url}`)
    }

    if (needSidecarWrite) {
      const contentLengthHeader = res.headers.get('content-length')
      totalBytes = contentLengthHeader !== null && /^\d+$/.test(contentLengthHeader) ? Number(contentLengthHeader) : null
      // Sidecar пишем ТОЛЬКО если знаем оба значения, нужные для будущей докачки — без ETag
      // сверить чужую докачку не с чем (на практике у HF/Xet ETag стабилен, см. разведку, но
      // сохраняем защиту на случай другого источника без ETag: тогда просто нет докачки для
      // этого файла, не крах). Пишем ДО начала чтения тела — атомарно (tmp+rename).
      const etag = res.headers.get('etag')
      if (totalBytes !== null && etag !== null) {
        writeSidecar(partPath, { url: spec.url, fileName: spec.fileName, totalBytes, etag, startedAt: Date.now(), expectedSha256 })
      }
    }

    report({ totalBytes })

    if (totalBytes !== null) {
      const free = getFreeSpaceBytes(dir)
      // При докачке резервировать нужно только ОСТАВШЕЕСЯ — resumeFromBytes уже физически на диске.
      const stillNeededBytes = totalBytes - resumeFromBytes
      if (free === null) {
        // null — «проверить не удалось», не «места нет»: продолжаем, только предупреждаем в лог.
        console.warn(`[model-download] не удалось определить свободное место на диске для ${dir} — проверка пропущена`)
      } else if (free < stillNeededBytes + FREE_SPACE_MARGIN_BYTES) {
        // Тело ответа ещё не читали — просто отпускаем соединение, ничего нового на диск не попало.
        await res.body?.cancel().catch(() => {})
        const gb = (n: number) => (n / 1024 ** 3).toFixed(2)
        throw new Error(
          `Недостаточно места на диске: нужно ~${gb(stillNeededBytes + FREE_SPACE_MARGIN_BYTES)} ГБ ` +
          `(осталось скачать ${gb(stillNeededBytes)} ГБ + запас ${gb(FREE_SPACE_MARGIN_BYTES)} ГБ), свободно ${gb(free)} ГБ`,
        )
      }
    }

    if (!res.body) {
      throw new Error('Сервер не вернул тело ответа')
    }

    // Хэш считается ПОТОКОВО во время скачивания (update на каждом чанке ниже) — отдельного
    // прохода по файлу после публикации нет, это было бы лишним чтением гигабайтов. hasher===null,
    // если эталона нет вовсе — тогда просто не считаем (незачем тратить CPU на хэш, который
    // не с чем сравнивать), проверка ниже сама пропустится по этому же признаку.
    if (expectedSha256 === null) {
      console.warn(`[model-download] "${spec.fileName}": нет эталонного SHA256 — проверка целостности пропущена`)
    }
    const hasher = expectedSha256 !== null ? crypto.createHash('sha256') : null

    // ⚠️ При докачке — обязательно скормить хэшеру уже лежащие на диске байты ДО первого нового
    // чанка из сети, иначе хэш посчитается только по хвосту и никогда не сойдётся с эталоном
    // (тот всегда для ПОЛНОГО файла). Отдельная строка в лог — чтение с диска не мгновенно
    // (гигабайты), пользователь должен понимать, откуда пауза перед стартом сети.
    if (hasher !== null && resumeFromBytes > 0) {
      console.log(`[model-download] "${spec.fileName}": пересчитываю хэш уже скачанных ${resumeFromBytes} байт перед докачкой...`)
      await seedHashFromExistingPart(partPath, hasher)
    }

    // 4-6. Потоковая запись — fs.createWriteStream, НЕ накопление в памяти (flags:'a' — дозапись
    // при докачке, обычный режим при первом скачивании). Проверка отмены на каждой итерации
    // чтения (= на каждом чанке). receivedBytes стартует не с нуля — прогресс учитывает то, что
    // уже физически на диске (resumeFromBytes), а не только байты этой сессии.
    const writeStream = fs.createWriteStream(partPath, resumeFromBytes > 0 ? { flags: 'a' } : undefined)
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    let receivedBytes = resumeFromBytes
    let wasCancelled = false

    for (;;) {
      if (cancelRequested) {
        wasCancelled = true
        await reader.cancel().catch(() => {})
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      writeStream.write(value)
      hasher?.update(value)
      reportProgressThrottled(receivedBytes)
    }

    await closeWriteStream(writeStream)

    if (wasCancelled) {
      // Осознанный отказ пользователя, а не обрыв — .part И sidecar удаляются вместе, докачивать
      // отменённое не нужно.
      removePartAndSidecar(partPath)
      report({ running: false, cancelled: true })
      return
    }

    // 7. Целостность — сверяем фактический размер .part с ожидаемым Content-Length, если он был.
    // ⚠️ Content-Length может отражать РАЗМЕР НА ПРОВОДЕ (сжатый), а не итоговых декодированных
    // байт: живой пример на easylist.txt — content-length=758786 при content-encoding:gzip, но
    // фактически полученных (декомпрессированных net.fetch на лету) байт — 2146738. Для GGUF
    // (бинарные веса, HF отдаёт как есть, без сжатия по наблюдениям) это не ожидается, но при
    // ложном срабатывании этой проверки на реально целом файле — см. сюда.
    // ⚠️ При докачке эта проверка критичнее, чем при обычной загрузке: совпадение ETag ДО дозаписи
    // подтверждает, что сервер отдаёт ТУ ЖЕ ревизию файла, но финальный размер — последний барьер
    // перед публикацией под именем модели.
    const actualSize = fs.statSync(partPath).size
    if (progress.totalBytes !== null && actualSize !== progress.totalBytes) {
      removePartAndSidecar(partPath)
      throw new Error(`Размер файла не совпал: ожидалось ${progress.totalBytes} байт, получено ${actualSize} байт`)
    }

    // 7б. Хэш — СТРОГО до rename, чтобы битый файл никогда не появился под финальным именем
    // (то, под которым его увидит ModelRegistry.add() и, следом, node-llama-cpp). Регистронезависимо —
    // HF отдаёт lfs.oid в нижнем регистре, но не полагаемся на регистр строки, которую передал
    // вызывающий код каталога.
    if (hasher !== null && expectedSha256 !== null) {
      const digest = hasher.digest('hex')
      if (digest.toLowerCase() !== expectedSha256.toLowerCase()) {
        removePartAndSidecar(partPath)
        console.error(
          `[model-download] "${spec.fileName}": SHA256 не совпал (ожидался ${expectedSha256}, получен ${digest}) — файл удалён`,
        )
        throw new Error('Файл повреждён при загрузке')
      }
      console.log(`[model-download] "${spec.fileName}": SHA256 совпал (${digest}) — проверка целостности пройдена`)
    }

    // 8. Атомарная публикация — оба пути в одном каталоге (userGgufDir()), rename атомарен.
    fs.renameSync(partPath, finalPath)
    // Sidecar своё дело сделал — файл опубликован под конечным именем, докачивать больше нечего.
    try {
      fs.rmSync(sidecarPathFor(partPath), { force: true })
    } catch (e) {
      console.warn(`[model-download] не удалось удалить sidecar после публикации ${sidecarPathFor(partPath)}:`, (e as Error).message)
    }

    // 9. Точный размер — не доверяем Content-Length, статим уже переименованный файл.
    const sizeBytes = fs.statSync(finalPath).size
    const addResult = ModelRegistry.add({ id: modelId, label: spec.label, filePath: finalPath, sizeBytes, source: 'downloaded' })
    if (!addResult.ok) {
      // Не основной путь — защита от гонки: запись с тем же id появилась в реестре, пока шла
      // загрузка (предварительная проверка выше её не поймала, потому что в момент старта её
      // ещё не было). Файл уже скачан и переименован — раз он не нужен реестру, удаляем его,
      // а не оставляем 5+ ГБ мусора на диске.
      fs.rmSync(finalPath, { force: true })
      throw new Error(`Эта модель уже установлена (появилась в реестре во время загрузки)`)
    }

    // 10. Реестр был пуст — новая модель становится дефолтной. Иначе дефолт не трогаем.
    if (ModelRegistry.getDefault() === null) {
      ModelRegistry.setDefault(modelId)
    }

    report({ running: false, receivedBytes: actualSize })
  } catch (e) {
    // Общий отказ (сеть, нехватка места, HTTP-ошибка и т.п.) — убираем пару целиком, не только
    // .part: голый sidecar без .part бесполезен сам по себе (cleanupOrphanedParts() всё равно не
    // сочтёт его докачиваемым без .part). ⚠️ Жёсткое убийство процесса ЭТОТ catch не проходит
    // вовсе — вот тот путь, которым .part+sidecar реально переживают до докачки (см. cleanupOrphanedParts).
    removePartAndSidecar(partPath)
    report({ running: false, error: (e as Error).message ?? String(e) })
  } finally {
    running = false
  }
}

// Уборка осиротевших .part-файлов — краш/убийство процесса посреди скачивания оставляет
// частично записанный файл в userGgufDir() (см. startDownload — .part удаляется только на
// штатных путях: отмена/ошибка/успех, ни один из них не отрабатывает при грубом завершении
// процесса). Зовётся из main.ts СИНХРОННО при старте, ДО того, как пользователь вообще может
// нажать «скачать» — на этот момент активных загрузок в процессе быть не может (running всегда
// false сразу после старта модуля), поэтому снести .part реальной, только что начатой загрузки
// здесь невозможно.
// ⚠️ Раньше удаляла ВСЕ .part без разбора — прямо противоречит докачке (startDownload), которая
// как раз рассчитывает подхватить .part, переживший грубое убийство процесса. Теперь .part с
// валидным парным sidecar МОЛОЖЕ RESUMABLE_MAX_AGE_MS — оставляем для докачки; без sidecar,
// с битым sidecar, или старше срока — убираем как раньше (см. её же комментарий про срок выше).
export function cleanupOrphanedParts(): void {
  const dir = ModelRegistry.userGgufDir()
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return // каталога нет — нечего убирать, это норма (ни одной модели ещё не скачивали)
  }

  const partNames = new Set(entries.filter((name) => name.endsWith('.part')))
  const now = Date.now()

  let removedCount = 0
  let removedBytes = 0
  let keptCount = 0
  let keptBytes = 0

  for (const name of partNames) {
    const filePath = path.join(dir, name)
    let size: number
    try {
      size = fs.statSync(filePath).size
    } catch {
      continue // исчез между readdirSync и statSync — пропускаем, не роняем весь скан
    }

    const sidecar = readSidecar(filePath)
    const resumable = sidecar !== null && now - sidecar.startedAt < RESUMABLE_MAX_AGE_MS
    if (resumable) {
      keptCount++
      keptBytes += size
      continue
    }

    try {
      fs.unlinkSync(filePath)
      removedCount++
      removedBytes += size
    } catch (e) {
      // Файл может быть залочен (антивирус, ещё не закрытый хендл) — не повод прерывать уборку
      // остальных .part-файлов, просто пропускаем этот (sidecar для него тоже не трогаем — раз
      // .part не убрался, пусть пара останется согласованной до следующего запуска).
      console.warn(`[model-download] не удалось удалить осиротевший .part-файл ${filePath}:`, (e as Error).message)
      continue
    }
    try {
      fs.rmSync(sidecarPathFor(filePath), { force: true })
    } catch (e) {
      console.warn(`[model-download] не удалось удалить sidecar для ${filePath}:`, (e as Error).message)
    }
  }

  // Осиротевшие sidecar БЕЗ пары .part — сами по себе бесполезны (описывают то, чего уже нет
  // на диске), убираем отдельным проходом.
  for (const name of entries) {
    if (!name.endsWith('.part.json')) continue
    const partName = name.slice(0, -'.json'.length)
    if (partNames.has(partName)) continue // есть пара — уже обработан(а) в цикле выше
    try {
      fs.unlinkSync(path.join(dir, name))
    } catch (e) {
      console.warn(`[model-download] не удалось удалить осиротевший sidecar ${name}:`, (e as Error).message)
    }
  }

  if (removedCount > 0 || keptCount > 0) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(2)
    console.log(
      `[model-download] уборка при старте: удалено ${removedCount} осиротевших .part-файлов (~${gb(removedBytes)} ГБ), ` +
      `оставлено для докачки ${keptCount} (~${gb(keptBytes)} ГБ)`,
    )
  }
}
