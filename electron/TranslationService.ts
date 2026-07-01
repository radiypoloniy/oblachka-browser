// Продовый переводчик: Qwen3.5-9B (GGUF Q4_K_M) через node-llama-cpp — единый генеративный слой
// вместо специализированного EuroLLM-1.7B (заменён после сравнения качества/скорости, см. изолированные
// тесты translategemma-test.ts/qwen35-test.ts, уже удалены). Единственный источник правды для
// перевода — используется и боевой фичей (ПКМ → «Перевести», см. TabManager.ts/main.ts), и ручным
// тест-мостом (translateTestBridge.ts), чтобы не дублировать.
// node-llama-cpp работает ТОЛЬКО в main-процессе. Ленивая загрузка: модель (~5.7ГБ) грузится по
// первому вызову translate(), НЕ при старте браузера — иначе окно подвиснет на открытии. Загрузка
// заметно дольше, чем у EuroLLM (~30с против ~5с, соло-замер на чистых 8ГБ VRAM) — see
// translatepopover.tsx: текст плейсхолдера отражает это честно.
import path from 'node:path'
import { getTargetLang } from './TranslationConfig'

// 'ru->en' и т.п. — для ручного теста (translateTestBridge.ts/translatetest.ts, там всегда пара
// ru/en). 'auto' — боевой путь (ПКМ → «Перевести»): язык определяется по тексту, см. detectLang.
export type Direction = 'ru->en' | 'en->ru' | 'auto'
// Реальная пара после резолва — любой язык из LANG_NAME, не только ru/en (франц + другие языки ЕС).
export type ResolvedDirection = `${string}->${string}`

export type TranslateResult =
  | { ok: true; out: string; dirUsed: ResolvedDirection; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string }

// Английские имена языков для промпт-шаблона — только те, что реально можно определить
// (см. FRANC_TO_CODE) и передать модели по имени. Список — не «все языки мира», а разумный набор
// вокруг задачи (крупные европейские + несколько мировых), лёгкий в поддержке.
const LANG_NAME: Record<string, string> = {
  ru: 'Russian', en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', uk: 'Ukrainian', cs: 'Czech', sv: 'Swedish',
  el: 'Greek', ro: 'Romanian', hu: 'Hungarian', bg: 'Bulgarian', hr: 'Croatian',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', tr: 'Turkish', ar: 'Arabic',
}

// franc-min отдаёт ISO 639-3 — переводим в короткие коды из LANG_NAME выше. Список ключей заодно
// передаётся франку как `only` (см. detectLang) — не даём ему распознавать языки, для которых
// у нас всё равно нет промпт-имени.
const FRANC_TO_CODE: Record<string, string> = {
  rus: 'ru', eng: 'en', fra: 'fr', deu: 'de', spa: 'es', ita: 'it', por: 'pt',
  nld: 'nl', pol: 'pl', ukr: 'uk', ces: 'cs', swe: 'sv', ell: 'el', ron: 'ro',
  hun: 'hu', bul: 'bg', hrv: 'hr', cmn: 'zh', jpn: 'ja', kor: 'ko', tur: 'tr', arb: 'ar',
}

// Если не совпал ни с одним targetLang — считаем текст «не на целевом», переводим НА targetLang
// (см. resolveDirection). Для этого случая (и как src, когда сам детектор не смог определить язык)
// нужен нейтральный дефолт-язык — английский, самый частый вариант «непонятного» текста.
const FALLBACK_LANG = 'en'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let francAllFn: ((text: string, options?: any) => Array<[string, number]>) | null = null
let francLoadPromise: Promise<void> | null = null

async function ensureFranc(): Promise<void> {
  if (francAllFn) return
  francLoadPromise ??= (async () => {
    // franc-min — ESM-only пакет (как node-llama-cpp ниже), тот же обход через Function(),
    // чтобы tsc не превратил import() в require() при сборке main в CommonJS.
    const mod: typeof import('franc-min') = await Function('return import("franc-min")')()
    // francAll вместо franc — нужен не только победитель, но и весь список кандидатов с их
    // score (см. эвристики ниже: коротким строкам не хватает сигнала для однозначного вывода,
    // а среди кандидатов почти всегда есть правильный ответ, просто не на первом месте).
    francAllFn = mod.francAll
  })()
  return francLoadPromise
}

