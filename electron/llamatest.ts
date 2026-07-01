// Изолированный стенд: EuroLLM-1.7B-Instruct (GGUF Q4_K_M) через node-llama-cpp.
// node-llama-cpp работает ТОЛЬКО в main-процессе (в renderer падает — см. доки библиотеки),
// поэтому в отличие от gputest.ts/llmtest.ts этот тест целиком здесь, без BrowserWindow.
// Не часть боевого чрома: запускается только при OBLAKO_LLAMA_TEST=1 (main.ts),
// боевой эмбеддинг-путь (EmbeddingService/embedding.worker.ts, transformers.js) не трогает.
import path from 'node:path'

type Direction = 'ru->en' | 'en->ru'
type Phrase = { dir: Direction; text: string }

// Те же разговорные фразы-ловушки, что и в gputest/llmtest — прямое сравнение runtime'ов.
const PHRASES: Phrase[] = [
  { dir: 'ru->en', text: 'слушай, я щас не могу говорить, наберу вечером как освобожусь' },
  { dir: 'ru->en', text: 'да блин, опять сроки горят, давай перенесём созвон' },
  { dir: 'ru->en', text: 'спасибо огромное, реально выручил, с меня кофе' },
  { dir: 'en->ru', text: 'hey, circling back — did you get a chance to look at the doc?' },
  { dir: 'en->ru', text: 'no worries, take your time, no rush on my end' },
  { dir: 'en->ru', text: "honestly that's a game changer, let's ship it" },
]

// Диагностика en->ru: первый прогон использовал системный промпт ("You are a translator...")
// и провалил en->ru (модель возвращала английский нетронутым). Официальная карточка модели
// (utter-project/EuroLLM-1.7B-Instruct README) даёт другой формат: ПУСТОЙ system, а инструкция +
// labeled fill-in-the-blank в user-сообщении, например:
//   <|im_start|>system\n<|im_end|>\n<|im_start|>user\n
//   Translate the following English source text to Portuguese:\nEnglish: ... \nPortuguese: <|im_end|>...
// Проверяем гипотезу «баг шаблона, не модели» — два варианта промпта, тот же набор фраз.
const LANG_NAME: Record<'ru' | 'en', string> = { ru: 'Russian', en: 'English' }

function langs(dir: Direction): { src: 'ru' | 'en'; tgt: 'ru' | 'en' } {
  return dir === 'ru->en' ? { src: 'ru', tgt: 'en' } : { src: 'en', tgt: 'ru' }
}

// V1 — точно по формату из карточки модели: инструкция + "Lang: text \nLang: ".
function promptV1(dir: Direction, text: string): string {
  const { src, tgt } = langs(dir)
  const S = LANG_NAME[src]; const T = LANG_NAME[tgt]
  return `Translate the following ${S} source text to ${T}:\n${S}: ${text} \n${T}: `
}

// V2 — голые labels без вступительной инструкции: проверяем, нужна ли она вообще.
function promptV2(dir: Direction, text: string): string {
  const { src, tgt } = langs(dir)
  const S = LANG_NAME[src]; const T = LANG_NAME[tgt]
  return `${S}: ${text}\n${T}: `
}

const VARIANTS: Array<{ name: string; build: (dir: Direction, text: string) => string }> = [
  { name: 'V1-official', build: promptV1 },
  { name: 'V2-bare-labels', build: promptV2 },
]

function fmtVram(v: { total: number; used: number; free: number }): string {
  const gb = (n: number) => (n / 1024 ** 3).toFixed(2)
  return `used=${gb(v.used)}GB free=${gb(v.free)}GB total=${gb(v.total)}GB`
}

