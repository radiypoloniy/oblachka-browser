#!/usr/bin/env node
/**
 * Разовый setup-шаг: скачивает файлы моделей эмбеддингов из HuggingFace Hub в resources/models/.
 * Скачиваются обе модели: EmbeddingGemma (активная) и all-MiniLM-L6-v2 (фолбэк).
 * Запуск: npm run download-model
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = path.join(__dirname, '..', 'resources', 'models')

// --q4: дополнительно скачивает q4-вариант EmbeddingGemma (197MB, fp32-активации, нужен для WebGPU без NaN)
const DOWNLOAD_Q4 = process.argv.includes('--q4')

// ── Конфигурация моделей ───────────────────────────────────────────────────────

const MODELS = [
  {
    org:  'onnx-community',
    name: 'embeddinggemma-300m-ONNX',
    label: 'EmbeddingGemma 300M q4f16 (активная, WASM)',
    files: [
      'config.json',
      'generation_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'tokenizer.model',
      'special_tokens_map.json',
      'onnx/model_q4f16.onnx',
      'onnx/model_q4f16.onnx_data',
    ],
    // preflight: проверяем внутреннюю ссылку в .onnx на .onnx_data до скачивания весов.
    // onnx-файл (граф) → ссылается на файл данных по имени внутри протобуфа.
    // Если имя не совпадает — alias-переименование сломает загрузку (Bug #15).
    preflight: { onnxFile: 'onnx/model_q4f16.onnx', expectedData: 'model_q4f16.onnx_data' },
    aliases: new Map(),
  },
  // q4-вариант: fp32-активации — нет f16-overflow на WebGPU, русский не ломается.
  // Токенизатор/конфиг общий с q4f16 → пропустятся (уже есть). Качать только .onnx+.onnx_data.
  // Скачать: node scripts/download-model.mjs --q4
  ...(DOWNLOAD_Q4 ? [{
    org:  'onnx-community',
    name: 'embeddinggemma-300m-ONNX',
    label: 'EmbeddingGemma 300M q4 / WebGPU-safe (197MB)',
    files: [
      'config.json', 'generation_config.json', 'tokenizer.json',
      'tokenizer_config.json', 'tokenizer.model', 'special_tokens_map.json',
      'onnx/model_q4.onnx',
      'onnx/model_q4.onnx_data',
    ],
    preflight: { onnxFile: 'onnx/model_q4.onnx', expectedData: 'model_q4.onnx_data' },
    aliases: new Map(),
  }] : []),
  {
    org:  'Xenova',
    name: 'all-MiniLM-L6-v2',
    label: 'all-MiniLM-L6-v2 q8 (фолбэк)',
    files: [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'onnx/model_quantized.onnx',
    ],
    preflight: null,
    // transformers.js v3 с dtype:'q8' ищет model_q8.onnx — создаём символическую копию.
    aliases: new Map([['onnx/model_quantized.onnx', 'onnx/model_q8.onnx']]),
  },
]

// ── Утилиты скачивания ─────────────────────────────────────────────────────────

async function downloadFile(hfBase, relPath, outDir) {
  const url  = `${hfBase}/${relPath}`
  const dest = path.join(outDir, ...relPath.split('/'))
  fs.mkdirSync(path.dirname(dest), { recursive: true })

  if (fs.existsSync(dest)) {
    const size = fs.statSync(dest).size
    console.log(`  пропуск (уже есть): ${relPath} (${formatBytes(size)})`)
    return dest
  }

  process.stdout.write(`  скачиваем: ${relPath} ... `)
  const resp = await fetch(url, { redirect: 'follow' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${url}`)

  const buf = await resp.arrayBuffer()
  fs.writeFileSync(dest, Buffer.from(buf))
  console.log(formatBytes(buf.byteLength))
  return dest
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

// ── Preflight: проверяем внутреннюю ссылку .onnx → .onnx_data ─────────────────

function checkOnnxDataRef(onnxPath, expectedDataFile) {
  const buf = fs.readFileSync(onnxPath)
  // ONNX протобуф хранит имя external_data как UTF-8 строку.
  // Ссылка может лежать в любом месте файла — сканируем весь (граф ≤ 1 MB).
  const header = buf
  const text   = header.toString('latin1')
  const matches = [...(text.matchAll(/[\w._-]+\.onnx_data/g))].map((m) => m[0])
  const unique  = [...new Set(matches)]

  if (unique.length === 0) {
    console.log('  preflight: ссылок на .onnx_data нет — веса встроены (unexpected)')
    return null
  }

  console.log(`  preflight: внутренняя ссылка на данные → ${unique.join(', ')}`)

  if (unique.length === 1 && unique[0] === expectedDataFile) {
    console.log(`  ✓ ссылка корректна: ${expectedDataFile}`)
    return null
  }

  // Несоответствие — возвращаем реальное имя.
  console.warn(`  ⚠ ожидалось "${expectedDataFile}", найдено: "${unique[0]}"`)
  console.warn('    Переименование alias НЕЛЬЗЯ — сломается привязка весов (Bug #15).')
  console.warn(`    Нужно скачивать файл данных как: ${unique[0]}`)
  return unique[0]
}

// ── Основной цикл ──────────────────────────────────────────────────────────────

for (const model of MODELS) {
  const hfBase = `https://huggingface.co/${model.org}/${model.name}/resolve/main`
  const outDir = path.join(MODELS_DIR, model.org, model.name)

  console.log(`\n═══ ${model.label} ═══`)
  console.log(`Цель: ${outDir}\n`)

  // Определяем порядок скачивания: если есть preflight, сначала .onnx-граф, потом проверка, потом данные.
  const mainFiles     = model.preflight
    ? model.files.filter((f) => f !== model.preflight.onnxFile && !f.endsWith('.onnx_data'))
    : model.files
  const onnxGraphFile = model.preflight ? model.preflight.onnxFile : null
  const dataFiles     = model.preflight ? model.files.filter((f) => f.endsWith('.onnx_data')) : []

  // 1. Качаем всё кроме граф-файла и файла данных.
  for (const f of mainFiles) {
    await downloadFile(hfBase, f, outDir)
  }

  // 2. Если есть preflight — сначала граф, потом проверка, потом данные.
  if (onnxGraphFile && model.preflight) {
    const onnxDest = await downloadFile(hfBase, onnxGraphFile, outDir)

    const actualDataFile = checkOnnxDataRef(onnxDest, model.preflight.expectedData)

    for (const dataRel of dataFiles) {
      const effectiveRel = actualDataFile
        ? dataRel.replace(model.preflight.expectedData, actualDataFile)
        : dataRel
      await downloadFile(hfBase, effectiveRel, outDir)
    }
  } else {
    // Нет preflight — качаем всё подряд (MiniLM).
    for (const f of model.files.filter((f) => !mainFiles.includes(f))) {
      await downloadFile(hfBase, f, outDir)
    }
  }

  // 3. Алиасы (только для MiniLM: model_quantized.onnx → model_q8.onnx).
  for (const [src, dst] of model.aliases) {
    const srcPath = path.join(outDir, ...src.split('/'))
    const dstPath = path.join(outDir, ...dst.split('/'))
    if (!fs.existsSync(dstPath)) {
      fs.copyFileSync(srcPath, dstPath)
      console.log(`  ✓ скопирован как: ${dst}`)
    }
  }
}

console.log('\nГотово.')
if (DOWNLOAD_Q4) {
  console.log('q4 загружен. Для теста: поменяй ACTIVE_MODEL = "embeddinggemma-q4" в EmbeddingService.ts, пересобери.')
} else {
  console.log('Подсказка: добавь --q4 чтобы скачать WebGPU-safe вариант (197MB, fp32-активации).')
}
console.log('Активная модель: ACTIVE_MODEL = "embeddinggemma" в EmbeddingService.ts')