// На коротких строках franc даёт мало сигнала и путает языки — подтверждено на живых прогонах:
// «да блин, опять сроки горят...» (52 симв.) → 'bg', «спасибо огромное...» (47 симв.) → 'uk',
// "honestly that's a game changer, let's ship it" (47 симв.) → 'fr'. Общий порог по score не
// работает (проверено численно: score правильного языка у разных пар пересекается со score
// ложного срабатывания на других парах) — вместо этого две точечные эвристики:
// 1) кириллица: bg/uk на короткой строке при рус. тексте — общая графика, франк путает между
//    близкими славянскими языками почти всегда одинаково → просто считаем русским.
// 2) латиница/английский: нет script-сигнала, зато есть надёжный лексический маркер — английские
//    сокращения (that's, let's, don't, we're...) практически не встречаются в других языках
//    из FRANC_TO_CODE в этой форме (апостроф ПОСЛЕ слова, не перед, как в французских l'/c'/qu').
const RU_CONFUSABLE_ON_SHORT_TEXT = new Set(['bg', 'uk'])
const ENGLISH_CONTRACTION_RE = /\b\w+'(s|t|re|ll|ve|d|m)\b/i
const SHORT_TEXT_THRESHOLD = 80

// Лёгкое оффлайн n-граммное определение языка (без сети, без LLM) — НЕ спрашиваем саму модель
// перевода, это был бы лишний медленный вызов. minLength занижен с дефолтных 10 до 3: выделения
// для перевода часто короче одного предложения (отдельные слова/фразы), а франк с дефолтом просто
// вернул бы 'und' на них. Точность на коротких строках ниже, но это лучше, чем всегда «не определил».
async function detectLang(text: string): Promise<string> {
  await ensureFranc()
  const candidates = francAllFn!(text, { only: Object.keys(FRANC_TO_CODE), minLength: 3 })
  let iso3 = candidates[0]?.[0] ?? 'und'
  let code = FRANC_TO_CODE[iso3] ?? FALLBACK_LANG

  if (text.length < SHORT_TEXT_THRESHOLD) {
    if (RU_CONFUSABLE_ON_SHORT_TEXT.has(code)) {
      console.log(`[translate] detected=${code} (iso3=${iso3}) на короткой строке — считаем русским (RU_CONFUSABLE_ON_SHORT_TEXT)`)
      iso3 = 'rus'; code = 'ru'
    } else if (code !== 'en' && ENGLISH_CONTRACTION_RE.test(text) && candidates.some(([c]) => c === 'eng')) {
      console.log(`[translate] detected=${code} (iso3=${iso3}), но есть англ. сокращение (that's/let's/...) — считаем английским`)
      iso3 = 'eng'; code = 'en'
    }
  }

  console.log(`[translate] detectLang: iso3=${iso3} -> code=${code} text="${text.slice(0, 60)}"`)
  return code
}

// Вариант A: иностранное → на целевой язык (targetLang, дефолт 'ru'); если текст уже на целевом —
// на запасной (FALLBACK_LANG). targetLang читается из TranslationConfig — единственного места,
// куда позже начнёт писать кнопка настроек AI, без изменений здесь.
async function resolveDirection(dir: Direction, text: string): Promise<{ src: string; tgt: string }> {
  if (dir !== 'auto') {
    const [src, tgt] = dir.split('->') as [string, string]
    return { src, tgt }
  }
  const target = getTargetLang()
  const detected = await detectLang(text)
  return detected === target ? { src: target, tgt: FALLBACK_LANG } : { src: detected, tgt: target }
}

// Грубая разбивка на предложения (не NLP-прод): границы — .!?… перед пробелом/концом строки.
// Держим короткие однопредложенческие вызовы к модели — быстрее, стабильнее на длинных
// выделениях, меньше риска, что модель начнёт «растекаться» на большом входе. Qwen (в отличие от
// EuroLLM) не требует этого как обход конкретного бага — но архитектуру перевода по сегментам не
// меняем (перенесена как есть), только сам движок ниже.
function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]*(\s+|$)/g) ?? [text]
  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

