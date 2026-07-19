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
// (все слои на GPU). Сверено отдельной задачей: model+contextVramBaseBytes+43520×наклон против
// реально замеренного расхода VRAM на живом прогоне (7 266 283 520 байт) — разошлось на 2.27%,
// в пределах допуска.
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
// крайним точкам (8192→131072) как более устойчивое к локальному "дребезгу" среднего замера —
// для 4B тоже взято по этому плечу, а не по соседним отрезкам, по той же причине устойчивости.
//
// contextVramBaseBytes — фиксированный оверхед контекста (графовые/батчевые буферы и т.п.),
// НЕ зависящий от contextSize, — отрезок при N→0 прямой, восстановленный из той же точки 8192:
// base = contextVramBytes(8192) − 8192 × contextVramPerToken. Без этого слагаемого формула
// evaluateFit систематически завышала maxContextTokens (для 9B — примерно на 17 600 токенов).
//
// 0.8B и 27B добавлены отдельной разведкой той же методикой (те же 5 точек контекста, наклон по
// крайним точкам 8192→131072). Линейность у обеих в пределах допуска (макс. отклонение сегмента
// от среднего: 0.8B — 7.45%, 27B — 2.19%, обе <10% — порог остановки не сработал). У 27B наклон
// не круглое число (66423.3165... байт/токен) в отличие от 2B/4B/9B — округлён до 66423,
// contextVramBaseBytes для неё пересчитан от УЖЕ округлённого наклона (не от сырого дробного),
// чтобы сохранённые наклон и база были взаимно согласованы.
export const CATALOG: CatalogModel[] = [
  {
    id: slugify('Qwen3.5-0.8B-Q4_K_M.gguf'),
    fileName: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    label: 'Qwen3.5 0.8B',
    quant: 'Q4_K_M',
    url: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
    sizeBytes: 532517120,
    totalLayers: 25,
    vramFullOffloadBytes: 521555200,
    contextVramPerToken: 12288,
    contextVramBaseBytes: 532955136,
    qualityTier: 1,
  },
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
    contextVramBaseBytes: 537149440,
    qualityTier: 2,
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
    contextVramBaseBytes: 571736064,
    qualityTier: 3,
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
    contextVramBaseBytes: 578027520,
    qualityTier: 4,
  },
  {
    id: slugify('Qwen3.5-27B-Q4_K_M.gguf'),
    fileName: 'Qwen3.5-27B-Q4_K_M.gguf',
    label: 'Qwen3.5 27B',
    quant: 'Q4_K_M',
    url: 'https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/resolve/main/Qwen3.5-27B-Q4_K_M.gguf',
    sizeBytes: 16740812704,
    totalLayers: 65,
    vramFullOffloadBytes: 16014657536,
    contextVramPerToken: 66423,
    contextVramBaseBytes: 687564816,
    qualityTier: 5,
  },
]

// Резерв под систему/Chromium/драйвер/ОС на GPU — НЕ бюджет самой модели.
// 0.90 ГиБ — измерено на ЧИСТОЙ машине (посторонние браузеры/приложения с видео закрыты), только
// сам Oblako, вкладки спящие: замер до загрузки модели с 1 открытой вкладкой и с 23 (10 закреп +
// спящие/активные) дал ПРАКТИЧЕСКИ ОДИНАКОВЫЙ результат (~0.9002-0.9011 ГиБ) — спящие вкладки не
// держат GPU-память, число вкладок в этом диапазоне не влияет.
// ⚠️ Это ПОЛ, не потолок: активное видео/тяжёлая графика в самом Oblako (не в стороннем браузере)
// добавит сверху — величина этой надбавки не измерена, здесь не учтена.
// Прежнее значение 1.5 ГиБ мерилось при параллельно работавшем стороннем браузере с видео —
// было завышено примерно на 0.6 ГиБ по вине чужого процесса, не самого Oblako.
const SYSTEM_RESERVE_BYTES = Math.round(0.9 * 1024 ** 3) // 966 367 642 (0.9 не делится на 1024 без остатка — округляем до целого байта)

// llama.cpp при gpuLayers/contextSize "auto" не выбирает ВСЮ доступную (после вычета
// SYSTEM_RESERVE_BYTES) память под модель+контекст — оставляет что-то нетронутым из осторожности
// самого резолвера (см. resolveModelGpuLayersOption.js в node-llama-cpp). На живом замере (модель+
// контекст загружены, тот же прогон, что дал n_ctx) осталось 367 517 696 байт свободной VRAM,
// хотя по budget-SYSTEM_RESERVE_BYTES она была доступна. Это НЕ резерв под систему (тот уже вычтен
// выше) — отдельная константа, потому что калибруется независимо (свойство самой библиотеки,
// не системы/ОС).
const LLAMA_HEADROOM_BYTES = Math.round(0.35 * 1024 ** 3) // 375 809 638 (округлено до целого байта)

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
    // Детект не удался — не гадаем: только tier 2 (2B — после сдвига тиров это самый лёгкий
    // уровень, ЗАСЛУЖИВАЮЩИЙ доверия без замера; 0.8B/tier 1 достаточно урезана по качеству, что
    // рекомендовать её вслепую хуже, чем 2B) получает благосклонное "recommended", остальные —
    // "not-recommended". Это НЕ реальная оценка вместимости, а консервативная заглушка на случай
    // отсутствия данных.
    return {
      category: model.qualityTier === 2 ? 'recommended' : 'not-recommended',
      maxContextTokens: 0,
      fitsFullyOnGpu: false,
      note: NO_VRAM_DETECTED_NOTE,
    }
  }

  const budget = hw.vramTotalBytes - SYSTEM_RESERVE_BYTES - LLAMA_HEADROOM_BYTES
  const remaining = budget - model.vramFullOffloadBytes - model.contextVramBaseBytes
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
