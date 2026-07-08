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
import type { AiAction, AiActionOutcome } from '../shared/ipc'

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
  el: 'Greek', ro: 'Romanian', hu: 'Hungarian', bg: 'Bulgarian', hr: 'Croatian', be: 'Belarusian',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', tr: 'Turkish', ar: 'Arabic',
}

// franc-min отдаёт ISO 639-3 — переводим в короткие коды из LANG_NAME выше. Список ключей заодно
// передаётся франку как `only` (см. detectLang) — не даём ему распознавать языки, для которых
// у нас всё равно нет промпт-имени. bel (белорусский) добавлен наравне с bul/ukr — тоже кириллица,
// тоже близок к русскому графически, без явного маппинга ушёл бы в FALLBACK_LANG молча.
const FRANC_TO_CODE: Record<string, string> = {
  rus: 'ru', eng: 'en', fra: 'fr', deu: 'de', spa: 'es', ita: 'it', por: 'pt',
  nld: 'nl', pol: 'pl', ukr: 'uk', ces: 'cs', swe: 'sv', ell: 'el', ron: 'ro',
  hun: 'hu', bul: 'bg', hrv: 'hr', bel: 'be', cmn: 'zh', jpn: 'ja', kor: 'ko', tur: 'tr', arb: 'ar',
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

// franc путает языки — подтверждено на живых прогонах, и НЕ только на коротких строках:
// «да блин, опять сроки горят...» (52 симв.) → 'bg', «спасибо огромное...» (47 симв.) → 'uk',
// "honestly that's a game changer, let's ship it" (47 симв.) → 'fr' — и целая русскоязычная
// новостная статья (200+ симв., много имён собственных и кавычек) тоже ушла в 'bg'. Длина не
// спасает. Общий порог по score тоже не работает (проверено численно: score правильного языка у
// разных пар пересекается со score ложного срабатывания на других парах) — вместо этого две
// точечные эвристики, каждая на своём независимом сигнале (не на score franc):
// 1) кириллица: bg/uk/be при преимущественно кириллическом тексте — общая графика, франк путает
//    между близкими славянскими языками systematically → считаем русским БЕЗУСЛОВНО, без разбора
//    длины строки (длина не помогает, см. выше). Для этого пользователя русский на порядок
//    вероятнее болгарского/украинского/белорусского.
// 2) латиница/английский: нет script-сигнала, зато есть надёжный лексический маркер — английские
//    сокращения (that's, let's, don't, we're...) практически не встречаются в других языках
//    из FRANC_TO_CODE в этой форме (апостроф ПОСЛЕ слова, не перед, как в французских l'/c'/qu').
//    Эта эвристика короткой строкой пока не была замечена ложной за пределами SHORT_TEXT_THRESHOLD,
//    оставлена ограниченной короткими фразами, чтобы не разрастаться сверх подтверждённой проблемы.
const RU_CONFUSABLE = new Set(['bg', 'uk', 'be'])
const ENGLISH_CONTRACTION_RE = /\b\w+'(s|t|re|ll|ve|d|m)\b/i
const SHORT_TEXT_THRESHOLD = 80

function isMostlyCyrillic(text: string): boolean {
  const letters = text.match(/[a-zA-Zа-яёА-ЯЁ]/g)
  if (!letters || letters.length === 0) return false
  const cyrillic = text.match(/[а-яёА-ЯЁ]/g)?.length ?? 0
  return cyrillic / letters.length > 0.5
}

// Лёгкое оффлайн n-граммное определение языка (без сети, без LLM) — НЕ спрашиваем саму модель
// перевода, это был бы лишний медленный вызов. minLength занижен с дефолтных 10 до 3: выделения
// для перевода часто короче одного предложения (отдельные слова/фразы), а франк с дефолтом просто
// вернул бы 'und' на них. Точность на коротких строках ниже, но это лучше, чем всегда «не определил».
async function detectLang(text: string): Promise<string> {
  await ensureFranc()
  const candidates = francAllFn!(text, { only: Object.keys(FRANC_TO_CODE), minLength: 3 })
  let iso3 = candidates[0]?.[0] ?? 'und'
  let code = FRANC_TO_CODE[iso3] ?? FALLBACK_LANG

  if (RU_CONFUSABLE.has(code) && isMostlyCyrillic(text)) {
    console.log(`[translate] detected=${code} (iso3=${iso3}), текст преим. кириллический — считаем русским (RU_CONFUSABLE)`)
    iso3 = 'rus'; code = 'ru'
  } else if (text.length < SHORT_TEXT_THRESHOLD && code !== 'en' && ENGLISH_CONTRACTION_RE.test(text) && candidates.some(([c]) => c === 'eng')) {
    console.log(`[translate] detected=${code} (iso3=${iso3}), но есть англ. сокращение (that's/let's/...) — считаем английским`)
    iso3 = 'eng'; code = 'en'
  }

  console.log(`[translate] detectLang: franc raw=${candidates[0]?.[0] ?? 'und'} -> mapped=${code} text="${text.slice(0, 60)}"`)
  return code
}

// Вариант A: иностранное → на целевой язык (targetLang, дефолт 'ru'); если текст уже на целевом —
// на запасной (FALLBACK_LANG). targetLang читается из TranslationConfig — единственного места,
// куда позже начнёт писать кнопка настроек AI, без изменений здесь.
// export — переиспользуется кнопкой «Перевести» в AI-панели (AiPanelManager.ts) для двунаправленного
// перевода страницы тем же определением языка/направления, что и перевод выделения — без дублирования.
export async function resolveDirection(dir: Direction, text: string): Promise<{ src: string; tgt: string }> {
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
// export — переиспользуется кнопкой «Перевести» в AI-панели, тот же шаблон промпта, что у перевода
// выделения (не пишем новый).
export function buildPrompt(src: string, tgt: string, text: string): string {
  const S = LANG_NAME[src] ?? src; const T = LANG_NAME[tgt] ?? tgt
  return `Translate the following ${S} text to ${T}. Output ONLY the ${T} translation, ` +
    `with no explanations, notes, or additional commentary.\n\n${text}`
}

// Промпты для действий над выделением помимо перевода — отвечаем НА ЯЗЫКЕ ОРИГИНАЛА (не
// переводим), поэтому вместо src/tgt пары нужен только определённый язык текста (см. detectLang),
// который подставляется и как «respond in», и как контекст модели о самом тексте.
function buildActionPrompt(action: Exclude<AiAction, 'translate'>, lang: string, text: string): string {
  const L = LANG_NAME[lang] ?? lang
  if (action === 'simplify') {
    return `Rewrite the following ${L} text in simpler, plainer ${L}, keeping the same meaning. ` +
      `Respond in ${L}. Output ONLY the rewritten text, with no explanations or commentary.\n\n${text}`
  }
  if (action === 'explain') {
    return `Explain the following ${L} text: clarify its meaning, context, and any technical terms in ` +
      `plain language. Respond in ${L}. Output ONLY the explanation, with no additional commentary.\n\n${text}`
  }
  // summarize
  return `Summarize the following ${L} text as 2-3 key points (a short list). ` +
    `Respond in ${L}. Output ONLY the summary, with no additional commentary.\n\n${text}`
}

// Осмысляющим действиям (explain/simplify/summarize) нужен ВЕСЬ текст целиком одним куском — связный
// ответ на весь смысл, а не разбор по отдельному предложению (segmentsForAction для перевода НЕ
// используется — тот сегментируется в translate() как раньше, см. splitSentences выше). Резать
// осмысляющие на предложения и обрабатывать каждое отдельно — именно баг, который правим здесь:
// бессвязный разбор обрывков вместо ответа по всему тексту.
// Контекст-лимит: очень длинное выделение может не влезть в контекст Qwen целиком одним промптом —
// обрезаем с явным предупреждением в лог, а НЕ режем на независимые сегменты (это и был баг).
const ACTION_TEXT_MAX_CHARS = 8000

// Осмысляющим действиям (explain/simplify целиком переписывают текст, длина ответа сравнима со
// входом) — нужно больше, чем одному переводческому предложению. При ACTION_TEXT_MAX_CHARS=8000
// симв. (~2.5-3k токенов входа) и n_ctx=43520 (см. лог [gen] context ниже) 2000 токенов на выход
// оставляют input+output ~5k токенов — на порядок меньше n_ctx, разрыва по контексту не будет.
const TEXT_ACTION_MAX_TOKENS = 2000

function segmentsForAction(text: string): string[] {
  if (text.length > ACTION_TEXT_MAX_CHARS) {
    console.warn(`[ai-action] текст длиннее лимита (${text.length} > ${ACTION_TEXT_MAX_CHARS} симв.) — обрезаю, НЕ сегментирую`)
    return [text.slice(0, ACTION_TEXT_MAX_CHARS)]
  }
  return [text]
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
    // contextSize — не задаём явно (createContext сам подбирает "auto" под доступную VRAM и
    // trainContextSize модели), поэтому фактический n_ctx известен только ПОСЛЕ загрузки —
    // логируем сразу, чтобы не гадать, укладывается ли вход+выход в бюджет (см. [gen] limits выше).
    console.log(`[gen] context: n_ctx=${context.contextSize} trainContextSize=${model.trainContextSize}`)
    return performance.now() - t0
  })()
  return loadPromise
}

