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
import type { HardwareSnapshot, CatalogModel, ModelFit, FitCategory, ModelRole, CatalogEntry } from '../shared/ipc'

export type { CatalogModel, ModelFit, FitCategory, ModelRole, CatalogEntry }

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
// expectedSha256 — поле `lfs.oid` из HuggingFace API (`api/models/{repo}/tree/main`), НЕ
// `oid`/`xetHash` того же ответа (это разные хэши разных слоёв HF — git-blob SHA256 у lfs.oid
// стабилен и совпадает с тем, что реально течёт по Range-запросам через Xet-CDN, см. разведку
// ModelDownloader.ts). Сверяется потоково при скачивании (electron/ModelDownloader.ts).
//
// 0.8B и 27B добавлены отдельной разведкой той же методикой (те же 5 точек контекста, наклон по
// крайним точкам 8192→131072). Линейность у обеих в пределах допуска (макс. отклонение сегмента
// от среднего: 0.8B — 7.45%, 27B — 2.19%, обе <10% — порог остановки не сработал). У 27B наклон
// не круглое число (66423.3165... байт/токен) в отличие от 2B/4B/9B — округлён до 66423,
// contextVramBaseBytes для неё пересчитан от УЖЕ округлённого наклона (не от сырого дробного),
// чтобы сохранённые наклон и база были взаимно согласованы.
// ⚠️ 0.8B из каталога УБРАНА. Не «пока не добавили», а сознательно: на ней ни одна из наших
// AI-функций не работает всерьёз, а предложить её человеку — значит попросить скачать гигабайт
// ради посредственного результата, по которому он будет судить обо всём браузере. Лучше честно
// сказать «на этом устройстве локальный AI не пойдёт», чем отдать заведомо слабое.
// Вернуть можно, но только после прогона `npm run ai-bench` на ней — если вдруг окажется, что на
// части задач (выбор номера из списка) она годится.
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
    contextVramBaseBytes: 537149440,
    qualityTier: 20,
    expectedSha256: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
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
    qualityTier: 30,
    expectedSha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
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
    qualityTier: 40,
    expectedSha256: '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
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
    qualityTier: 50,
    expectedSha256: '84b5f7f112156d63836a01a69dc3f11a6ba63b10a23b8ca7a7efaf52d5a2d806',
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
    // Детект не удался — не гадаем: только tier 20 (2B — второй по счёту, самый лёгкий уровень,
    // ЗАСЛУЖИВАЮЩИЙ доверия без замера; 0.8B/tier 10 достаточно урезана по качеству, что
    // рекомендовать её вслепую хуже, чем 2B) получает благосклонное "recommended", остальные —
    // "not-recommended". Это НЕ реальная оценка вместимости, а консервативная заглушка на случай
    // отсутствия данных.
    return {
      fitQuality: model.qualityTier === 20 ? 'recommended' : 'not-recommended',
      maxContextTokens: 0,
      fitsFullyOnGpu: false,
      contextEstimateReliable: false,
      note: NO_VRAM_DETECTED_NOTE,
    }
  }

  const budget = hw.vramTotalBytes - SYSTEM_RESERVE_BYTES - LLAMA_HEADROOM_BYTES
  const remaining = budget - model.vramFullOffloadBytes - model.contextVramBaseBytes
  const fitsFullyOnGpu = remaining > 0
  // ⚠️ maxContextTokens откалиброван ТОЛЬКО на живых замерах с полным оффлоадом на GPU (сверка
  // с реальным n_ctx на живом прогоне — см. git-историю формулы). Когда fitsFullyOnGpu===false,
  // часть слоёв уходит на CPU и реальное поведение контекста/памяти этой формулой не проверялось —
  // число ниже в этом случае всё равно считается (для внутренних сравнений типа "heavy"), но
  // ПОТРЕБИТЕЛЯМ (UI) отдавать его как достоверное нельзя — для этого есть contextEstimateReliable.
  const maxContextTokens = remaining > 0 ? Math.floor(remaining / model.contextVramPerToken) : 0

  let fitQuality: FitCategory
  let note: string | null = null
  if (!fitsFullyOnGpu || maxContextTokens < HEAVY_MIN_CONTEXT_TOKENS) {
    fitQuality = 'not-recommended'
    note = NOT_RECOMMENDED_NOTE
  } else if (maxContextTokens < RECOMMENDED_MIN_CONTEXT_TOKENS) {
    fitQuality = 'heavy'
    note = HEAVY_NOTE
  } else if (maxContextTokens < LIGHT_MIN_CONTEXT_TOKENS) {
    fitQuality = 'recommended'
  } else {
    fitQuality = 'light'
  }

  return { fitQuality, maxContextTokens, fitsFullyOnGpu, contextEstimateReliable: fitsFullyOnGpu, note }
}

// Порог «комфортного» контекста для ВЫБОРА РОЛИ модели среди каталога (assignRoles ниже) — не
// путать с RECOMMENDED_MIN_CONTEXT_TOKENS внутри evaluateFit (та про категорию ОДНОЙ модели саму
// по себе). Сейчас совпадает по значению с RECOMMENDED_MIN_CONTEXT_TOKENS, но это НЕЗАВИСИМАЯ
// константа для независимого решения — evaluateFit трогать в этой задаче нельзя, поэтому её
// константу переиспользовать нельзя даже при случайном совпадении числа.
const COMFORTABLE_CONTEXT_TOKENS = 16384

