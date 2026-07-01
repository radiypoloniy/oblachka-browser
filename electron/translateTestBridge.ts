// Изолированный мост для ручного теста перевода: EuroLLM-1.7B-Instruct (GGUF Q4_K_M) через
// node-llama-cpp, вызывается из отдельного тест-окна (src/translatetest.ts) через IPC.
// Не часть боевого чрома/эмбеддинга: регистрируется только при OBLAKO_TRANSLATE_TEST=1
// (electron/main.ts), боевой transformers.js/EmbeddingService не трогает.
import path from 'node:path'
import { ipcMain } from 'electron'

type Direction = 'ru->en' | 'en->ru' | 'auto'
type ResolvedDirection = 'ru->en' | 'en->ru'

const LANG_NAME: Record<'ru' | 'en', string> = { ru: 'Russian', en: 'English' }
const CYRILLIC_RE = /[а-яёА-ЯЁ]/

function resolveDirection(dir: Direction, text: string): ResolvedDirection {
  if (dir !== 'auto') return dir
  return CYRILLIC_RE.test(text) ? 'ru->en' : 'en->ru'
}

// Грубая разбивка на предложения (не NLP-прод, диагностический инструмент): границы — .!?…
// перед пробелом/концом строки. Нужна, т.к. customStopTriggers:'\n' ниже режет вывод по первому
// переносу строки — модель кладёт переведённые предложения на отдельные строки, и при переводе
// многопредложенного текста ОДНИМ вызовом стоп срабатывал после первого предложения, обрезая
// остальное. Решение: переводить по предложению (каждое — короткий однострочный вызов, для
// которого стоп-триггер и задумывался), затем склеивать.
function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]*(\s+|$)/g) ?? [text]
  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

// Промпт-шаблон из прошлого диагностического теста (V1-official) — единственный, что оживил
// en->ru: пустой system, инструкция + labeled fill-in-the-blank в user-сообщении, как в
// карточке модели utter-project/EuroLLM-1.7B-Instruct.
function buildPrompt(dir: ResolvedDirection, text: string): string {
  const { src, tgt } = dir === 'ru->en' ? { src: 'ru' as const, tgt: 'en' as const } : { src: 'en' as const, tgt: 'ru' as const }
  const S = LANG_NAME[src]; const T = LANG_NAME[tgt]
  return `Translate the following ${S} source text to ${T}:\n${S}: ${text} \n${T}: `
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let llama: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let context: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sequence: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let LlamaChatSession: any = null
let loadPromise: Promise<number> | null = null

// Ленивая загрузка: тяжёлая модель (~1ГБ) грузится по первому реальному вызову перевода,
// НЕ при старте окна — иначе тест-окно подвисло бы на открытии.
async function ensureLoaded(): Promise<number> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const t0 = performance.now()
    // ESM-only пакет, main собран в CommonJS — обычный import() tsc превратил бы в require(),
    // а у node-llama-cpp top-level await внутри графа модулей (ERR_REQUIRE_ASYNC_MODULE).
    // Официальный обход: спрятать import() внутри Function(), чтобы tsc его не транспилировал.
    const nlc: typeof import('node-llama-cpp') = await Function('return import("node-llama-cpp")')()
    llama = await nlc.getLlama()
    LlamaChatSession = nlc.LlamaChatSession
    const modelPath = path.join(__dirname, '../../resources/models/gguf/EuroLLM-1.7B-Instruct.Q4_K_M.gguf')
    model = await llama.loadModel({ modelPath })
    context = await model.createContext({ sequences: 1 })
    sequence = context.getSequence()
    return performance.now() - t0
  })()
  return loadPromise
}

type TranslateResult =
  | { ok: true; out: string; dirUsed: ResolvedDirection; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string }

// Один сегмент (одно предложение) через уже проверенный пайплайн: пустой system,
// labeled-completion промпт, стоп на первом переносе строки.
async function translateSegment(segment: string, dirUsed: ResolvedDirection): Promise<{ out: string; tokens: number }> {
  const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: '' })
  const userMsg = buildPrompt(dirUsed, segment)
  const out = (await session.prompt(userMsg, { maxTokens: 100, customStopTriggers: ['\n'] })).trim()
  const tokens = model.tokenize(out).length
  await sequence.clearHistory()
  return { out, tokens }
}

async function translateOnce(text: string, dir: Direction): Promise<TranslateResult> {
  try {
    const wasLoaded = loadPromise !== null
    const loadMs = await ensureLoaded()

    // Направление резолвим один раз по всему тексту — не по каждому предложению отдельно
    // (иначе разное направление на разные сегменты одного текста при смешанных вставках).
    const dirUsed = resolveDirection(dir, text)
    const segments = splitSentences(text)

    const t0 = performance.now()
    const outs: string[] = []
    let totalTokens = 0
    for (const segment of segments) {
      const { out, tokens } = await translateSegment(segment, dirUsed)
      outs.push(out)
      totalTokens += tokens
    }
    const ms = performance.now() - t0
    const tokPerSec = totalTokens / (ms / 1000)
    const out = outs.join(' ')

    console.log(
      `[translatetest] [${dirUsed}] ${segments.length} seg(s): "${text}" -> "${out}" ` +
      `(${ms.toFixed(0)}ms, ${tokPerSec.toFixed(1)} tok/s)`,
    )

    return { ok: true, out, dirUsed, ms, tokPerSec, loadMs: wasLoaded ? null : loadMs }
  } catch (e) {
    console.error('[translatetest] error:', e)
    return { ok: false, error: String(e) }
  }
}

export function initTranslateTestBridge(): void {
  ipcMain.handle('translatetest:run', (_e, text: string, dir: Direction) => translateOnce(text, dir))
  console.log('[translatetest] bridge ready (модель загрузится по первому запросу)')
}