// ── Очередь Qwen-вызовов (диагностика "заход на умный поиск, п.4") ──────────────────────────
// contextSequence из ensureLoaded() — один-единственный слот KV-cache на весь процесс. До этой
// правки runPrompt (перевод/AI-действия) и runChatMessage (чат/быстрый перевод страницы, см.
// AiPanelManager.ts::quick-translate) звали его независимо, без всякой сериализации — конкурентный
// вызов на одном sequence либо портит генерацию, либо роняет исключение внутри node-llama-cpp.
// Тот же приём, что уже проверен на EmbeddingService.ts::embed (queueTail: Promise<unknown>
// chaining) — там нашли ровно этот класс гонки на общем worker'е. Хвост ОДИН на весь модуль и
// оборачивает ОБЕ точки входа (runPrompt И runChatMessage), а не только новую фичу поиска —
// иначе следующий добавленный потребитель Qwen снова пробил бы ту же гонку.
let qwenQueueTail: Promise<unknown> = Promise.resolve()

// Слот освобождается в .then(fn, fn) — вызывается СЛЕДУЮЩИМ независимо от исхода предыдущего
// (успех/ошибка/таймаут). Забытая ветка здесь означает подвешенную очередь для ВСЕХ AI-функций
// процесса разом (перевод/действия/чат), не только для одного вызывающего — цена ошибки та же,
// что была у embed(). queueTail сам гасит исход в .then(()=>undefined,()=>undefined), чтобы
// отклонение НЕ-последнего вызова в цепочке не всплыло необработанным rejection у самого хвоста
// (у него никогда нет своего .catch) — результат КОНКРЕТНОГО вызова всё равно возвращается через `result`.
function withQwenQueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = qwenQueueTail.then(fn, fn)
  qwenQueueTail = result.then(() => undefined, () => undefined)
  return result
}

