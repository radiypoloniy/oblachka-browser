// Точка входа воркер-треда для Bergamot (Marian NMT, WASM, CPU) — см. план внедрения (Этап 2).
// Спавнится ТОЛЬКО из main-процесса (electron/BergamotService.ts) через node:worker_threads.Worker,
// НЕ из renderer — WASM-потокам нужен SharedArrayBuffer, в Node он доступен без COOP/COEP-заголовков
// (в отличие от renderer, где для этого понадобилась бы cross-origin isolation — см.
// AppProtocol.ts::registerChromeProtocol, там она уже настроена ради эмбеддингов, но заводить её
// ради ещё и Bergamot не хотим, чтобы не плодить лишние требования к загрузке ассетов чрома).
//
// Крах этого файла (необработанное исключение, паника WASM) не должен ронять main-процесс — весь
// код ниже живёт в изолированном worker-треде, main видит только 'error'/'exit' события через
// BergamotService.ts и откатывается на Qwen.
import { parentPort, workerData } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs'

if (!parentPort) {
  throw new Error('[bergamot-worker] запущен не как worker_thread — parentPort отсутствует')
}
const port = parentPort

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backing = any

// {userData}/models/translation/{from}-{to}/ — пользовательский профиль, туда можно докладывать/
// обновлять модели без пересборки приложения. Живой баг (см. историю): раньше здесь была ТОЛЬКО
// userData, без фолбэка на бандл — после npm run download-translation-models файлы оказывались в
// resources/models/translation, а реальный воркер их не видел (только userData, пустая), и
// TranslationEngineRegistry тихо откатывался на Qwen. bundledModelsDir — тот же принцип
// приоритета, что уже есть в AppProtocol.ts::resolveModelsBase (userData сначала, resources как
// бандл), посчитанный в main-процессе (BergamotTranslationEngine.ts, там доступны app.isPackaged/
// process.resourcesPath) и переданный сюда готовым путём — воркер сам ничего не знает про Electron.
const USER_MODELS_DIR = path.join(workerData.userDataPath, 'models', 'translation')
const BUNDLED_MODELS_DIR: string = workerData.bundledModelsDir

function hasAnyPairDir(dir: string): boolean {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some((d) => d.isDirectory())
  } catch {
    return false
  }
}

const MODELS_DIR = hasAnyPairDir(USER_MODELS_DIR) ? USER_MODELS_DIR : BUNDLED_MODELS_DIR
console.log(`[bergamot-worker] models dir: ${MODELS_DIR} (userData=${hasAnyPairDir(USER_MODELS_DIR)})`)

// Единственный файл с этим именем в директории пары — не жёсткое имя (у разных источников моделей
// оно разное, см. живой пример из bergamot.s3.amazonaws.com/models/index.json:
// model.enru.intgemm.alphas.bin, lex.50.50.enru.s2t.bin, vocab.enru.spm), а маска по префиксу+
// расширению. Больше одного совпадения — берём первое, но предупреждаем в лог (двусмысленность
// лучше показать, чем молча съесть).
function findOne(dir: string, prefix: string, ext: string): Buffer | null {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return null
  }
  const matches = entries.filter((f) => f.startsWith(prefix) && f.endsWith(ext))
  if (matches.length === 0) return null
  if (matches.length > 1) {
    console.warn(`[bergamot-worker] неоднозначность в ${dir}: несколько файлов ${prefix}*${ext} (${matches.join(', ')}) — беру первый`)
  }
  return fs.readFileSync(path.join(dir, matches.sort()[0]!))
}

// Живой баг, пойманный на смоук-тесте en-ja/en-ko: у части языков (проверено на японском и
// корейском реестра Mozilla) исходный и целевой словарь — РАЗНЫЕ файлы, `srcvocab.*.spm`/
// `trgvocab.*.spm`, а не общий `vocab.*.spm` (см. другие языки — en-ru/fr/de/... там один общий).
// findOne(dir,'vocab','.spm') ищет ПРЕФИКС 'vocab' — 'srcvocab...'/'trgvocab...' под него не
// попадают ('s'/'t' в начале, не 'v'), и listAvailablePairs() тихо считал такую пару "неполной",
// хотя оба файла реально на диске. hasAnyVocab — по вхождению 'vocab' в имя, а не по префиксу.
function hasAnyVocab(dir: string): boolean {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return false
  }
  return entries.some((f) => f.includes('vocab') && f.endsWith('.spm'))
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

