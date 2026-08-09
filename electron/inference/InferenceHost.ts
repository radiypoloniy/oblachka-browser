// Сторона main: тонкий клиент к процессу инференса (worker.ts). Ничего не знает ни про промпты,
// ни про node-llama-cpp — только про трубу.
//
// ⚠️ Инвариант, ради которого всё это и делалось: **node-llama-cpp импортируется РОВНО в одном
// процессе, и это не main**. Как только его затянет обратно (хоть ради «дешёвого» getVramState),
// главный процесс снова начнёт замирать вместе с генерацией — замер до выноса давал 15.4 с
// блокировок за 15 с наблюдения, после выноса 0 мс. Поэтому и замер видеопамяти (HardwareInfo.ts)
// ходит сюда же, а не заводит свой бэкенд.
import { app, utilityProcess } from 'electron'
import fs from 'node:fs'
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
  for (const cb of goneListeners) cb()
}

// worker.js лежит рядом, в dist-electron/electron/inference/. В упакованной сборке этот путь
// указывает ВНУТРЬ app.asar, а ребёнок оттуда тянет нативные библиотеки node-llama-cpp, которые
// внутри архива не грузятся в принципе (потому они и в asarUnpack). Поэтому в упакованном виде
// берём распакованную копию — она кладётся туда же тем же asarUnpack (см. electron-builder.yml).
// Проверка существования обязательна: без неё ошибка в конфиге сборки проявилась бы только у
// пользователя и выглядела бы как «AI молча не работает».
function workerEntryPath(): string {
  const inAsar = path.join(__dirname, 'worker.js')
  if (!app.isPackaged) return inAsar
  const unpacked = inAsar.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  if (fs.existsSync(unpacked)) return unpacked
  console.warn('[gen] распакованной копии worker.js нет — пробую путь внутрь asar:', inAsar)
  return inAsar
}

function spawn(): Promise<void> {
  if (ready) return ready
  ready = new Promise<void>((resolve, reject) => {
    const entry = workerEntryPath()
    const proc = utilityProcess.fork(entry, [], {
      serviceName: 'oblako-inference', // под этим именем процесс видно в диспетчере задач
      stdio: 'inherit',                // логи [gen]/[perf] по-прежнему идут в общий вывод
    })
    child = proc

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

async function call<T>(req: WithoutId<InferRequest>, onChunk?: (text: string) => void): Promise<T> {
  await spawn()
  const id = nextId++
  const p = new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onChunk })
  })
  child?.postMessage({ ...req, id } as InferRequest)
  return p
}

export async function loadModel(
  modelPath: string, modelId: string, label: string, contextMaxTokens: number,
): Promise<LoadedInfo> {
  const info = await call<LoadedInfo>({ kind: 'load', modelPath, modelId, label, contextMaxTokens })
  loadedModelId = info.modelId
  return info
}

export async function unloadModel(): Promise<void> {
  if (!child) return // процесса нет — выгружать нечего, и поднимать его ради этого незачем
  await call<void>({ kind: 'unload' })
  loadedModelId = null
}

export function runPrompt(prompt: string, maxTokens: number, onChunk?: (text: string) => void): Promise<PromptResult> {
  return call<PromptResult>({ kind: 'prompt', prompt, maxTokens, stream: !!onChunk }, onChunk)
}

export function runChat(
  userText: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[],
  maxTokens: number,
  systemPrompt: string,
  onChunk?: (text: string) => void,
): Promise<ChatResult> {
  return call<ChatResult>({ kind: 'chat', userText, history, maxTokens, systemPrompt, stream: !!onChunk }, onChunk)
}

export function getVram(): Promise<VramInfo> {
  return call<VramInfo>({ kind: 'vram' })
}

// Остановить процесс при выходе из приложения. Дожидаться нечего: модель живёт только в его
// памяти, на диске от неё ничего не остаётся.
export function shutdownInference(): void {
  if (!child) return
  child.kill()
  teardown('выход из приложения')
}