// Диагностика скорости по этапам (см. задачу замера) — ASCII-теги [perf], кириллица в stdout
// превращается в кракозябры. Общий низкоуровневый вызов Qwen — единственное место в этом файле,
// где реально зовётся session.prompt() (кроме runChatMessage — у того своя, тоже через очередь
// выше); и перевод, и остальные AI-действия проходят через него (см. translateSegment/runSegmented
// ниже) — «разные промпты поверх одной трубы», не разные движки.
async function runPrompt(prompt: string, maxTokens: number, onChunk?: (text: string) => void): Promise<{ out: string; tokens: number }> {
  return withQwenQueue(() => runPromptQueued(prompt, maxTokens, onChunk))
}

async function runPromptQueued(prompt: string, maxTokens: number, onChunk?: (text: string) => void): Promise<{ out: string; tokens: number }> {
  const tSessionStart = performance.now()
  const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: '', chatWrapper: qwenChatWrapper })
  const tSessionCreated = performance.now()

  const inputTokens = model.tokenize(prompt).length
  const tTokenized = performance.now()

  // onToken — единственный способ увидеть МОМЕНТ первого сгенерированного токена, а не только
  // итог. Время до первого токена = вся служебная работа перед реальной генерацией (prefill
  // промпта в KV cache, чат-шаблон Qwen, что угодно скрытое внутри session.prompt()) — то самое
  // «session/context setup», которое иначе не отделить от честной генерации.
  let firstTokenAt: number | null = null
  let genTokenCount = 0
  // promptWithMeta вместо prompt() — тот же стриминг (onToken/onTextChunk), но плюс stopReason:
  // единственный надёжный способ отличить «модель ответила и остановилась сама (eogToken/
  // stopGenerationTrigger)» от «упёрлась в maxTokens и её оборвали» (см. лог [gen] stopped ниже) —
  // раньше это приходилось гадать по факту обрыва текста на полуслове.
  const { responseText, stopReason } = await session.promptWithMeta(prompt, {
    maxTokens,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onToken: (tokens: any[]) => {
      if (firstTokenAt === null) firstTokenAt = performance.now()
      genTokenCount += tokens.length
    },
    // onTextChunk — готовый декодированный текст по мере генерации, БЕЗ thinking-сегментов
    // (гарантия самой библиотеки, см. её .d.ts) — тот же тумблер, что и onToken выше, но текстом,
    // а не токенами. Пробрасываем наружу как есть: печатание в поповере на уровне генерации,
    // а не по сегментам (см. runSegmented ниже).
    onTextChunk: onChunk,
  })
  const rawOut = responseText.trim()
  const tGenDone = performance.now()

  const out = stripThinking(rawOut)
  const tokens = model.tokenize(out).length

  await sequence.clearHistory()
  const tCleared = performance.now()

  const setupMs = (firstTokenAt ?? tGenDone) - tTokenized
  const genMs = tGenDone - (firstTokenAt ?? tGenDone)
  console.log(
    `[perf] segment: sessionCreate=${(tSessionCreated - tSessionStart).toFixed(0)}ms ` +
    `promptBuild+tokenize=${(tTokenized - tSessionCreated).toFixed(0)}ms (inputTokens=${inputTokens}) ` +
    `setup/prefill(до 1-го токена)=${setupMs.toFixed(0)}ms ` +
    `generation=${genMs.toFixed(0)}ms (genTokens=${genTokenCount}, ${(genTokenCount / (genMs / 1000)).toFixed(1)} tok/s) ` +
    `clearHistory=${(tCleared - tGenDone).toFixed(0)}ms ` +
    `finalOutTokens=${tokens} (после stripThinking/trim, для справки с genTokens выше)`,
  )
  console.log(
    `[gen] stopped: ${stopReason === 'maxTokens' ? 'maxTokens reached' : `stop token (${stopReason})`} (limit=${maxTokens}, genTokens=${genTokenCount})`,
  )

  return { out, tokens }
}