// ⚠️ Минимальная ступень, которую вообще можно предлагать. Ниже 4B качество не измерено ни на
// одной нашей функции, а 0.8B из каталога убрана совсем (см. шапку CATALOG). 2B остаётся как
// единственный вариант для слабых карт — с честной подписью, а не как «почти то же самое».
const MEASURED_TIER = 30 // 4B — на ней снят эталон стенда (npm run ai-bench)

// Чем модели отличаются ДЛЯ ЧЕЛОВЕКА. ⚠️ Формулировки не рекламные и не выдуманные: это прямой
// пересказ замеров (scripts/ai-bench.mjs) и живой проверки текстовых задач. 4B на задачах с
// жёсткой формой ответа — поиск вкладки, смысловой Ctrl+F, разбор правил, группировка — оказалась
// точнее и быстрее 9B (26 из 28 против 23 из 28), а уступает на связном тексте: пересказ у неё
// суше. Обещать обратное нельзя, даже если «девять больше четырёх» выглядит убедительнее.
const SUMMARY_BY_TIER: Record<number, string> = {
  20: 'Минимальный вариант для слабых видеокарт. Качество на наших функциях не измерялось — возможны осечки.',
  30: 'Быстрые ответы и самая точная работа с вкладками, поиском и правилами. Пересказ текста короче и суше.',
  40: 'Лучше пересказывает и связнее пишет. Отвечает медленнее и требует заметно больше видеопамяти.',
  50: 'Для мощных видеокарт: самый связный текст ценой скорости и памяти.',
}

/**
 * Назначает роли под конкретное железо. ⚠️ Правило простое и намеренно жёсткое:
 *  • «рекомендуем» — САМАЯ ЛЁГКАЯ модель, которая комфортно влезает и качество которой измерено.
 *    Не самая крупная из влезающих, как было раньше: замеры показали, что крупнее ≠ лучше, а
 *    цена крупной — гигабайты загрузки, память и время ответа.
 *  • «помощнее» — следующая ступень, и только если она тоже влезает КОМФОРТНО (целиком в
 *    видеопамять и с рабочим контекстом). Раньше сюда попадало то, что превышает бюджет до 30%, —
 *    из-за этого на карте с 8 ГБ в списке маячила 27B, которой там делать нечего.
 *  • всё прочее роли не получает и в интерфейс не попадает вовсе.
 * Каталог при этом не режется — записи остаются в массиве, просто не показываются.
 */
export function assignRoles(hw: HardwareSnapshot): CatalogEntry[] {
  const sorted = [...CATALOG].sort((a, b) => a.qualityTier - b.qualityTier)
  const withSummary = (model: CatalogModel, fit: ModelFit, role: ModelRole | null): CatalogEntry => ({
    model, fit, role, visibleByDefault: role !== null,
    summary: SUMMARY_BY_TIER[model.qualityTier] ?? '',
    // Вес модели + база контекста + то, что всё равно занято системой и запасом движка.
    minVramBytes: model.vramFullOffloadBytes + model.contextVramBaseBytes + SYSTEM_RESERVE_BYTES + LLAMA_HEADROOM_BYTES,
  })

  if (hw.vramTotalBytes === null) {
    // Детект не удался — гадать нельзя. Предлагаем одну самую лёгкую измеренную ступень и
    // ничего больше: ошибиться в меньшую сторону здесь дешевле, чем позвать скачать 5 ГБ впустую.
    const fallback = sorted.find((m) => m.qualityTier === MEASURED_TIER) ?? sorted[0]
    return sorted.map((model) => withSummary(model, evaluateFit(model, hw), model.id === fallback?.id ? 'recommended' : null))
  }

  const fits = sorted.map((model) => ({ model, fit: evaluateFit(model, hw) }))
  const comfortable = fits.filter((f) => f.fit.fitsFullyOnGpu && f.fit.maxContextTokens >= COMFORTABLE_CONTEXT_TOKENS)

  // Рекомендуем самую лёгкую ИЗМЕРЕННУЮ ступень, которая комфортно влезает. Если не влезает ни
  // одна такая — берём самую лёгкую комфортную вообще (это 2B, у неё честная подпись про
  // неизмеренное качество). Если не влезает и она — не рекомендуем ничего: пусть человек лучше
  // останется без локального AI, чем с моделью, которая всё равно не заработает.
  const recommended =
    comfortable.find((f) => f.model.qualityTier >= MEASURED_TIER)
    ?? comfortable[0]
    ?? null

  // «Помощнее» — САМАЯ СИЛЬНАЯ из комфортно влезающих, а не следующая по списку: второй вариант
  // должен быть «лучшее, что эта видеокарта реально тянет». Иначе владелец карты на 24 ГБ видел
  // бы 9B и не узнал, что ему доступна ступень выше, — а владелец карты на 8 ГБ по-прежнему
  // видит 9B, потому что ничего сильнее у него комфортно не помещается.
  const stronger = recommended
    ? [...comfortable].reverse().find((f) => f.model.qualityTier > recommended.model.qualityTier) ?? null
    : null

  return fits.map(({ model, fit }) => {
    const role: ModelRole | null =
      recommended && model.id === recommended.model.id ? 'recommended'
      : stronger && model.id === stronger.model.id ? 'stronger'
      : null
    return withSummary(model, fit, role)
  })
}

// Единая точка для IPC — считает HardwareSnapshot один раз (из кэша HardwareInfo.ts, если он уже
// есть) и применяет assignRoles ко всему каталогу.
export async function getCatalogWithFit(): Promise<CatalogEntry[]> {
  const hw = await HardwareInfo.get()
  return assignRoles(hw)
}
