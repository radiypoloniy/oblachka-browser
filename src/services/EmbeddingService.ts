// Чтобы переключить на фолбэк: ACTIVE_MODEL = 'minilm'
interface ModelConfig {
  modelId: string
  dtype:   string
  mrlDims: number | null
  device:  'auto' | 'webgpu' | 'wasm'
}

const MODELS: Record<string, ModelConfig> = {
  embeddinggemma: {
    modelId: 'onnx-community/embeddinggemma-300m-ONNX',
    dtype:   'q4f16',
    mrlDims: 256,    // MRL-срез: первые 256 из 768 + L2-ренорм в worker
    device:  'wasm', // q4f16 на WebGPU даёт NaN (f16-overflow) — WASM стабилен
  },
  // q4 (fp32-активации): нет f16-overflow на WebGPU, корректный русский.
  // Требует: node scripts/download-model.mjs --q4 (197MB)
  // Для теста: поменяй ACTIVE_MODEL на 'embeddinggemma-q4', пересобери.
  'embeddinggemma-q4': {
    modelId: 'onnx-community/embeddinggemma-300m-ONNX',
    dtype:   'q4',
    mrlDims: 256,
    device:  'auto',
  },
  minilm: {
    modelId: 'Xenova/all-MiniLM-L6-v2',
    dtype:   'q8',
    mrlDims: null,
    device:  'wasm',
  },
}

const ACTIVE_MODEL: keyof typeof MODELS = 'embeddinggemma'

type ConfigureMsg = {
  type:    'configure'
  modelId: string
  dtype:   string
  mrlDims: number | null
  device:  'auto' | 'webgpu' | 'wasm'
}

type WorkerOutMsg =
  | { type: 'ready' }
  | { type: 'result'; id: number; flat: number[]; dims: number; count: number; ms: number }
  | { type: 'error';  id: number; message: string }
  | { type: 'init-error'; message: string }

type Pending = {
  resolve: (vecs: Float32Array[]) => void
  reject:  (err: Error) => void
}

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'

// Таймаут одного запроса ВНУТРИ очереди embed() (заход G) — защита от того, что зависший
// (не только конкурентный — вообще любой) вызов навсегда заблокирует очередь для всех
// последующих потребителей. Явно больше, чем таймаут EmbedClient.ts (20с) в main — тот
// покрывает полный main→renderer→main round-trip и должен успеть сработать первым для
// потребителей из main; этот — последний рубеж для прямых вызовов внутри renderer
// (кластеризация вкладок), у которых внешнего таймаута нет вообще.
const EMBED_QUEUE_ITEM_TIMEOUT_MS = 30_000

class EmbeddingService {
  private worker:  Worker | null = null
  private status:  ModelStatus = 'idle'
  private broken:  Error | null = null
  private pending  = new Map<number, Pending>()
  private nextId   = 0
  private startupPromise: Promise<void> | null = null
  private listeners: Array<(s: ModelStatus) => void> = []
  // Хвост очереди сериализации embed() (заход G) — см. embed() ниже.
  private queueTail: Promise<unknown> = Promise.resolve()

  getStatus(): ModelStatus { return this.status }

  // Строка версии активной модели — уходит в history_embeddings.model_version (заход G),
  // чтобы при смене ACTIVE_MODEL/dtype/mrlDims старые векторы были явно отличимы от новых.
  getModelVersion(): string {
    const cfg = MODELS[ACTIVE_MODEL]!
    return `${cfg.modelId}@${cfg.dtype}${cfg.mrlDims !== null ? `:mrl${cfg.mrlDims}` : ''}`
  }

  onStatusChange(cb: (s: ModelStatus) => void): () => void {
    this.listeners.push(cb)
    return () => { this.listeners = this.listeners.filter((l) => l !== cb) }
  }

  // Запускает загрузку весов без инференса.
  // Повторный вызов во время loading/ready/error — no-op.
  preload(): void {
    if (this.startupPromise) return
    this.startupPromise = this.doStartup()
    this.startupPromise.catch(() => { /* ошибка отражена в status='error' */ })
  }

  // Сбрасывает состояние ошибки и перезапускает загрузку.
  retry(): void {
    if (this.status !== 'error') return
    this.broken = null
    this.worker?.terminate()
    this.worker = null
    this.startupPromise = null
    this.startupPromise = this.doStartup()
    this.startupPromise.catch(() => {})
  }

