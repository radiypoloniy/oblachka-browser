// Сторона main: тонкий клиент к процессу инференса (worker.ts). Ничего не знает ни про промпты,
// ни про node-llama-cpp — только про трубу.
//
// ⚠️ Инвариант, ради которого всё это и делалось: **node-llama-cpp импортируется РОВНО в одном
// процессе, и это не main**. Как только его затянет обратно (хоть ради «дешёвого» getVramState),
// главный процесс снова начнёт замирать вместе с генерацией — замер до выноса давал 15.4 с
// блокировок за 15 с наблюдения, после выноса 0 мс. Поэтому и замер видеопамяти (HardwareInfo.ts)
// ходит сюда же, а не заводит свой бэкенд.
import { utilityProcess } from 'electron'
import path from 'node:path'
import type { UtilityProcess } from 'electron'
import type { InferRequest, InferResponse, LoadedInfo, PromptResult, ChatResult, VramInfo } from './protocol'

// Отказ, который переживает границу процессов вместе с кодом (LOAD_FAILED и т.п.) — TranslationService
// приводит его к своему ModelError, а панель по коду решает, показывать ли кнопку в настройки.
export class InferenceError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

let child: UtilityProcess | null = null
let ready: Promise<void> | null = null
let nextId = 1
const pending = new Map<number, {
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
  onChunk?: (text: string) => void
}>()

// Загружена ли модель ПРЯМО СЕЙЧАС — зеркало состояния ребёнка. Синхронный ответ нужен гейтам
// вроде isModelWarm() (подсказки при наборе молчат на холодной модели), а спрашивать процесс
// ради булева значения на каждый ввод символа — не вариант.
let loadedModelId: string | null = null

export function getLoadedModelIdMirror(): string | null {
  return loadedModelId
}

// Свободная видеопамять сразу после загрузки модели (замер в воркере, см. worker.ts). null —
// модели нет, карты нет либо замер не удался. Спрашивает политика выгрузки (ModelIdleWatcher).
let loadedVramFreeAtLoad: number | null = null

export function getVramFreeAtLoad(): number | null {
  return loadedVramFreeAtLoad
}

// ⚠️ Падение ребёнка — штатный (пусть и редкий) исход: OOM видеопамяти, битый GGUF, отказ драйвера.
// Раньше это уносило всё приложение. Теперь: висящие запросы получают внятный отказ, состояние
// сбрасывается, и СЛЕДУЮЩИЙ запрос поднимет процесс заново — сам по себе, без перезапуска браузера.
// Кого разбудить, когда процесс инференса умер. ⚠️ Без этого сигнала main остался бы уверен, что
// модель загружена (его loadPromise уже разрешён), и следующий запрос ушёл бы в НОВЫЙ, пустой
// процесс — тот попытался бы генерировать без модели. Подписчик (TranslationService) сбрасывает
// свою память о загрузке, и ближайший вызов честно грузит модель заново.
const goneListeners: Array<() => void> = []
export function onInferenceProcessGone(cb: () => void): void {
  goneListeners.push(cb)
}

function teardown(reason: string): void {
  const message = `Процесс локального ИИ остановился (${reason}). Следующий запрос запустит его заново.`
  for (const [, p] of pending) p.reject(new InferenceError(message, 'LOAD_FAILED'))
  pending.clear()
  child = null
  ready = null
  loadedModelId = null
  loadedVramFreeAtLoad = null
  for (const cb of goneListeners) cb()
}

// ⚠️ Точку входа НЕ НАДО распаковывать из asar, и это проверено на упакованной сборке: сначала
// worker.js был вынесен в app.asar.unpacked «поближе к нативным библиотекам», и процесс инференса
// стал падать с кодом 1 сразу при запуске. Причина простая и общая: распакованный файл ищет своих
// соседей (`../LlamaBackend`) РЯДОМ С СОБОЙ, а они остались в архиве — то есть распаковка одного
// файла рвёт ему все относительные импорты. Нативные библиотеки node-llama-cpp тут ни при чём:
// их находит сам пакет, и он в asarUnpack целиком (см. electron-builder.yml).
function workerEntryPath(): string {
  return path.join(__dirname, 'worker.js')
}

