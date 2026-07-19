// Курируемый каталог GGUF-моделей — статический, без сети. Числа (totalLayers,
// vramFullOffloadBytes, contextVramPerToken) получены разведкой через
// readGgufFileInfo()+GgufInsights из node-llama-cpp (метаданные GGUF-заголовка — БЕЗ loadModel
// и без скачивания файла целиком: локально для 9B, по HTTP Range-запросам для 2B/4B, ~12-15МБ
// метаданных на модель, не весь файл). Инструмент разведки был временным (не входит в этот
// коммит) — сюда зашиты только итоговые числа.
//
// ⚠️ GgufInsights.from(ggufFileInfo) БЕЗ второго аргумента (реального Llama-инстанса) создаёт
// внутри себя "slim"-заглушку без GPU-бэкенда — тогда estimateModelResourceRequirementsV2/
// estimateContextResourceRequirementsV2 вернут gpuVram=0 везде (все деньги "уезжают" в cpuRam) —
// это подтверждено на практике при первом прогоне разведки. Числа ниже посчитаны с РЕАЛЬНЫМ
// llama-инстансом (getLlama(), backend=vulkan), иначе они были бы мусором.
import { slugify } from './ModelRegistry'
import * as HardwareInfo from './HardwareInfo'
import type { HardwareSnapshot, CatalogModel, ModelFit, FitCategory, CatalogEntryWithFit } from '../shared/ipc'

export type { CatalogModel, ModelFit, FitCategory, CatalogEntryWithFit }

// sizeBytes — размер САМОГО .gguf-файла (для скачивания/проверки свободного места), НЕ
// estimateModelResourceRequirementsV2 (та считает только память под тензоры — без метаданных/
// токенизатора, поэтому меньше файла). Источник: HuggingFace API (tree/main), сверено байт в байт;
// для 9B — statSync уже установленного локального файла (совпадает с легаси-копией, см. отчёт
// сверки SHA256 в предыдущей задаче).
//
// vramFullOffloadBytes — estimateModelResourceRequirementsV2({gpuLayers: totalLayers}).gpuVram
// (все слои на GPU).
//
// contextVramPerToken — наклон gpuVram по числу токенов контекста между contextSize=8192 и
// contextSize=131072 (estimateContextResourceRequirementsV2, gpuLayers=totalLayers), т.е.
// (gpuVram(131072) − gpuVram(8192)) / (131072 − 8192). Проверено на трёх точках (добавлена ещё
// 32768) — зависимость линейна: у 9B и 2B наклон между соседними точками совпал ТОЧНО
// (32768.0000 и 12288.0000 байт/токен соответственно на обоих отрезках); у 4B наклон между
// соседними отрезками разошёлся на ~6% (34347 против 32373 байт/токен), но наклон между КРАЙНИМИ
// точками (8192→131072) дал ровно 32768 — то же значение, что у 9B (ожидаемо: у обеих моделей
// totalLayers=33 и, судя по всему, одинаковая конфигурация KV-голов в семействе Qwen3.5, поэтому
// стоимость контекста на токен от ширины embedding/FFN не зависит). Использовано значение по
// крайним точкам как более устойчивое к локальному "дребезгу" среднего замера.
export const CATALOG: CatalogModel[] = [
  {
    id: slugify('Qwen3.5-2B-Q4_K_M.gguf'),
    fileName: 'Qwen3.5-2B-Q4_K_M.gguf',
    label: 'Qwen3.5 2B',
    quant: 'Q4_K_M',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
    sizeBytes: 1280835840,
    totalLayers: 25,
    vramFullOffloadBytes: 1269873920,
    contextVramPerToken: 12288,
    qualityTier: 1,
  },
  {
    id: slugify('Qwen3.5-4B-Q4_K_M.gguf'),
    fileName: 'Qwen3.5-4B-Q4_K_M.gguf',
    label: 'Qwen3.5 4B',
    quant: 'Q4_K_M',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
    sizeBytes: 2740937888,
    totalLayers: 33,
    vramFullOffloadBytes: 2729969664,
    contextVramPerToken: 32768,
    qualityTier: 2,
  },
  {
    id: slugify('Qwen3.5-9B-Q4_K_M.gguf'),
    fileName: 'Qwen3.5-9B-Q4_K_M.gguf',
    label: 'Qwen3.5 9B',
    quant: 'Q4_K_M',
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf',
    sizeBytes: 5680522464,
    totalLayers: 33,
    vramFullOffloadBytes: 5097424896,
    contextVramPerToken: 32768,
    qualityTier: 3,
  },
]