  // Сериализовано (заход G): worker/WASM-сессия не рассчитаны на overlapping-вызовы — до этой
  // правки кластеризация вкладок (Sidebar.tsx → ClusteringService, прямой вызов) и индексатор
  // истории (main → EmbedRequestBridge.ts, через IPC) звали embed() независимо друг от друга,
  // и конкурентные вызовы вешали часть запросов НАВСЕГДА (не резолвились и не реджектились —
  // см. диагностику: рестор сессии с ~10 вкладками дал 3 успеха и 7 вечных таймаутов).
  // this.queueTail — единая точка, через которую проходят ОБА потребителя, поэтому очередь
  // здесь закрывает гонку целиком, а не только со стороны истории.
  // Слот освобождается в .then(runOne, runOne) — срабатывает при любом исходе предыдущего
  // вызова (успех/ошибка/таймаут), не только на happy path, иначе одна забытая ветка
  // навсегда заблокировала бы очередь для всех остальных потребителей.
  embed(texts: string[]): Promise<Float32Array[]> {
    if (this.broken) return Promise.reject(this.broken)
    if (!this.startupPromise) this.startupPromise = this.doStartup()

    const runOne = (): Promise<Float32Array[]> => {
      const attempt = this.startupPromise!.then(
        () => new Promise<Float32Array[]>((resolve, reject) => {
          if (this.broken) { reject(this.broken!); return }
          const id = this.nextId++
          this.pending.set(id, { resolve, reject })
          this.worker!.postMessage({ type: 'embed', id, texts })
        }),
        (err: unknown) => Promise.reject(err),
      )

      let timer: ReturnType<typeof setTimeout>
      const timeout = new Promise<Float32Array[]>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`embed(): таймаут ${EMBED_QUEUE_ITEM_TIMEOUT_MS}ms в очереди`)),
          EMBED_QUEUE_ITEM_TIMEOUT_MS,
        )
      })
      return Promise.race([attempt, timeout]).finally(() => clearTimeout(timer))
    }

    const result = this.queueTail.then(runOne, runOne)
    // Хвост очереди — сигнал «слот освободился», без значения/исключения наружу: сам
    // результат этого вызова уже возвращается вызывающему через `result`. Гасим здесь
    // отдельно от него, чтобы отклонение НЕ‑последнего вызова в цепочке не всплывало как
    // необработанный rejection у самого queueTail (у него никогда нет своего .catch).
    this.queueTail = result.then(() => undefined, () => undefined)
    return result
  }

  private setStatus(s: ModelStatus): void {
    this.status = s
    this.listeners.forEach((l) => l(s))
  }

  private async doStartup(): Promise<void> {
    this.setStatus('loading')
    const cfg = MODELS[ACTIVE_MODEL]!
    console.log(`[embed] preload start (${cfg.modelId})`)

    this.worker = new Worker(
      new URL('../workers/embedding.worker.ts', import.meta.url),
      { type: 'module' },
    )

    await new Promise<void>((resolve, reject) => {
      this.worker!.addEventListener('message', (e: MessageEvent<WorkerOutMsg>) => {
        const msg = e.data
        if (msg.type === 'init-error') {
          const err = new Error(msg.message)
          this.broken = err
          this.setStatus('error')
          this.pending.forEach((p) => p.reject(err))
          this.pending.clear()
          reject(err)
        } else if (msg.type === 'ready') {
          this.setStatus('ready')
          resolve()
        } else if (msg.type === 'result') {
          const p = this.pending.get(msg.id)
          if (!p) return
          const vecs: Float32Array[] = []
          for (let i = 0; i < msg.count; i++) {
            vecs.push(new Float32Array(msg.flat.slice(i * msg.dims, (i + 1) * msg.dims)))
          }
          p.resolve(vecs)
          this.pending.delete(msg.id)
        } else if (msg.type === 'error') {
          const p = this.pending.get(msg.id)
          if (!p) return
          p.reject(new Error(msg.message))
          this.pending.delete(msg.id)
        }
      })

      this.worker!.addEventListener('error', (e) => {
        console.error('[embed] worker crash:', e.message)
        if (this.status === 'loading') {
          const err = new Error(e.message)
          this.broken = err
          this.setStatus('error')
          reject(err)
        }
      })

      this.worker!.postMessage({
        type:    'configure',
        modelId: cfg.modelId,
        dtype:   cfg.dtype,
        mrlDims: cfg.mrlDims,
        device:  cfg.device,
      } satisfies ConfigureMsg)
    })
  }
}

export const embeddingService = new EmbeddingService()