// ── Умный поиск истории (Qwen-реранк top-k кандидатов от эмбеддинга) ────────────────────────
// Реюз runPrompt() выше — та же труба, что и перевод/AI-действия, никакого нового способа звать
// модель (см. HistorySearch.ts::searchHistorySmart, который строит кандидатов через cosine top-k
// и зовёт эту функцию). Через очередь (withQwenQueue внутри runPrompt) — умный поиск не может
// конкурировать с переводом/чатом за один и тот же sequence.
// score — cosine из searchHistorySemantic (0..1), уже отфильтрован по порогу ДО вызова этой
// функции (см. HistorySearch.ts::SMART_MIN_SCORE) — но сам по себе порог не спасает от
// generic-заголовков (короткие тайтлы вроде "Google Диск"/"ChatGPT" систематически дают высокий
// cosine независимо от смысла запроса, см. живой баг-репорт). Даём Qwen сам score как явный
// сигнал силы совпадения — без него модель судит вслепую по одному тексту заголовка/URL.
export interface RerankCandidate { id: number; title: string; url: string; score: number }

// 512 — с запасом на список номеров по 20 кандидатам (несколько цифр с запятыми), это не
// связный текст, а короткий структурированный ответ.
const RERANK_MAX_TOKENS = 512

function buildRerankPrompt(query: string, candidates: RerankCandidate[]): string {
  const list = candidates
    .map((c, i) => `${i}. [сходство ${c.score.toFixed(2)}] ${c.title || '(без названия)'} — ${c.url}`)
    .join('\n')
  return (
    `Пользователь ищет в истории браузера: "${query}"\n\n` +
    `Вот кандидаты (найдены по семантическому сходству заголовка/домена — сходство НЕ значит ` +
    `релевантность, короткие обобщённые заголовки вроде названия сервиса или его главной ` +
    `страницы часто получают высокое сходство с ЛЮБЫМ запросом, хотя по смыслу ни при чём):\n` +
    `${list}\n\n` +
    `Верни номера строк, которые ДЕЙСТВИТЕЛЬНО релевантны запросу по смыслу заголовка — не по ` +
    `формальному сходству. Будь строгим: если сомневаешься, не включай. Правильный ответ на ` +
    `запрос, для которого в истории ничего подходящего нет, — пустая строка, и это НОРМАЛЬНЫЙ ` +
    `исход, не ошибка. Номера через запятую, в порядке убывания релевантности (например: 2,0,5). ` +
    `Ответь ТОЛЬКО номерами или пустой строкой, без пояснений.`
  )
}