// Резерв под систему/десктоп-композитор/другие процессы на GPU — НЕ бюджет самой модели.
// 1.5 ГиБ — измерено на живом браузере с 20+ восстановленными вкладками (обратный расчёт по
// vramFreeBytes ДО/ПОСЛЕ загрузки модели и известному vramFullOffloadBytes показал ~1.51 ГиБ
// расхождения, не объяснимого весом модели и её контекстом — это Chromium + драйвер + ОС).
// Это НЕ запас "на всякий случай" и не теоретическая прикидка — это нормальный рабочий режим
// продукта (браузер с открытыми вкладками, не пустой процесс), поэтому бюджет считается именно
// от него, а не от гипотетического "чистого" GPU. Прежнее значение 0.5 ГиБ было подобрано без
// такого замера и давало на живой проверке расхождение расчётного maxContextTokens с фактическим
// n_ctx примерно в 2 раза.
const SYSTEM_RESERVE_BYTES = 1.5 * 1024 ** 3 // 1 610 612 736

// Пороги категорий по maxContextTokens — именованные константы рядом с формулой, чтобы править
// в одном месте, а не в теле evaluateFit ниже.
const LIGHT_MIN_CONTEXT_TOKENS = 65536
const RECOMMENDED_MIN_CONTEXT_TOKENS = 16384
const HEAVY_MIN_CONTEXT_TOKENS = 4096

const HEAVY_NOTE = 'Поместится, но контекст будет ограничен — длинные страницы придётся резать'
const NOT_RECOMMENDED_NOTE = 'Не поместится в видеопамять целиком: часть слоёв уйдёт на процессор, скорость упадёт в несколько раз'
const NO_VRAM_DETECTED_NOTE = 'Не удалось определить видеопамять'

// ⚠️ Оценка сделана в предположении СВОБОДНОЙ видеопамяти (hw.vramTotalBytes минус системный
// резерв) — не текущей свободной (hw.vramFreeBytes не используется вовсе). Если на момент вызова
// в VRAM уже что-то загружено (например, Qwen уже резидентен в процессе — TranslationService.ts
// держит модель весь процесс, выгрузки моделей пока нет), реальный gpuLayers:"auto" при следующей
// загрузке ДРУГОЙ модели отрезолвится хуже расчётного здесь. Известное расхождение, не баг этой
// функции — фиксирую как есть, лечится отдельной задачей (выгрузка текущей модели перед оценкой
// или перед переключением).
export function evaluateFit(model: CatalogModel, hw: HardwareSnapshot): ModelFit {
  if (hw.vramTotalBytes === null) {
    // Детект не удался — не гадаем: только 1-й (самый лёгкий) уровень получает благосклонное
    // "recommended", остальные — "not-recommended". Это НЕ реальная оценка вместимости, а
    // консервативная заглушка на случай отсутствия данных.
    return {
      category: model.qualityTier === 1 ? 'recommended' : 'not-recommended',
      maxContextTokens: 0,
      fitsFullyOnGpu: false,
      note: NO_VRAM_DETECTED_NOTE,
    }
  }

  const budget = hw.vramTotalBytes - SYSTEM_RESERVE_BYTES
  const remaining = budget - model.vramFullOffloadBytes
  const fitsFullyOnGpu = remaining > 0
  const maxContextTokens = remaining > 0 ? Math.floor(remaining / model.contextVramPerToken) : 0

  let category: FitCategory
  let note: string | null = null
  if (!fitsFullyOnGpu || maxContextTokens < HEAVY_MIN_CONTEXT_TOKENS) {
    category = 'not-recommended'
    note = NOT_RECOMMENDED_NOTE
  } else if (maxContextTokens < RECOMMENDED_MIN_CONTEXT_TOKENS) {
    category = 'heavy'
    note = HEAVY_NOTE
  } else if (maxContextTokens < LIGHT_MIN_CONTEXT_TOKENS) {
    category = 'recommended'
  } else {
    category = 'light'
  }

  return { category, maxContextTokens, fitsFullyOnGpu, note }
}

// Единая точка для IPC — считает HardwareSnapshot один раз (из кэша HardwareInfo.ts, если он уже
// есть) и применяет evaluateFit ко всему каталогу.
export async function getCatalogWithFit(): Promise<CatalogEntryWithFit[]> {
  const hw = await HardwareInfo.get()
  return CATALOG.map((model) => ({ model, fit: evaluateFit(model, hw) }))
}