export async function runLlamaTest(): Promise<void> {
  console.log('[llamatest] === EuroLLM-1.7B-Instruct (GGUF Q4_K_M, node-llama-cpp) ===')

  // ESM-only пакет (package.json: "type":"module"), main-процесс собран в CommonJS.
  // Обычный `await import(...)` tsc транспилирует в require() (см. tsconfig module:"commonjs"),
  // а node-llama-cpp использует top-level await внутри своего графа модулей — Node не может
  // синхронно require() такое (ERR_REQUIRE_ASYNC_MODULE). Официальный обход из доков библиотеки:
  // спрятать import() внутри Function(), чтобы tsc его не трогал — тогда это настоящий динамический import.
  const nlc: typeof import('node-llama-cpp') = await Function('return import("node-llama-cpp")')()
  const { getLlama, LlamaChatSession } = nlc

  const llama = await getLlama()
  console.log(`[llamatest] gpu backend: ${llama.gpu}`)
  const vramBefore = await llama.getVramState()
  console.log(`[llamatest] vram before load: ${fmtVram(vramBefore)}`)

  const t0 = performance.now()
  const modelPath = path.join(__dirname, '../../resources/models/gguf/EuroLLM-1.7B-Instruct.Q4_K_M.gguf')
  const model = await llama.loadModel({ modelPath })
  // Один sequence-слот — реалистичный след одной активной беседы (не N параллельных).
  // getSequence() не переиспользуется через dispose()/повторный getSequence() (слоты не
  // возвращаются в пул) — вместо этого держим одну sequence и чистим её clearHistory()
  // между независимыми фразами, чтобы перевод одной не влиял на следующую.
  const context = await model.createContext({ sequences: 1 })
  const sequence = context.getSequence()
  const loadMs = performance.now() - t0

  const vramAfter = await llama.getVramState()
  console.log(`[llamatest] load=${loadMs.toFixed(0)}ms`)
  console.log(`[llamatest] vram after load: ${fmtVram(vramAfter)}`)

  // Прогрев: первый prompt() компилирует backend-кернелы — считаем отдельно (cold),
  // чтобы не искажать честные per-phrase тайминги ниже (warm).
  const warmupSession = new LlamaChatSession({ contextSequence: sequence })
  const tw0 = performance.now()
  await warmupSession.prompt('Скажи "привет" одним словом.', { maxTokens: 8 })
  const warmupMs = performance.now() - tw0
  console.log(`[llamatest] warmup (cold): ${warmupMs.toFixed(0)}ms`)
  await sequence.clearHistory()

  type Row = { variant: string; dir: Direction; src: string; out: string; ms: number; tokPerSec: number }
  const rows: Row[] = []

  for (const { name: variant, build } of VARIANTS) {
    for (const { dir, text } of PHRASES) {
      // Новая сессия на фразу поверх той же sequence (очищенной clearHistory) — иначе история
      // предыдущего перевода влияла бы на следующий. systemPrompt пустой, как в карточке модели —
      // вся инструкция внутри user-сообщения (build()).
      const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: '' })
      const userMsg = build(dir, text)
      const t1 = performance.now()
      const out = (await session.prompt(userMsg, { maxTokens: 80 })).trim()
      const ms = performance.now() - t1
      const tokens = model.tokenize(out).length
      const tokPerSec = tokens / (ms / 1000)
      rows.push({ variant, dir, src: text, out, ms, tokPerSec })
      console.log(`[llamatest] [${variant}][${dir}] "${text}" -> "${out}" (${ms.toFixed(0)}ms, ${tokPerSec.toFixed(1)} tok/s)`)
      await sequence.clearHistory()
    }
  }

  const vramFinal = await llama.getVramState()

  console.log('[llamatest] --- итоговая таблица ---')
  console.log('[llamatest] variant | dir | ms | tok/s | source | translation')
  for (const r of rows) {
    console.log(`[llamatest] ${r.variant} | ${r.dir} | ${r.ms.toFixed(0)} | ${r.tokPerSec.toFixed(1)} | ${r.src} | ${r.out}`)
  }
  console.log(
    `[llamatest] gpu=${llama.gpu} load=${loadMs.toFixed(0)}ms warmup(cold)=${warmupMs.toFixed(0)}ms ` +
    `vram_after_load=${fmtVram(vramAfter)} vram_final=${fmtVram(vramFinal)}`,
  )

  await context.dispose()
  await model.dispose()
  await llama.dispose()

  console.log('[llamatest] === DONE ===')
}