// Возвращает индексы candidates (0-based) в порядке релевантности по мнению модели — может быть
// короче/длиннее/в любом порядке относительно исходного cosine-ранжирования, может быть пустым
// массивом (не нашла релевантных). Не бросает по формату ответа — нераспознанные токены просто
// не попадают в результат (см. регэксп ниже); полный провал модели (исключение runPrompt) уходит
// наверх вызывающей стороне, которая уже решает про fallback (см. searchHistorySmart).
export async function rerankHistoryCandidates(query: string, candidates: RerankCandidate[]): Promise<number[]> {
  if (candidates.length === 0) return []
  // runPrompt САМ модель не грузит — обычно её загружает вызывающая сторона (runSegmented для
  // перевода/AI-действий, runChatMessageQueued для чата) до первого runPrompt/session.prompt().
  // Умный поиск — единственный потребитель runPrompt(), у которого нет такого "заботливого"
  // вызывающего кода вокруг — без явного ensureLoaded() здесь LlamaChatSession/model/sequence
  // ещё null при первом заходе (если юзер до этого ни разу не переводил/не чатился в этой
  // сессии) и `new LlamaChatSession(...)` внутри runPrompt падает с "is not a constructor".
  await ensureLoaded()
  const { out } = await runPrompt(buildRerankPrompt(query, candidates), RERANK_MAX_TOKENS)
  const seen = new Set<number>()
  const result: number[] = []
  for (const raw of out.match(/\d+/g) ?? []) {
    const i = Number(raw)
    if (i >= 0 && i < candidates.length && !seen.has(i)) { seen.add(i); result.push(i) }
  }
  return result
}

