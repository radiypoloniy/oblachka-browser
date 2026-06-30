// ── Конфигурация модели эмбеддингов ───────────────────────────────────────────
// Чтобы переключить на фолбэк: ACTIVE_MODEL = 'minilm'
// Для замера WASM: установи device: 'wasm' в embeddinggemma
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
  // ДИАГНОСТИКА: q4 (fp32-активации) на WebGPU — нет f16-overflow, должен давать корректный русский.
  // Требует скачать model_q4.onnx + .onnx_data (197MB):
  //   node scripts/download-model.mjs --q4
  // Для теста: поменяй ACTIVE_MODEL ниже на 'embeddinggemma-q4', пересобери.
  'embeddinggemma-q4': {
    modelId: 'onnx-community/embeddinggemma-300m-ONNX',
    dtype:   'q4',
    mrlDims: 256,
    device:  'auto', // WebGPU preferred; WASM-фолбэк если GPU недоступен
  },
  minilm: {
    modelId: 'Xenova/all-MiniLM-L6-v2',
    dtype:   'q8',
    mrlDims: null,   // полные 384 измерения, ренорм не нужен
    device:  'wasm', // у MiniLM нет WebGPU-оптимизированных весов
  },
}

const ACTIVE_MODEL: keyof typeof MODELS = 'embeddinggemma'

// ── Типы сообщений ─────────────────────────────────────────────────────────────

type ConfigureMsg = {
  type:      'configure'
  modelId:   string
  dtype:     string
  mrlDims:   number | null
  device:    'auto' | 'webgpu' | 'wasm'
  bench:     boolean
  verifyGpu: boolean
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

class EmbeddingService {
  private worker:  Worker | null = null
  private ready  = false
  private broken: Error | null = null
  private pending = new Map<number, Pending>()
  private queue:   Array<() => void> = []
  private nextId  = 0
  // startupPromise: гарантирует однократное создание worker + получение флагов.
  private startupPromise: Promise<void> | null = null

  private async startup(): Promise<void> {
    this.worker = new Worker(
      new URL('../workers/embedding.worker.ts', import.meta.url),
      { type: 'module' },
    )

    this.worker.addEventListener('message', (e: MessageEvent<WorkerOutMsg>) => {
      const msg = e.data
      if (msg.type === 'init-error') {
        console.error('[EmbeddingService] воркер не смог загрузить модель:', msg.message)
        const err = new Error(msg.message)
        this.broken = err
        for (const fn of this.queue) fn()
        this.queue = []
        this.pending.forEach((p) => p.reject(err))
        this.pending.clear()
      } else if (msg.type === 'ready') {
        this.ready = true
        for (const fn of this.queue) fn()
        this.queue = []
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
    this.worker.addEventListener('error', (e) => {
      console.error('[EmbeddingService] ошибка worker:', e.message)
    })

    // Читаем диагностические флаги через IPC и отправляем configure в worker.
    const cfg   = MODELS[ACTIVE_MODEL]!
    const flags = await window.oblako.getEmbeddingFlags()
    const configMsg: ConfigureMsg = {
      type:      'configure',
      modelId:   cfg.modelId,
      dtype:     cfg.dtype,
      mrlDims:   cfg.mrlDims,
      device:    cfg.device,
      bench:     flags.bench,
      verifyGpu: flags.verifyGpu,
    }
    this.worker.postMessage(configMsg)
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    if (this.broken) return Promise.reject(this.broken)
    if (!this.startupPromise) this.startupPromise = this.startup()

    return this.startupPromise.then(
      () => new Promise<Float32Array[]>((resolve, reject) => {
        const doEmbed = (): void => {
          if (this.broken) { reject(this.broken); return }
          const id = this.nextId++
          this.pending.set(id, { resolve, reject })
          this.worker!.postMessage({ type: 'embed', id, texts })
        }
        if (this.ready) doEmbed()
        else this.queue.push(doEmbed)
      }),
    )
  }
}

export const embeddingService = new EmbeddingService()
