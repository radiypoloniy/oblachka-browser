// Детект железа — подбор GGUF-модели по доступной VRAM. Read-only, ленивый: ничего не считает на
// старте, первый запрос инициирует расчёт и кэширует результат. Модель НИКОГДА не загружается
// этим файлом.
//
// ⚠️ VRAM спрашивается У ПРОЦЕССА ИНФЕРЕНСА (InferenceHost.ts), а не через собственный
// getLlamaBackend(). Инициализация бэкенда — это тоже нативная работа (1.1 с в спайке), и сделай
// её main, он бы замирал на секунду ровно в тот момент, когда человек открыл раздел моделей.
// Плюс инвариант: node-llama-cpp живёт РОВНО в одном процессе, и это не main.
import os from 'node:os'
import { getVram, restartInferenceIfIdle } from './inference/InferenceHost'
import type { HardwareSnapshot } from '../shared/ipc'

// Успешный снапшот кэшируется на процесс — vramTotal/gpuBackend/cpuCores стабильны, пересчитывать
// их на каждый запрос незачем. Снапшот с error !== null НЕ кэшируется (см. get()/refresh() ниже) —
// следующий вызов обязан попробовать заново (например, если Vulkan-драйвер к тому моменту
// подхватился, или это был случайный сбой).
//
// ⚠️ И РОВНО ПО ТОЙ ЖЕ ПРИЧИНЕ не кэшируется ответ «GPU нет» (gpuBackend==='false'). Формально
// это успех: бэкенд поднялся, честно сказал «считаю на процессоре», error===null. Но на практике
// так же выглядит и сломанное окружение — именно в этом состоянии упакованная сборка объявляла
// «локальный AI не потянет» машине с RTX 2070 SUPER (разбор — scripts/patch-llama-gpu-test.mjs).
// Закэшировав такой ответ, мы бы лишили человека даже возможности перепроверить.
let cached: HardwareSnapshot | null = null

// Пригоден ли снапшот для кэша: детект отработал И нашёл GPU.
function isTrustworthy(s: HardwareSnapshot): boolean {
  return s.error === null && s.gpuBackend !== null && s.gpuBackend !== 'false'
}

// Весь блок — try/catch: если getLlamaBackend()/getVramState() упали (нет подходящего GPU, нет
// Vulkan-драйвера и т.п.), это ОЖИДАЕМЫЙ сценарий, не повод ронять детект целиком — RAM/CPU через
// os ни от llama, ни от GPU не зависят, отдаём их в любом случае, а vram*/gpuBackend — null.
async function detect(): Promise<HardwareSnapshot> {
  const ramTotalBytes = os.totalmem()
  const ramFreeBytes = os.freemem()
  const cpuCores = os.cpus().length

  try {
    const vram = await getVram()
    return {
      vramTotalBytes: vram.total,
      vramFreeBytes: vram.free,
      gpuBackend: vram.gpu,
      gpuDeviceNames: vram.deviceNames,
      ramTotalBytes,
      ramFreeBytes,
      cpuCores,
      detectedAt: Date.now(),
      error: null,
    }
  } catch (e) {
    return {
      vramTotalBytes: null,
      vramFreeBytes: null,
      gpuBackend: null,
      gpuDeviceNames: [],
      ramTotalBytes,
      ramFreeBytes,
      cpuCores,
      detectedAt: Date.now(),
      error: String(e),
    }
  }
}

// Из кэша, либо первый расчёт (и кэширование, если ему можно верить).
export async function get(): Promise<HardwareSnapshot> {
  if (cached) return cached
  const snapshot = await detect()
  if (isTrustworthy(snapshot)) cached = snapshot
  return snapshot
}

// Принудительный пересчёт — vramFree/ramFree меняются при загрузке/выгрузке модели, vramTotal
// в кэше этого не отражает без явного refresh().
//
// ⚠️ Если прошлый детект закончился «GPU нет», одного пересчёта мало: бэкенд node-llama-cpp
// закэширован ВНУТРИ процесса инференса (LlamaBackend.ts::initPromise), и он повторит тот же
// ответ до конца своей жизни. Поэтому сначала гасим простаивающий процесс — следующий запрос
// поднимет новый и переспросит железо честно. Процесс с загруженной моделью не трогаем: там
// человек уже работает, и ронять её ради перепроверки нельзя.
export async function refresh(): Promise<HardwareSnapshot> {
  if (cached === null) restartInferenceIfIdle()
  const snapshot = await detect()
  if (isTrustworthy(snapshot)) cached = snapshot
  return snapshot
}
