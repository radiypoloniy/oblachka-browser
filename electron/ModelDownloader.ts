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

    // 2-3. Один GET-запрос: смотрим заголовки (Content-Length) ДО того, как начать читать тело —
    // тело ещё не тронуто, поэтому при отказе (не хватает места) можно спокойно освободить
    // соединение, не потратив ни байта на диск. redirect:'follow' — HuggingFace редиректит
    // resolve-ссылку на реальный CDN.
    const res = await net.fetch(spec.url, { redirect: 'follow' })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} — ${spec.url}`)
    }
    const contentLengthHeader = res.headers.get('content-length')
    const totalBytes = contentLengthHeader !== null && /^\d+$/.test(contentLengthHeader)
      ? Number(contentLengthHeader)
      : null
    report({ totalBytes })

    if (totalBytes !== null) {
      const free = getFreeSpaceBytes(dir)
      if (free === null) {
        // null — «проверить не удалось», не «места нет»: продолжаем, только предупреждаем в лог.
        console.warn(`[model-download] не удалось определить свободное место на диске для ${dir} — проверка пропущена`)
      } else if (free < totalBytes + FREE_SPACE_MARGIN_BYTES) {
        // Тело ответа ещё не читали — просто отпускаем соединение, ничего на диск не попало.
        await res.body?.cancel().catch(() => {})
        const gb = (n: number) => (n / 1024 ** 3).toFixed(2)
        throw new Error(
          `Недостаточно места на диске: нужно ~${gb(totalBytes + FREE_SPACE_MARGIN_BYTES)} ГБ ` +
          `(файл ${gb(totalBytes)} ГБ + запас ${gb(FREE_SPACE_MARGIN_BYTES)} ГБ), свободно ${gb(free)} ГБ`,
        )
      }
    }

    if (!res.body) {
      throw new Error('Сервер не вернул тело ответа')
    }

    // 4-6. Потоковая запись — fs.createWriteStream, НЕ накопление в памяти. Проверка отмены на
    // каждой итерации чтения (= на каждом чанке).
    const writeStream = fs.createWriteStream(partPath)
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    let receivedBytes = 0
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
      reportProgressThrottled(receivedBytes)
    }

    await closeWriteStream(writeStream)

    if (wasCancelled) {
      removePartFile(partPath)
      report({ running: false, cancelled: true })
      return
    }

    // 7. Целостность — сверяем фактический размер .part с ожидаемым Content-Length, если он был.
    // ⚠️ Content-Length может отражать РАЗМЕР НА ПРОВОДЕ (сжатый), а не итоговых декодированных
    // байт: живой пример на easylist.txt — content-length=758786 при content-encoding:gzip, но
    // фактически полученных (декомпрессированных net.fetch на лету) байт — 2146738. Для GGUF
    // (бинарные веса, HF отдаёт как есть, без сжатия по наблюдениям) это не ожидается, но при
    // ложном срабатывании этой проверки на реально целом файле — см. сюда.
    const actualSize = fs.statSync(partPath).size
    if (progress.totalBytes !== null && actualSize !== progress.totalBytes) {
      removePartFile(partPath)
      throw new Error(`Размер файла не совпал: ожидалось ${progress.totalBytes} байт, получено ${actualSize} байт`)
    }

    // 8. Атомарная публикация — оба пути в одном каталоге (userGgufDir()), rename атомарен.
    fs.renameSync(partPath, finalPath)

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
    removePartFile(partPath)
    report({ running: false, error: (e as Error).message ?? String(e) })
  } finally {
    running = false
  }
}

// Уборка осиротевших .part-файлов — краш/убийство процесса посреди скачивания оставляет
// частично записанный файл в userGgufDir() (см. startDownload — .part удаляется только на
// штатных путях: отмена/ошибка/успех, ни один из них не отрабатывает при grubом завершении
// процесса). Зовётся из main.ts СИНХРОННО при старте, ДО того, как пользователь вообще может
// нажать «скачать» — на этот момент активных загрузок в процессе быть не может (running всегда
// false сразу после старта модуля), поэтому снести .part реальной, только что начатой загрузки
// здесь невозможно.
export function cleanupOrphanedParts(): void {
  const dir = ModelRegistry.userGgufDir()
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return // каталога нет — нечего убирать, это норма (ни одной модели ещё не скачивали)
  }

  let removedCount = 0
  let removedBytes = 0
  for (const name of entries) {
    if (!name.endsWith('.part')) continue
    const filePath = path.join(dir, name)
    try {
      const size = fs.statSync(filePath).size
      fs.unlinkSync(filePath)
      removedCount++
      removedBytes += size
    } catch (e) {
      // Файл может быть залочен (антивирус, ещё не закрытый хендл) — не повод прерывать уборку
      // остальных .part-файлов, просто пропускаем этот.
      console.warn(`[model-download] не удалось удалить осиротевший .part-файл ${filePath}:`, (e as Error).message)
    }
  }

  if (removedCount > 0) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(2)
    console.log(`[model-download] уборка при старте: удалено ${removedCount} осиротевших .part-файлов, освобождено ~${gb(removedBytes)} ГБ`)
  }
}
