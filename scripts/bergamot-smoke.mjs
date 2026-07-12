#!/usr/bin/env node
/**
 * Разовая ручная проверка Bergamot-воркера (см. план внедрения, Этап 2) — БЕЗ UI, БЕЗ
 * TranslationEngineRegistry. Спавнит dist-electron/electron/BergamotWorkerEntry.js (нужен
 * `npm run build:electron` перед запуском) как обычный node:worker_threads.Worker, скармливает
 * HTML-фрагмент, печатает время инициализации и время перевода.
 *
 * Модели читаются из `<--models-dir>/models/translation/{from}-{to}/` — по умолчанию
 * ./resources/models/translation (dev-тестовый набор, НЕ настоящий userData: в проде main.ts
 * передаёт app.getPath('userData'), см. план Этапа 3). Файлы под resources/models/ в .gitignore,
 * скачиваются вручную (см. README) — для en-ru/ru-en взяты с дефолтного реестра самого пакета
 * (bergamot.s3.amazonaws.com/models/index.json), гарантированно совместимого по формату именно
 * с этой версией WASM-рантайма (в отличие от текущих файлов Mozilla firefox-translations-models,
 * которые готовятся под более свежий движок — см. предупреждение в конце этого файла).
 *
 * Запуск: npm run bergamot-smoke -- --from en --to ru --text "<p>Hello <b>world</b></p>"
 */
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : fallback
}

const FROM = arg('from', 'en')
const TO = arg('to', 'ru')
const TEXT = arg('text', '<p>Hello <b>world</b>, this is a <a href="https://example.com">test</a> sentence.</p>')
const MODELS_ROOT = arg('models-dir', path.join(ROOT, 'resources'))

const workerEntry = path.join(ROOT, 'dist-electron', 'electron', 'BergamotWorkerEntry.js')

console.log(`from=${FROM} to=${TO}`)
console.log(`models dir: ${path.join(MODELS_ROOT, 'models', 'translation')}`)
console.log(`worker entry: ${workerEntry}`)
console.log(`input: ${TEXT}`)

const t0 = performance.now()
// bundledModelsDir = тот же MODELS_ROOT — воркер теперь ждёт оба поля (см. BergamotWorkerEntry.ts),
// для смоука разделять userData/бандл незачем, оба указывают в одно и то же место на диске.
const worker = new Worker(workerEntry, { workerData: { userDataPath: MODELS_ROOT, bundledModelsDir: path.join(MODELS_ROOT, 'models', 'translation') } })

let tReady = null
let reqId = 0

worker.on('message', (msg) => {
  if (msg.type === 'ready') {
    tReady = performance.now()
    console.log(`\n[ready] инициализация заняла ${(tReady - t0).toFixed(0)}ms`)
    const tTranslateStart = performance.now()
    worker.postMessage({ type: 'translate-batch', reqId: reqId++, from: FROM, to: TO, items: [{ id: 1, text: TEXT }] })
    worker.once('message', (resultMsg) => {
      const tDone = performance.now()
      console.log(`[translate] заняло ${(tDone - tTranslateStart).toFixed(0)}ms`)
      if (resultMsg.type === 'translate-result') {
        console.log('\nРезультат:')
        console.log(resultMsg.results)
      } else {
        console.error('\nОшибка перевода:', resultMsg)
      }
      worker.postMessage({ type: 'dispose' })
    })
    return
  }
  if (msg.type === 'init-error') {
    console.error('\n[init-error] Bergamot не поднялся:', msg.message)
    console.error('\nЕсли ошибка про отсутствие/формат файлов модели — проверь, что в')
    console.error(`${path.join(MODELS_ROOT, 'models', 'translation', `${FROM}-${TO}`)} лежат`)
    console.error('model.*.bin, lex*.bin, vocab*.spm (см. README — источник и скрипт скачивания).')
    process.exit(1)
  }
})

worker.on('error', (err) => {
  console.error('\n[worker error] воркер упал:', err)
  process.exit(1)
})

worker.on('exit', (code) => {
  console.log(`\n[exit] код ${code}`)
  process.exit(code ?? 0)
})