// Один сегмент — одно предложение (см. splitSentences). 300 токенов — запас x2-3 над типичной
// длиной перевода одного предложения (было 150 — обрывало редкие длинные/составные предложения
// на полуслове). Каждый сегмент — независимый прогон (своя LlamaChatSession, own history пустая),
// так что запас почти ничего не стоит по контексту: n_ctx=43520 (см. [gen] context в логе).
const TRANSLATE_SEGMENT_MAX_TOKENS = 300

// Общий цикл по сегментам — используется и переводом, и остальными AI-действиями. onChunk
// (опционально) зовётся по мере генерации текста ВНУТРИ каждого сегмента (токен-стриминг, см.
// runPrompt/onTextChunk выше) — для инкрементальной подачи в поповер (см. TranslatePopoverManager.ts),
// печатание по мере генерации, а не пачками по сегменту. Без колбэка (ручной тест-мост
// translateTestBridge.ts) поведение как раньше — только финальный результат.
async function runSegmented(
  segments: string[],
  buildSegPrompt: (segment: string) => string,
  maxTokens: number,
  onChunk?: (text: string) => void,
): Promise<{ out: string; ms: number; tokPerSec: number; loadMs: number | null }> {
  const tTotalStart = performance.now()
  const wasLoaded = loadPromise !== null
  const loadMs = await ensureLoaded()
  console.log(`[perf] segments: ${segments.length}`)

  const t0 = performance.now()
  const outs: string[] = []
  let totalTokens = 0
  for (let i = 0; i < segments.length; i++) {
    // Разделитель между предложениями перевода: сам сегмент стримится «сырыми» кусками без
    // пробела на границе (onTextChunk отдаёт текст как есть) — пробел между соседними сегментами
    // добавляем явно один раз здесь, а не полагаемся, что модель сама его сгенерирует.
    if (i > 0) onChunk?.(' ')
    const { out, tokens } = await runPrompt(buildSegPrompt(segments[i]!), maxTokens, onChunk)
    outs.push(out)
    totalTokens += tokens
  }
  const ms = performance.now() - t0
  console.log(`[perf] total: ${(performance.now() - tTotalStart).toFixed(0)}ms (loadMs=${wasLoaded ? 'null(тёплая)' : loadMs.toFixed(0) + 'ms'})`)

  return { out: outs.join(' '), ms, tokPerSec: totalTokens / (ms / 1000), loadMs: wasLoaded ? null : loadMs }
}

// onChunk — см. runSegmented выше. Необязательный параметр — вызовы без него (ручной тест-мост
// translateTestBridge.ts) продолжают работать как раньше, получая только финальный TranslateResult.
export async function translate(
  text: string,
  dir: Direction = 'auto',
  onChunk?: (text: string) => void,
): Promise<TranslateResult> {
  try {
    // Направление резолвим один раз по всему тексту — не по каждому предложению отдельно.
    const tDetectStart = performance.now()
    const { src, tgt } = await resolveDirection(dir, text)
    console.log(`[perf] language detect (franc): ${(performance.now() - tDetectStart).toFixed(0)}ms`)
    const dirUsed: ResolvedDirection = `${src}->${tgt}`
    const segments = splitSentences(text)

    const { out, ms, tokPerSec, loadMs } = await runSegmented(segments, (seg) => buildPrompt(src, tgt, seg), TRANSLATE_SEGMENT_MAX_TOKENS, onChunk)

    console.log(
      `[translate] [${dirUsed}] ${segments.length} seg(s): "${text}" -> "${out}" ` +
      `(${ms.toFixed(0)}ms, ${tokPerSec.toFixed(1)} tok/s)`,
    )

    return { ok: true, out, dirUsed, ms, tokPerSec, loadMs }
  } catch (e) {
    console.error('[translate] error:', e)
    return { ok: false, error: String(e) }
  }
}