// Естественная инструкция для общего чат/инструкт-слоя (Qwen3.5) — не fill-in-the-blank формат
// EuroLLM, у которого свой формат карточки модели. src/tgt — любая пара из LANG_NAME (не
// захардкоженные ru/en), резолвится в resolveDirection.
function buildPrompt(src: string, tgt: string, text: string): string {
  const S = LANG_NAME[src] ?? src; const T = LANG_NAME[tgt] ?? tgt
  return `Translate the following ${S} text to ${T}. Output ONLY the ${T} translation, ` +
    `with no explanations, notes, or additional commentary.\n\n${text}`
}

// Защита от утечки reasoning в перевод: у Qwen3.5-9B thinking по умолчанию off, и chatWrapper ниже
// явно просит thoughts:'discourage' — но это диагностировано на живых прогонах (см. qwen35-test.ts,
// уже удалён), не гарантия на 100% случаев. Если <think>-теги всё же просочатся — вырезаем перед
// тем, как отдать текст в поповер, а не полагаемся молча на настройку wrapper'а.
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let qwenChatWrapper: any = null
let loadPromise: Promise<number> | null = null

async function ensureLoaded(): Promise<number> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const t0 = performance.now()
    // ESM-only пакет, main собран в CommonJS — обычный import() tsc превратил бы в require(),
    // а у node-llama-cpp top-level await внутри графа модулей (ERR_REQUIRE_ASYNC_MODULE).
    // Официальный обход из доков библиотеки: спрятать import() внутри Function(),
    // чтобы tsc его не транспилировал — тогда это настоящий динамический import.
    const nlc: typeof import('node-llama-cpp') = await Function('return import("node-llama-cpp")')()
    llama = await nlc.getLlama()
    LlamaChatSession = nlc.LlamaChatSession
    // variation:'3.5' — актуальный чат-шаблон Qwen3.5 (свой формат, не EuroLLM/Gemma).
    // thoughts:'discourage' — явно давим reasoning: у Qwen3.5-9B thinking по умолчанию off, но
    // задача была УБЕДИТЬСЯ, а не полагаться на дефолт (подтверждено на живых прогонах: без утечек
    // <think> ни разу — доп. защита всё равно есть в stripThinking() ниже).
    qwenChatWrapper = new nlc.QwenChatWrapper({ variation: '3.5', thoughts: 'discourage' })
    const modelPath = path.join(__dirname, '../../resources/models/gguf/Qwen3.5-9B-Q4_K_M.gguf')
    model = await llama.loadModel({ modelPath })
    context = await model.createContext({ sequences: 1 })
    sequence = context.getSequence()
    return performance.now() - t0
  })()
  return loadPromise
}

async function translateSegment(segment: string, src: string, tgt: string): Promise<{ out: string; tokens: number }> {
  const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: '', chatWrapper: qwenChatWrapper })
  const userMsg = buildPrompt(src, tgt, segment)
  const out = stripThinking((await session.prompt(userMsg, { maxTokens: 150 })).trim())
  const tokens = model.tokenize(out).length
  await sequence.clearHistory()
  return { out, tokens }
}

export async function translate(text: string, dir: Direction = 'auto'): Promise<TranslateResult> {
  try {
    const wasLoaded = loadPromise !== null
    const loadMs = await ensureLoaded()

    // Направление резолвим один раз по всему тексту — не по каждому предложению отдельно.
    const { src, tgt } = await resolveDirection(dir, text)
    const dirUsed: ResolvedDirection = `${src}->${tgt}`
    const segments = splitSentences(text)

    const t0 = performance.now()
    const outs: string[] = []
    let totalTokens = 0
    for (const segment of segments) {
      const { out, tokens } = await translateSegment(segment, src, tgt)
      outs.push(out)
      totalTokens += tokens
    }
    const ms = performance.now() - t0
    const tokPerSec = totalTokens / (ms / 1000)
    const out = outs.join(' ')

    console.log(
      `[translate] [${dirUsed}] ${segments.length} seg(s): "${text}" -> "${out}" ` +
      `(${ms.toFixed(0)}ms, ${tokPerSec.toFixed(1)} tok/s)`,
    )

    return { ok: true, out, dirUsed, ms, tokPerSec, loadMs: wasLoaded ? null : loadMs }
  } catch (e) {
    console.error('[translate] error:', e)
    return { ok: false, error: String(e) }
  }
}