// Список пар, для которых на диске есть все три обязательных файла (model/lex/vocab) — это и есть
// "поддерживаемые" пары с точки зрения TranslatorBacking.loadModelRegistery(). Директория именуется
// `{from}-{to}` (например `en-ru`, `ru-en`, `fr-en` для пивот-шага) — читаемее, чем склеенные
// 4-буквенные коды исходного реестра Bergamot, и не путается с именами файлов внутри.
function listAvailablePairs(): Array<{ from: string; to: string }> {
  let dirs: string[]
  try {
    dirs = fs.readdirSync(MODELS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
  const pairs: Array<{ from: string; to: string }> = []
  for (const name of dirs) {
    const m = /^([a-z]{2,3})-([a-z]{2,3})$/.exec(name)
    if (!m) continue
    const dir = path.join(MODELS_DIR, name)
    const hasModel = findOne(dir, 'model.', '.bin') !== null
    const hasLex = findOne(dir, 'lex', '.bin') !== null
    const hasVocab = hasAnyVocab(dir)
    if (hasModel && hasLex && hasVocab) pairs.push({ from: m[1]!, to: m[2]! })
    else console.warn(`[bergamot-worker] ${name}: неполный набор файлов модели — пропускаю (model=${hasModel} lex=${hasLex} vocab=${hasVocab})`)
  }
  return pairs
}

async function main(): Promise<void> {
  // ESM-only пакет (type:"module"), main-процесс собран в CommonJS — тот же обход через Function(),
  // что уже используется в TranslationService.ts (node-llama-cpp) и NllbTranslateService.ts
  // (@huggingface/transformers), чтобы tsc не превратил import() в require().
  const bergamot: typeof import('@browsermt/bergamot-translator') =
    await Function('return import("@browsermt/bergamot-translator")')()
  const { BatchTranslator, TranslatorBacking } = bergamot

  // Свой TranslatorBacking — читает файлы с диска вместо дефолтного (CDN Mozilla/AWS). Переопределяет
  // ровно два метода, которых достаточно: loadModelRegistery (какие пары есть) и
  // loadTranslationModel (байты конкретной пары). Остальное (в т.ч. пивот через pivotLanguage —
  // TranslatorBacking.findModels/getModels) уже реализовано в базовом классе, трогать не нужно.
  class FileSystemTranslatorBacking extends (TranslatorBacking as { new (options?: unknown): Backing }) {
    async loadModelRegistery(): Promise<Array<{ from: string; to: string }>> {
      return listAvailablePairs()
    }

    async loadTranslationModel({ from, to }: { from: string; to: string }): Promise<{
      model: ArrayBuffer
      vocabs: ArrayBuffer[]
      shortlist: ArrayBuffer
    }> {
      const dir = path.join(MODELS_DIR, `${from}-${to}`)
      const model = findOne(dir, 'model.', '.bin')
      const shortlist = findOne(dir, 'lex', '.bin')
      // Один общий vocab.*.spm (одно совпадение) ЛИБО раздельные src/trg (два совпадения) —
      // includes('vocab'), не startsWith: реальные пары из реестра Mozilla (en-ja/en-ko, см.
      // смоук-тест) называют раздельные словари srcvocab.*.spm/trgvocab.*.spm, 'srcvocab'
      // не начинается с 'vocab', startsWith тут молча терял оба файла. Сортировка по имени даёт
      // нужный алфавитный порядок src < trg для этой схемы — если у будущей пары окажется другая
      // схема имён, здесь придётся дать точную маску, а не общий vocab.*.spm).
      let entries: string[]
      try {
        entries = fs.readdirSync(dir)
      } catch {
        entries = []
      }
      const vocabFiles = entries.filter((f) => f.includes('vocab') && f.endsWith('.spm')).sort()
      if (!model || !shortlist || vocabFiles.length === 0) {
        throw new Error(`[bergamot-worker] нет файлов модели для пары ${from}->${to} в ${dir}`)
      }
      const vocabs = vocabFiles.map((f) => toArrayBuffer(fs.readFileSync(path.join(dir, f))))
      return {
        model: toArrayBuffer(model),
        shortlist: toArrayBuffer(shortlist),
        vocabs,
      }
    }
  }

  const backing = new FileSystemTranslatorBacking({ pivotLanguage: 'en' })
  const translator = new (BatchTranslator as {
    new (options: unknown, backing: unknown): {
      translate: (req: { from: string; to: string; text: string; html?: boolean }) => Promise<{ target: { text: string } }>
      delete: () => Promise<void>
    }
  })({ pivotLanguage: 'en', workers: 1, batchSize: 8 }, backing)

  port.postMessage({ type: 'ready' })

  port.on('message', async (msg: { type: string; reqId: number; from?: string; to?: string; items?: Array<{ id: number; text: string }> }) => {
    if (msg.type === 'ping') {
      port.postMessage({ type: 'pong', reqId: msg.reqId })
      return
    }

    if (msg.type === 'list-pairs') {
      // listAvailablePairs() уже прочитано один раз в loadModelRegistery() (backing.registry) —
      // но это приватное поле переопределённого класса, зовём ту же функцию напрямую, а не лезем
      // внутрь backing — дешевле (просто fs.readdirSync), чем городить публичный геттер.
      port.postMessage({ type: 'pairs-result', reqId: msg.reqId, pairs: listAvailablePairs() })
      return
    }

    if (msg.type === 'translate-batch') {
      try {
        const results = await Promise.all(
          (msg.items ?? []).map(async (item) => {
            try {
              const r = await translator.translate({ from: msg.from!, to: msg.to!, text: item.text, html: true })
              return { id: item.id, text: r.target.text }
            } catch (e) {
              console.error(`[bergamot-worker] юнит ${item.id} упал:`, e)
              return null
            }
          }),
        )
        port.postMessage({ type: 'translate-result', reqId: msg.reqId, results: results.filter((r) => r !== null) })
      } catch (e) {
        port.postMessage({ type: 'error', reqId: msg.reqId, message: String(e) })
      }
      return
    }

    if (msg.type === 'dispose') {
      await translator.delete()
      process.exit(0)
    }
  })
}

main().catch((e) => {
  console.error('[bergamot-worker] инициализация упала:', e)
  port.postMessage({ type: 'init-error', message: String(e && e.stack || e) })
  process.exit(1)
})
