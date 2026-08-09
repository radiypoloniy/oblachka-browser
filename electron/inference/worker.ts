// Дочерний процесс инференса (Electron utilityProcess). ЕДИНСТВЕННОЕ место в приложении, где
// импортируется node-llama-cpp и живут model/context/sequence.
//
// ⚠️ Зачем вообще отдельный процесс. Нативные вызовы llama.cpp не уступают event-loop того
// процесса, в котором сделаны. Пока модель грузилась в main, замер пингом main из хрома давал
// 15.4 секунды блокировок за 15 секунд наблюдения (Qwen3.5 4B) — то есть первое обращение к AI
// подвешивало ВЕСЬ браузер: вкладки, навигацию, окно. Тот же прогон через utilityProcess блокирует
// main на 0 мс (спайк перед реализацией: загрузка 26 с, контекст, генерация — ноль всплесков).
// Второе следствие, не менее важное для браузера: падение llama.cpp (OOM видеопамяти, битый GGUF)
// теперь уносит только этот процесс, а не приложение целиком.
//
// ⚠️ Здесь НЕТ ни одного промпта и ни одного разбора ответа — они остались в TranslationService.ts.
// Через границу процессов ходят только «строка на вход, строка на выход»: промпты часто правятся
// по итогам замеров, и держать их рядом с движком значило бы дёргать процессную обвязку из-за
// каждой формулировки.
import { getLlamaBackend, getNlc } from '../LlamaBackend'
import type { InferRequest, InferResponse, LoadedInfo, PromptResult, ChatResult, VramInfo } from './protocol'

// process.parentPort есть только в utilityProcess — в обычном Node его нет, отсюда каст.
const port = (process as NodeJS.Process & { parentPort: Electron.ParentPort }).parentPort

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
let chatWrapper: any = null
let loadedModelId: string | null = null
let loadedPath: string | null = null

// Настройки QwenChatWrapper, которые применяются, ТОЛЬКО если резолвер сам решит, что загруженная
// модель — Qwen. thoughts:'discourage' давит reasoning (без него в панель лезут <think>-блоки),
// variation:'3.5' — актуальный чат-шаблон линейки.
const QWEN_CHAT_WRAPPER_SETTINGS = { variation: '3.5' as const, thoughts: 'discourage' as const }

// Защита от утечки reasoning в ответ: thinking у Qwen3.5 по умолчанию off и обёртка просит
// 'discourage', но это вывод живых прогонов, а не гарантия. Режем здесь, у источника.
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

async function load(modelPath: string, modelId: string, label: string, contextMaxTokens: number): Promise<LoadedInfo> {
  // Уже загружена ТА ЖЕ модель — повтор не нужен: main дедуплицирует свои вызовы, но после
  // перезапуска упавшего процесса сюда может прийти вторая загрузка того же файла.
  if (model !== null && loadedPath === modelPath) {
    return { loadMs: 0, modelId: loadedModelId ?? modelId, nCtx: context.contextSize, gpu: String(llama?.gpu ?? '') }
  }
  const t0 = Date.now()
  const nlc = await getNlc()
  llama = await getLlamaBackend()
  console.log(`[gen] llama backend: gpu=${llama.gpu}`)
  LlamaChatSession = nlc.LlamaChatSession

  // Flash attention + 8-битный (Q8_0) KV-кэш: примерно вдвое меньше VRAM под контекст при потере
  // качества около нуля. Квантованный KV в llama.cpp работает только с flash attention — в паре.
  model = await llama.loadModel({
    modelPath,
    defaultContextFlashAttention: true,
    experimentalDefaultContextKvCacheKeyType: 'Q8_0',
    experimentalDefaultContextKvCacheValueType: 'Q8_0',
  })
  loadedModelId = modelId
  loadedPath = modelPath

  // Обёртка чата определяется по РЕАЛЬНО загруженной модели (метаданные/токенизатор/BOS), а не
  // жёстко под Qwen. Форма вызова — options-объект: она позволяет отличить «определил» от «не
  // определил вовсе» (позиционная форма всегда возвращает непустую обёртку) и не подсунуть молча
  // чужой шаблон.
  const resolved = nlc.resolveChatWrapper({
    bosString: model.tokens.bosString,
    filename: model.filename,
    fileInfo: model.fileInfo,
    tokenizer: model.tokenizer,
    customWrapperSettings: { qwen: QWEN_CHAT_WRAPPER_SETTINGS },
  })
  if (resolved != null) {
    chatWrapper = resolved
  } else {
    const jinjaTemplate = model.fileInfo?.metadata?.tokenizer?.chat_template
    console.warn(
      `[gen] resolveChatWrapper не смог определить обёртку для модели "${label}" — использую ` +
      `${jinjaTemplate ? 'JinjaTemplateChatWrapper (шаблон из GGUF)' : 'GeneralChatWrapper (нет даже Jinja-шаблона)'}`,
    )
    chatWrapper = jinjaTemplate != null
      ? new nlc.JinjaTemplateChatWrapper({ tokenizer: model.tokenizer, template: jinjaTemplate })
      : new nlc.GeneralChatWrapper()
  }
  console.log(`[gen] chat wrapper: ${chatWrapper.constructor.name}`)

  // Потолок контекста приходит из main (см. CONTEXT_MAX_TOKENS в TranslationService.ts — там же
  // разбор, почему «auto» бил по маленьким моделям). Форма { max } — именно потолок: на слабой
  // карте «auto» вправе выдать меньше, жёсткое число привело бы к отказу загрузки.
  context = await model.createContext({ sequences: 1, contextSize: { max: contextMaxTokens } })
  sequence = context.getSequence()
  console.log(`[gen] context: n_ctx=${context.contextSize} trainContextSize=${model.trainContextSize}`)
  return { loadMs: Date.now() - t0, modelId, nCtx: context.contextSize, gpu: String(llama.gpu) }
}