// Единая точка входа для ВСЕХ AI-действий над выделением (перевод/выжимка/пересказ/объяснение) —
// то, что зовёт TranslatePopoverManager.ts. 'translate' делегирует в translate() как есть (та же
// функция, то же поведение, никакого дублирования) и просто помечает результат action'ом; остальные
// действия отвечают на языке оригинала (detectLang, не resolveDirection — направления нет).
// Добавить новое действие = добавить сюда промпт (buildActionPrompt) и пункт меню в TabManager.ts.
export async function runAiAction(
  action: AiAction,
  text: string,
  onChunk?: (text: string) => void,
): Promise<AiActionOutcome> {
  if (action === 'translate') {
    const result = await translate(text, 'auto', onChunk)
    return result.ok ? { ...result, action } : result
  }

  try {
    const tDetectStart = performance.now()
    const lang = await detectLang(text)
    console.log(`[perf] language detect (franc): ${(performance.now() - tDetectStart).toFixed(0)}ms`)
    const segments = segmentsForAction(text)

    // Один связный ответ на весь текст (explain/simplify — пересказ длиной с оригинал; summarize —
    // компактнее, но всё равно длиннее одного переводческого предложения) — см. TEXT_ACTION_MAX_TOKENS
    // выше (модульная константа, не локальная — нужна и здесь, и в стартовом логе [gen] limits).
    const { out, ms, tokPerSec, loadMs } = await runSegmented(segments, (seg) => buildActionPrompt(action, lang, seg), TEXT_ACTION_MAX_TOKENS, onChunk)

    console.log(
      `[ai-action] [${action}][${lang}] ${segments.length} seg(s): "${text.slice(0, 80)}" -> "${out.slice(0, 200)}" ` +
      `(${ms.toFixed(0)}ms, ${tokPerSec.toFixed(1)} tok/s)`,
    )

    return { ok: true, out, action, ms, tokPerSec, loadMs }
  } catch (e) {
    console.error('[ai-action] error:', e)
    return { ok: false, error: String(e) }
  }
}

// ── Чат в AI-панели (Заход 2, привязка к вкладке — Заход 3) ─────────────────────────────────
// Отдельный вход поверх ТОГО ЖЕ движка (llama/model/context/sequence из ensureLoaded() выше) —
// НЕ поднимает вторую копию модели (та занимает ~6.81ГБ из 8ГБ VRAM, вторая не влезет). Общий
// module-level sequence используется и переводом/AI-действиями (runPrompt/runSegmented), и здесь —
// как и они, каждый ход завершается sequence.clearHistory(), чтобы не оставить чат «грязным»
// контекстом для следующего вызова (перевода/действия/следующего хода чата) — платим повторным
// prefill всей беседы на каждый ход вместо переиспользования KV-кэша между ходами, зато не рискуем
// путаницей между независимыми фичами, которые делят одну и ту же low-level sequence. Один движок,
// много контекстов: history беседы теперь приходит СНАРУЖИ (по одному массиву на вкладку, хранит
// AiPanelManager.ts), а не живёт здесь module-level переменной — раньше беседа была одна на процесс,
// теперь вызывающая сторона решает, чья это история.
export type ChatOutcome =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { ok: true; out: string; history: any[]; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string }

const CHAT_SYSTEM_PROMPT = 'You are a helpful, concise assistant built into a web browser. Respond in the same language the user writes in.'
// Было 700 — обрывало развёрнутые ответы и (особенно) кнопку «Перевести страницу» в AI-панели
// (AiPanelManager.ts::quick-translate идёт через ЭТОТ ЖЕ runChatMessage, лимит общий): вход там
// до PAGE_TEXT_MAX_CHARS=28000 симв. (~8-10k токенов, см. её же комментарий), а выход обрезался на
// 700. n_ctx=43520 (см. [gen] context в логе) — под первый ход (страница ~10k + ответ) остаётся
// с запасом ~десятки тысяч токенов на историю диалога (см. комментарий у PAGE_TEXT_MAX_CHARS),
// поэтому 3072 на выход всё ещё далеко от переполнения, но уже покрывает развёрнутый ответ/
// перевод абзаца/саммари страницы целиком. Не задрано до предела n_ctx специально: длиннее —
// ощутимо дольше молотит при вероятном будущем зависании (degenerate loop, см. бэклог), а
// диалог всё равно постепенно съедает контекст сам по себе за счёт растущей истории.
const CHAT_MAX_TOKENS = 3072

