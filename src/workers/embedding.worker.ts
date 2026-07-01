import { pipeline, env } from '@huggingface/transformers'

env.allowRemoteModels = false
env.allowLocalModels  = true
env.localModelPath = 'oblako-model://localhost/models/'

type ConfigureMsg = {
  type:    'configure'
  modelId: string
  dtype:   string
  mrlDims: number | null
  device:  'auto' | 'webgpu' | 'wasm'
}
type EmbedMsg = { type: 'embed'; id: number; texts: string[] }
type InMsg    = ConfigureMsg | EmbedMsg

type OutMsg =
  | { type: 'ready' }
  | { type: 'result'; id: number; flat: number[]; dims: number; count: number; ms: number }
  | { type: 'error';  id: number; message: string }
  | { type: 'init-error'; message: string }

// Pipeline v3 возвращает непрозрачный callable — any только для хранилища экземпляра.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: ((input: string[], opts: object) => Promise<any>) | null = null
let mrlDims: number | null = null

function l2NormalizeInPlace(v: Float32Array): void {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!
  norm = Math.sqrt(norm)
  if (norm > 1e-12) for (let i = 0; i < v.length; i++) v[i]! /= norm
}

async function init(
  modelId: string,
  dtype: string,
  device: 'auto' | 'webgpu' | 'wasm',
): Promise<void> {
  const t0 = performance.now()
  let activeBackend: 'webgpu' | 'wasm' = 'wasm'

  // Включаем WASM-многопоточность ORT если SAB доступен.
  // Оставляем 1 ядро UI/main; берём остальные (не больше 8).
  const sabAvail  = typeof SharedArrayBuffer !== 'undefined'
  const coi       = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false
  const hwThreads = navigator.hardwareConcurrency ?? 1
  const ortThreads = sabAvail ? Math.max(1, Math.min(hwThreads - 1, 8)) : 1
  if (sabAvail && device !== 'webgpu') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(env as any).backends.onnx.wasm.numThreads = ortThreads
    } catch { /* структура env может отличаться в будущих версиях */ }
  }
  console.log(
    `[embed] threads: SAB=${sabAvail} COI=${coi} hw=${hwThreads}` +
    (device !== 'webgpu' ? ` wasm=${ortThreads}` : ' (webgpu, no threads needed)'),
  )

  // WebGPU: попытка инициализации.
  if (device === 'auto' || device === 'webgpu') {
    const gpuAvail = typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null
    if (!gpuAvail) {
      console.warn('[embed] webgpu: navigator.gpu absent -> fallback wasm')
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extractor = await pipeline('feature-extraction', modelId, { device: 'webgpu', dtype } as any) as any
        activeBackend = 'webgpu'
      } catch (e) {
        console.warn(`[embed] webgpu: ${String(e)} -> fallback wasm`)
      }
    }
  }

  // WASM-фолбэк или явный WASM.
  if (!extractor) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extractor = await pipeline('feature-extraction', modelId, { dtype } as any) as any
    activeBackend = 'wasm'
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
  if (activeBackend === 'webgpu') {
    console.log('[embed] webgpu: active')
  } else {
    console.log(`[embed] backend: wasm${device === 'wasm' ? ' (explicit)' : ''}`)
  }
  console.log(`[embed] loaded ${elapsed}s (${modelId}, dtype=${dtype}, mrlDims=${mrlDims ?? 'full'})`)

  postMessage({ type: 'ready' } satisfies OutMsg)
}

addEventListener('message', (e: MessageEvent<InMsg>) => {
  const msg = e.data

  if (msg.type === 'configure') {
    mrlDims = msg.mrlDims
    void init(msg.modelId, msg.dtype, msg.device).catch((err: unknown) => {
      console.error('[embed] error:', err)
      postMessage({ type: 'init-error', message: String(err) } satisfies OutMsg)
    })
    return
  }

  if (msg.type !== 'embed') return

  const { id, texts } = msg
  void (async () => {
    try {
      if (!extractor) throw new Error('model not ready')
      const t0  = performance.now()
      const out = await extractor(texts, { pooling: 'mean', normalize: true })
      const ms  = Math.round(performance.now() - t0)

      const fullDims: number = (out.dims as number[])[1]!
      const outDims = mrlDims !== null ? Math.min(mrlDims, fullDims) : fullDims
      const rawData = out.data as Float32Array

      // MRL-срез + L2-ренорм (ренорм нужен: срез нарушает единичную норму).
      const vecs: number[] = []
      for (let i = 0; i < texts.length; i++) {
        const slice = rawData.slice(i * fullDims, i * fullDims + outDims)
        if (mrlDims !== null) l2NormalizeInPlace(slice)
        for (let j = 0; j < slice.length; j++) vecs.push(slice[j]!)
      }

      console.log(`[embed] ${texts.length} texts ${ms}ms dims=${outDims}`)
      postMessage({ type: 'result', id, flat: vecs, dims: outDims, count: texts.length, ms } satisfies OutMsg)
    } catch (err) {
      postMessage({ type: 'error', id, message: String(err) } satisfies OutMsg)
    }
  })()
})