async function unload(): Promise<void> {
  if (model === null) {
    console.log('[gen] unload: модель уже выгружена — no-op')
    return
  }
  // ИМЕННО в этом порядке: context (владеет sequence и KV-кэшем) — до model. Сам llama-бэкенд НЕ
  // трогаем: он закэширован в LlamaBackend.ts, и его же использует замер видеопамяти.
  await context.dispose()
  await model.dispose()
  model = null
  context = null
  sequence = null
  chatWrapper = null
  loadedModelId = null
  loadedPath = null
  console.log('[gen] модель выгружена из VRAM')
}

// Один прогон без истории. Стриминг уходит наверх отдельными сообщениями с тем же id.
async function runPrompt(id: number, prompt: string, maxTokens: number, stream: boolean): Promise<PromptResult> {
  const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: '', chatWrapper })
  const inputTokens = model.tokenize(prompt).length
  const tStart = Date.now()
  let firstTokenAt: number | null = null
  let genTokenCount = 0
  const { responseText, stopReason } = await session.promptWithMeta(prompt, {
    maxTokens,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onToken: (tokens: any[]) => {
      if (firstTokenAt === null) firstTokenAt = Date.now()
      genTokenCount += tokens.length
    },
    onTextChunk: stream ? (text: string) => port.postMessage({ id, chunk: text } satisfies InferResponse) : undefined,
  })
  const out = stripThinking(responseText.trim())
  const tokens = model.tokenize(out).length
  // Та же гигиена, что была в main: сброс физического KV-кэша между прогонами.
  await sequence.clearHistory()

  const tEnd = Date.now()
  const setupMs = (firstTokenAt ?? tEnd) - tStart
  const genMs = tEnd - (firstTokenAt ?? tEnd)
  console.log(
    `[perf] segment: inputTokens=${inputTokens} setup/prefill=${setupMs}ms ` +
    `generation=${genMs}ms (genTokens=${genTokenCount}) finalOutTokens=${tokens}`,
  )
  console.log(
    `[gen] stopped: ${stopReason === 'maxTokens' ? 'maxTokens reached' : `stop token (${stopReason})`} ` +
    `(limit=${maxTokens}, genTokens=${genTokenCount})`,
  )
  return { out, tokens, stopReason: String(stopReason) }
}

// Диалог: история приходит и уходит как обычный JSON (её и хранят как JSON — см. HubChatManager).
async function runChat(
  id: number,
  userText: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[],
  maxTokens: number,
  systemPrompt: string,
  stream: boolean,
): Promise<ChatResult> {
  const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt, chatWrapper })
  session.setChatHistory(history)
  const t0 = Date.now()
  const { responseText, stopReason } = await session.promptWithMeta(userText, {
    maxTokens,
    onTextChunk: stream ? (text: string) => port.postMessage({ id, chunk: text } satisfies InferResponse) : undefined,
  })
  const ms = Date.now() - t0
  const out = stripThinking(responseText.trim())
  const tokens = model.tokenize(out).length
  // getChatHistory() уже включает и новый ход человека, и ответ модели — это новая база для
  // следующего сообщения той же вкладки.
  const newHistory = session.getChatHistory()
  await sequence.clearHistory()
  console.log(
    `[gen] stopped: ${stopReason === 'maxTokens' ? 'maxTokens reached' : `stop token (${stopReason})`} ` +
    `(limit=${maxTokens}, outTokens=${tokens})`,
  )
  return { out, history: newHistory, ms, tokens }
}

async function vram(): Promise<VramInfo> {
  const backend = await getLlamaBackend()
  const state = await backend.getVramState()
  return { total: state.total, free: state.free, gpu: String(backend.gpu) }
}

async function handle(req: InferRequest): Promise<unknown> {
  switch (req.kind) {
    case 'load': return load(req.modelPath, req.modelId, req.label, req.contextMaxTokens)
    case 'unload': return unload()
    case 'prompt': return runPrompt(req.id, req.prompt, req.maxTokens, req.stream)
    case 'chat': return runChat(req.id, req.userText, req.history, req.maxTokens, req.systemPrompt, req.stream)
    case 'vram': return vram()
  }
}

port.on('message', (e: { data: InferRequest }) => {
  const req = e.data
  void handle(req).then(
    (value) => port.postMessage({ id: req.id, ok: true, value } satisfies InferResponse),
    (err: unknown) => {
      // Код ошибки (LOAD_FAILED и т.п.) переживает границу процессов: панель показывает по нему
      // осмысленный текст и кнопку в настройки, а String(e) выглядел бы как «Error: ...» с потрохами.
      const code = (err as { code?: string } | null)?.code
      const message = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err)
      port.postMessage({ id: req.id, ok: false, error: { code, message } } satisfies InferResponse)
    },
  )
})

// Признак жизни: main ждёт его, прежде чем слать первый запрос (см. InferenceHost.ts).
port.postMessage({ id: 0, ready: true } satisfies InferResponse)