// Единственное место, где видно ВСЕ лимиты генерации сразу — иначе они разбросаны по функциям и
// невозможно быстро сверить с бюджетом контекста. n_ctx появится отдельной строкой после загрузки
// модели (см. [gen] context в ensureLoaded) — здесь он ещё неизвестен.
console.log(
  `[gen] limits: translateSegment=${TRANSLATE_SEGMENT_MAX_TOKENS} action=${TEXT_ACTION_MAX_TOKENS} chat=${CHAT_MAX_TOKENS} (максимум токенов на выход, на прогон)`,
)

// Через ту же очередь, что и runPrompt (см. withQwenQueue выше) — свой, отдельный от runPrompt
// вызов session.promptWithMeta() на ОБЩЕМ sequence, иначе одновременный чат + перевод/AI-действие
// снова конкурировали бы за один слот KV-cache в обход очереди.
export async function runChatMessage(
  userText: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[],
  onChunk?: (text: string) => void,
): Promise<ChatOutcome> {
  return withQwenQueue(() => runChatMessageQueued(userText, history, onChunk))
}

async function runChatMessageQueued(
  userText: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[],
  onChunk?: (text: string) => void,
): Promise<ChatOutcome> {
  try {
    const tTotalStart = performance.now()
    const wasLoaded = loadPromise !== null
    const loadMs = await ensureLoaded()

    const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: CHAT_SYSTEM_PROMPT, chatWrapper: qwenChatWrapper })
    session.setChatHistory(history) // предыдущие ходы ЭТОЙ вкладки (пусто на первом сообщении/новой странице)

    const t0 = performance.now()
    // promptWithMeta — см. комментарий в runPrompt() выше: тот же повод, stopReason нужен и здесь
    // (чат — самый частый источник обрывов на maxTokens, включая «Перевести страницу», которая
    // тоже идёт через этот вызов, см. AiPanelManager.ts::quick-translate).
    const { responseText, stopReason } = await session.promptWithMeta(userText, {
      maxTokens: CHAT_MAX_TOKENS,
      onTextChunk: onChunk,
    })
    const rawOut = responseText.trim()
    const ms = performance.now() - t0

    const out = stripThinking(rawOut)
    const tokens = model.tokenize(out).length

    // getChatHistory() уже включает и этот новый user-ход, и model-ответ — вызывающая сторона
    // сохраняет это как новую базу для следующего сообщения ЭТОЙ ЖЕ вкладки.
    const newHistory = session.getChatHistory()

    await sequence.clearHistory() // та же гигиена, что и в runPrompt — сброс физического KV-кэша

    console.log(
      `[chat] "${userText.slice(0, 80)}" -> "${out.slice(0, 200)}" ` +
      `(${ms.toFixed(0)}ms, ${(tokens / (ms / 1000)).toFixed(1)} tok/s, всего=${(performance.now() - tTotalStart).toFixed(0)}ms)`,
    )
    console.log(
      `[gen] stopped: ${stopReason === 'maxTokens' ? 'maxTokens reached' : `stop token (${stopReason})`} (limit=${CHAT_MAX_TOKENS}, outTokens=${tokens})`,
    )

    return { ok: true, out, history: newHistory, ms, tokPerSec: tokens / (ms / 1000), loadMs: wasLoaded ? null : loadMs }
  } catch (e) {
    console.error('[chat] error:', e)
    return { ok: false, error: String(e) }
  }
}