function spawn(): Promise<void> {
  if (ready) return ready
  ready = new Promise<void>((resolve, reject) => {
    const entry = workerEntryPath()
    const proc = utilityProcess.fork(entry, [], {
      serviceName: 'oblako-inference', // под этим именем процесс видно в диспетчере задач
      // ⚠️ 'pipe', а НЕ 'inherit'. С 'inherit' логи процесса инференса видны только в dev: у
      // упакованного GUI-приложения наследовать нечего, и весь вывод — свой [gen]/[perf] и чужие
      // предупреждения node-llama-cpp о том, какой бэкенд не поднялся, — пропадал молча. Ровно
      // поэтому «в установщике ИИ считает на процессоре» пришлось искать вслепую. Перекладываем
      // руками в общий вывод, с пометкой процесса.
      stdio: 'pipe',
    })
    child = proc
    const relay = (stream: NodeJS.ReadableStream | null, write: (s: string) => void): void => {
      stream?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split(/\r?\n/)) if (line) write(`[inference] ${line}`)
      })
    }
    relay(proc.stdout, (s) => console.log(s))
    relay(proc.stderr, (s) => console.error(s))

    proc.on('message', (data: InferResponse) => {
      if ('ready' in data) { resolve(); return }
      const p = pending.get(data.id)
      if (!p) return
      if ('chunk' in data) { p.onChunk?.(data.chunk); return }
      pending.delete(data.id)
      if (data.ok) p.resolve(data.value)
      else p.reject(new InferenceError(data.error.message, data.error.code))
    })

    proc.on('exit', (code) => {
      console.error(`[gen] процесс инференса завершился, код ${code}`)
      const wasReady = ready
      teardown(`код ${code}`)
      // Упал ДО сигнала готовности — значит и сам spawn() не состоялся: отказываем ждущему.
      if (wasReady) reject(new InferenceError('Не удалось запустить процесс локального ИИ', 'LOAD_FAILED'))
    })
  })
  return ready
}

// Раздающий Omit: обычный Omit по объединению схлопнул бы варианты в один тип с общими полями,
// и вызов с полем конкретного варианта («prompt») перестал бы проходить проверку.
type WithoutId<T> = T extends { id: number } ? Omit<T, 'id'> : never

async function call<T>(req: WithoutId<InferRequest>, onChunk?: (text: string) => void, abort?: AbortSignal): Promise<T> {
  await spawn()
  const id = nextId++
  const p = new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onChunk })
  })
  child?.postMessage({ ...req, id } as InferRequest)
  // ⚠️ Сам AbortSignal через границу процессов не уедет — это объект. Уезжает СОБЫТИЕ: хост
  // слушает сигнал и шлёт отдельное сообщение с id прерываемого запроса. Уже прерванный сигнал
  // обрабатывается тем же путём (addEventListener на aborted зовёт обработчик синхронно нет —
  // поэтому проверяем явно), иначе «стоп до старта» терялся бы.
  if (abort) {
    const send = () => child?.postMessage({ kind: 'abort', target: id, id: nextId++ } as InferRequest)
    if (abort.aborted) send();
    else abort.addEventListener('abort', send, { once: true })
  }
  return p
}

export async function loadModel(
  modelPath: string, modelId: string, label: string, contextMaxTokens: number,
): Promise<LoadedInfo> {
  const info = await call<LoadedInfo>({ kind: 'load', modelPath, modelId, label, contextMaxTokens })
  loadedModelId = info.modelId
  loadedVramFreeAtLoad = info.vramFreeAtLoad
  return info
}

export async function unloadModel(): Promise<void> {
  if (!child) return // процесса нет — выгружать нечего, и поднимать его ради этого незачем
  await call<void>({ kind: 'unload' })
  loadedModelId = null
  loadedVramFreeAtLoad = null
}

export function runPrompt(
  prompt: string,
  maxTokens: number,
  onChunk?: (text: string) => void,
  schema?: unknown,
  abort?: AbortSignal,
): Promise<PromptResult> {
  return call<PromptResult>({ kind: 'prompt', prompt, maxTokens, stream: !!onChunk, schema }, onChunk, abort)
}

export function runChat(
  userText: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[],
  maxTokens: number,
  systemPrompt: string,
  onChunk?: (text: string) => void,
  abort?: AbortSignal,
): Promise<ChatResult> {
  return call<ChatResult>({ kind: 'chat', userText, history, maxTokens, systemPrompt, stream: !!onChunk }, onChunk, abort)
}

export function getVram(): Promise<VramInfo> {
  return call<VramInfo>({ kind: 'vram' })
}

// Погасить ПРОСТАИВАЮЩИЙ процесс инференса, чтобы следующий запрос поднял новый.
//
// ⚠️ Единственный способ переспросить железо. node-llama-cpp кэширует поднятый бэкенд на весь
// процесс (LlamaBackend.ts::initPromise), поэтому «GPU не найден» — приговор до конца жизни
// процесса, а не до следующего вызова. Отсюда и условие: только когда модель НЕ загружена. С
// загруженной моделью перезапуск стоил бы человеку выгруженной из памяти модели и ~30 секунд
// на повторную загрузку — ради перепроверки, которая ему в этот момент ничего не даёт.
// Возвращает true, если процесс действительно погашен.
export function restartInferenceIfIdle(): boolean {
  if (!child || loadedModelId !== null) return false
  child.kill()
  teardown('перепроверка железа')
  return true
}

// Остановить процесс при выходе из приложения. Дожидаться нечего: модель живёт только в его
// памяти, на диске от неё ничего не остаётся.
export function shutdownInference(): void {
  if (!child) return
  child.kill()
  teardown('выход из приложения')
}

// pid процесса инференса — нужен диспетчеру задач, чтобы отличить строку модели от прочих
// служебных процессов. ⚠️ Именно pid, а не «есть ли модель»: getAppMetrics говорит на языке
// процессов, и сшивать их надо тем же ключом, каким они себя называют.
export function getInferencePid(): number | null {
  return child?.pid ?? null
}
