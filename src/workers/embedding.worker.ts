import { pipeline, env } from '@huggingface/transformers'

env.allowRemoteModels = false
env.allowLocalModels  = true
// Модель грузится через oblako-model://, зарегистрированный в main-процессе.
env.localModelPath = 'oblako-model://localhost/models/'

type ConfigureMsg = {
  type:      'configure'
  modelId:   string
  dtype:     string
  mrlDims:   number | null
  device:    'auto' | 'webgpu' | 'wasm'
  bench:     boolean
  verifyGpu: boolean
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

// Фиксированный набор заголовков для бенчмарка и верификации.
const BENCH_TEXTS = [
  'Ведомости — Финансовые новости России',
  'GitHub - microsoft/vscode: Visual Studio Code',
  'Яндекс.Карты — подробная карта Москвы',
  'Stack Overflow - Where Developers Learn',
  'РБК Деньги — инвестиции и экономика',
  'MDN Web Docs — HTML CSS JavaScript',
  'Habr — IT-статьи и обсуждения',
  'YouTube — смотреть онлайн видео',
  'TypeScript: The Starting Point for Learning TypeScript',
  'Aviasales — дешёвые авиабилеты онлайн',
]

// L2-нормализация вектора in-place.
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
  bench: boolean,
  verifyGpu: boolean,
): Promise<void> {
  const t0 = performance.now()
  let activeBackend: 'webgpu' | 'wasm' = 'wasm'

  // ── Диагностика и настройка WASM-потоков ──────────────────────────────────
  // SharedArrayBuffer в Electron разрешён для file:// без COOP/COEP.
  // Если SAB доступен — явно задаём numThreads, иначе ORT может взять 1 поток.
  const sabAvail  = typeof SharedArrayBuffer !== 'undefined'
  // crossOriginIsolated — глобаль в Worker; в Electron может быть false даже при рабочем SAB.
  const coi       = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false
  const hwThreads = navigator.hardwareConcurrency ?? 1
  // Оставляем 1 ядро UI/main; берём остальные (не больше 8).
  const ortThreads = sabAvail ? Math.max(1, Math.min(hwThreads - 1, 8)) : 1
  if (sabAvail && device !== 'webgpu') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(env as any).backends.onnx.wasm.numThreads = ortThreads
    } catch { /* структура env может отличаться в будущих версиях */ }
  }
  console.log(
    `[Embeddings] потоки: SAB=${sabAvail} COI=${coi} CPU×${hwThreads}` +
    (device !== 'webgpu' ? ` → WASM-потоков=${ortThreads}` : ' (WebGPU, потоки не нужны)'),
  )

  // ── Попытка WebGPU ─────────────────────────────────────────────────────────
  if (device === 'auto' || device === 'webgpu') {
    const gpuAvail = typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null
    if (!gpuAvail) {
      console.warn('[Embeddings] ⚠ WebGPU недоступен (navigator.gpu отсутствует) → откат WASM')
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extractor = await pipeline('feature-extraction', modelId, { device: 'webgpu', dtype } as any) as any
        activeBackend = 'webgpu'
      } catch (e) {
        console.warn(`[Embeddings] ⚠ WebGPU недоступен (${String(e)}) → откат WASM`)
      }
    }
  }

  // ── WASM-фолбэк или явный WASM ─────────────────────────────────────────────
  if (!extractor) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extractor = await pipeline('feature-extraction', modelId, { dtype } as any) as any
    activeBackend = 'wasm'
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
  if (activeBackend === 'webgpu') {
    console.log(`[Embeddings] ✓ WebGPU активен — GPU-ускорение включено`)
  } else {
    console.log(`[Embeddings] бэкенд: WASM${device === 'wasm' ? ' (задан явно)' : ''}`)
  }
  console.log(`[Embeddings] модель загружена за ${elapsed}с (${modelId}, dtype=${dtype}, mrlDims=${mrlDims ?? 'full'})`)

  // ── Проверка токенизатора на русском ───────────────────────────────────────
  const testStr = 'открытые вкладки браузер'
  try {
    // ВРЕМЕННО: диагностика токенизатора — счётчик токенов для кириллицы
    // (SentencePiece должен дать >3 токенов; 2 = только BOS+EOS = не загрузился)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tok      = (extractor as any).tokenizer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const encoded  = tok(testStr) as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ids      = Array.from(encoded.input_ids.data as any) as number[]
      const verdict  = ids.length <= 2 ? '⚠ ПРОВАЛ — только служебные токены' : `ОК — ${ids.length} токенов`
      console.log(`[Embeddings] токенизатор: "${testStr}" → ${verdict}, ids=[${ids.slice(0, 8).join(',')}]`)
    } catch (tokErr) {
      console.warn(`[Embeddings] токенизатор-диагностика ошибка: ${String(tokErr)}`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const testOut = await (extractor as any)([testStr], { pooling: 'mean', normalize: true })
    const rawFull = testOut.data as Float32Array
    const sample  = Array.from(rawFull.slice(0, 8)) as number[]
    // Проверяем весь вектор: одного NaN в конце достаточно, чтобы сломать кластеризацию
    let nanCount  = 0
    let zeroCount = 0
    for (let i = 0; i < rawFull.length; i++) {
      if (isNaN(rawFull[i]!)) nanCount++
      else if (Math.abs(rawFull[i]!) < 1e-9) zeroCount++
    }
    if (nanCount > 0 || zeroCount === rawFull.length) {
      console.warn(
        `[Embeddings] ⚠ RU-тест ПРОВАЛ (бэкенд=${activeBackend}): NaN=${nanCount}/${rawFull.length}, ` +
        `нули=${zeroCount}/${rawFull.length} — первые 8: [${sample.map((v) => v.toFixed(4)).join(', ')}]`,
      )
    } else {
      console.log(`[Embeddings] RU-тест ОК (бэкенд=${activeBackend}): [${sample.slice(0, 4).map((v) => v.toFixed(3)).join(', ')}...]`)
    }
  } catch (e) {
    console.warn(`[Embeddings] RU-тест ошибка: ${String(e)}`)
  }

  // ── Верификация WebGPU vs WASM (только под --verify-gpu) ───────────────────
  if (verifyGpu) {
    if (activeBackend !== 'webgpu') {
      console.log('[Verify] WebGPU не запустился — верификацию пропускаем (нечего сравнивать)')
    } else {
      console.log(`[Verify] запуск верификации WebGPU vs WASM на ${BENCH_TEXTS.length} строках...`)
      console.log('[Verify] загружаем WASM-пайплайн (~10–30с)...')
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wasmPipe = await pipeline('feature-extraction', modelId, { dtype } as any) as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gpuOut   = await (extractor as any)(BENCH_TEXTS, { pooling: 'mean', normalize: true })
        const wasmOut  = await wasmPipe(BENCH_TEXTS, { pooling: 'mean', normalize: true })

        const gpuData  = gpuOut.data  as Float32Array
        const wasmData = wasmOut.data as Float32Array
        const fullDims: number = (gpuOut.dims as number[])[1]!
        const checkDims = mrlDims !== null ? Math.min(mrlDims, fullDims) : fullDims

        let minCos = 1
        for (let i = 0; i < BENCH_TEXTS.length; i++) {
          // slice() возвращает копию — l2NormalizeInPlace не портит исходный буфер
          const gVec = gpuData.slice(i * fullDims, i * fullDims + checkDims)
          const wVec = wasmData.slice(i * fullDims, i * fullDims + checkDims)
          l2NormalizeInPlace(gVec)
          l2NormalizeInPlace(wVec)
          let dot = 0
          for (let j = 0; j < checkDims; j++) dot += gVec[j]! * wVec[j]!
          if (dot < minCos) minCos = dot
        }

        const ok = minCos >= 0.999
        console.log(
          `[Verify] WebGPU vs WASM мин.косинус=${minCos.toFixed(5)} ` +
          (ok
            ? '✓ OK (≥0.999 — группировка идентична, WebGPU безопасен)'
            : '⚠ РАСХОЖДЕНИЕ (<0.999 — WebGPU на этом драйвере даёт дрейф, вернись на WASM)'),
        )
      } catch (e) {
        console.warn(`[Verify] ошибка: ${String(e)}`)
      }
    }
  }

  // ── Бенчмарк (только под --bench) ─────────────────────────────────────────
  if (bench) {
    console.log(`[Bench] прогрев GPU-шейдеров (2 строки)...`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (extractor as any)(BENCH_TEXTS.slice(0, 2), { pooling: 'mean', normalize: true })
    console.log(`[Bench] замер ${BENCH_TEXTS.length} строк...`)
    const b0 = performance.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (extractor as any)(BENCH_TEXTS, { pooling: 'mean', normalize: true })
    const bMs = Math.round(performance.now() - b0)
    console.log(`[Bench] бэкенд=${activeBackend}: ${BENCH_TEXTS.length} строк за ${bMs}мс (после прогрева)`)
    console.log(`[Bench] Для замера WASM: установи device:'wasm' в EmbeddingService.ts MODELS.embeddinggemma, пересобери, перезапусти.`)
  }

  postMessage({ type: 'ready' } satisfies OutMsg)
}

addEventListener('message', (e: MessageEvent<InMsg>) => {
  const msg = e.data

  if (msg.type === 'configure') {
    mrlDims = msg.mrlDims
    void init(msg.modelId, msg.dtype, msg.device, msg.bench, msg.verifyGpu).catch((err: unknown) => {
      console.error('[Embeddings] ошибка загрузки модели:', err)
      postMessage({ type: 'init-error', message: String(err) } satisfies OutMsg)
    })
    return
  }

  if (msg.type !== 'embed') return

  const { id, texts } = msg
  void (async () => {
    try {
      if (!extractor) throw new Error('модель ещё не готова')
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

      console.log(`[Embeddings] ${texts.length} строк за ${ms}мс, dims=${outDims}`)
      postMessage({ type: 'result', id, flat: vecs, dims: outDims, count: texts.length, ms } satisfies OutMsg)
    } catch (err) {
      postMessage({ type: 'error', id, message: String(err) } satisfies OutMsg)
    }
  })()
})
