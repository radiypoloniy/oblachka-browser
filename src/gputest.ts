// Изолированный стенд Фазы 1 задачи «GPU-роутер»: доказать/опровергнуть, что WebGPU
// живёт на кириллице БЕЗ f16 (f16 уже даёт NaN — см. embedding.worker.ts).
// Не часть боевого чрома: грузится отдельным окном только при OBLAKO_GPU_TEST=1,
// боевой эмбеддинг-путь (EmbeddingService/embedding.worker.ts) не трогает.
import { pipeline, env } from '@huggingface/transformers'

env.allowRemoteModels = false
env.allowLocalModels  = true
env.localModelPath = 'oblako-model://localhost/models/'

const MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX'

// Кириллические фразы, похожие на реальные заголовки вкладок (разная тематика).
const PHRASES = [
  'Как приготовить борщ с говядиной',
  'Курс доллара к рублю сегодня',
  'Новости о ситуации в мире',
  'Python учебник для начинающих',
  'Погода в Москве на завтра',
  'Рецепт оладий на кефире',
  'Электрон и Chromium — архитектура браузера',
  'Купить билеты на самолёт дёшево',
  'Что такое машинное обучение простыми словами',
  'Отзывы о новом iPhone 16',
]

type Device = 'wasm' | 'webgpu'
type Dtype  = 'q8' | 'fp32'

type RunResult = {
  loadMs: number
  warmupMs: number
  embedMs: number
  vecs: Float32Array[]
  nan: boolean
}
type RunEntry = { ok: true; r: RunResult } | { ok: false; error: string }

function hasNaNOrInf(v: Float32Array): boolean {
  for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return true
  return false
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom > 1e-12 ? dot / denom : NaN
}

// Pipeline v3 возвращает непрозрачный callable — any оправдан тем же образом, что и в embedding.worker.ts.
async function runOne(device: Device, dtype: Dtype): Promise<RunResult> {
  const t0 = performance.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any = device === 'webgpu' ? { device: 'webgpu', dtype } : { dtype }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractor = await pipeline('feature-extraction', MODEL_ID, opts) as any
  const loadMs = performance.now() - t0

  // Прогрев: первый вызов на WebGPU компилирует шейдеры (JIT) — без него сравнение
  // «холодного» вызова с WASM нечестное. Замеряем отдельно, не смешиваем с основным батчем.
  const tw = performance.now()
  await extractor(['прогрев'], { pooling: 'mean', normalize: true })
  const warmupMs = performance.now() - tw

  const t1 = performance.now()
  const out = await extractor(PHRASES, { pooling: 'mean', normalize: true })
  const embedMs = performance.now() - t1

  const dims = (out.dims as number[])[1]!
  const raw  = out.data as Float32Array
  const vecs: Float32Array[] = []
  for (let i = 0; i < PHRASES.length; i++) vecs.push(raw.slice(i * dims, (i + 1) * dims))

  return { loadMs, warmupMs, embedMs, vecs, nan: vecs.some(hasNaNOrInf) }
}

async function main(): Promise<void> {
  console.log('[gputest] === Phase 1: WebGPU cyrillic embedding test ===')
  console.log(`[gputest] navigator.gpu present: ${typeof navigator !== 'undefined' && 'gpu' in navigator}`)
  console.log(`[gputest] crossOriginIsolated: ${typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'n/a'}`)
  console.log(`[gputest] phrases: ${PHRASES.length}`)

  const combos: Array<{ device: Device; dtype: Dtype }> = [
    { device: 'wasm',   dtype: 'q8'   },
    { device: 'webgpu', dtype: 'q8'   },
    { device: 'wasm',   dtype: 'fp32' },
    { device: 'webgpu', dtype: 'fp32' },
  ]

  const results = new Map<string, RunEntry>()

  for (const { device, dtype } of combos) {
    const key = `${device}/${dtype}`
    try {
      const r = await runOne(device, dtype)
      results.set(key, { ok: true, r })
      console.log(
        `[gputest] ${key}: load=${r.loadMs.toFixed(0)}ms warmup=${r.warmupMs.toFixed(0)}ms ` +
        `embed_total(warm)=${r.embedMs.toFixed(0)}ms embed_per_phrase(warm)=${(r.embedMs / PHRASES.length).toFixed(1)}ms nan=${r.nan}`,
      )
    } catch (e) {
      results.set(key, { ok: false, error: String(e) })
      console.log(`[gputest] ${key}: ERROR ${String(e)}`)
    }
  }

  console.log('[gputest] --- cosine(webgpu, wasm) по dtype (корректность, не только NaN) ---')
  for (const dtype of ['q8', 'fp32'] as const) {
    const w = results.get(`webgpu/${dtype}`)
    const c = results.get(`wasm/${dtype}`)
    if (w?.ok && c?.ok) {
      const sims = PHRASES.map((_, i) => cosine(w.r.vecs[i]!, c.r.vecs[i]!))
      const min = Math.min(...sims)
      const avg = sims.reduce((a, b) => a + b, 0) / sims.length
      console.log(`[gputest] dtype=${dtype} cosine min=${min.toFixed(4)} avg=${avg.toFixed(4)}`)
    } else {
      console.log(`[gputest] dtype=${dtype} cosine: пропуск (webgpu или wasm упали)`)
    }
  }

  console.log('[gputest] --- итоговая таблица ---')
  console.log('[gputest] device/dtype | load_ms | warmup_ms | embed_ms_total(warm) | embed_ms_per_phrase(warm) | nan')
  for (const [key, entry] of results) {
    if (!entry.ok) { console.log(`[gputest] ${key} | ERROR: ${entry.error}`); continue }
    const r = entry.r
    console.log(
      `[gputest] ${key} | ${r.loadMs.toFixed(0)} | ${r.warmupMs.toFixed(0)} | ${r.embedMs.toFixed(0)} | ` +
      `${(r.embedMs / PHRASES.length).toFixed(1)} | ${r.nan}`,
    )
  }

  console.log('[gputest] === DONE ===')
}

main()
  .catch((e: unknown) => console.error('[gputest] FATAL', e))
  .finally(() => window.close())
