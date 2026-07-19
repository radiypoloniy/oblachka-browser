// Детект железа — задел под будущий подбор GGUF-модели по доступной VRAM. Read-only, ленивый:
// ничего не считает на старте (см. main.ts — вызова отсюда там нет), первый запрос инициирует
// расчёт и кэширует результат. VRAM/GPU-бэкенд — через УЖЕ существующий llama-инстанс
// (LlamaBackend.ts), второй getLlama()/динамический импорт node-llama-cpp здесь не заводится.
// Модель НИКОГДА не загружается этим файлом — только getLlama() (backend/GPU-детект), loadModel
// здесь не встречается ни разу.
import os from 'node:os'
import { getLlamaBackend } from './LlamaBackend'
import type { HardwareSnapshot } from '../shared/ipc'

// Успешный снапшот кэшируется на процесс — vramTotal/gpuBackend/cpuCores стабильны, пересчитывать
// их на каждый запрос незачем. Снапшот с error !== null НЕ кэшируется (см. get()/refresh() ниже) —
// следующий вызов обязан попробовать заново (например, если Vulkan-драйвер к тому моменту
// подхватился, или это был случайный сбой).
let cached: HardwareSnapshot | null = null

// Весь блок — try/catch: если getLlamaBackend()/getVramState() упали (нет подходящего GPU, нет
// Vulkan-драйвера и т.п.), это ОЖИДАЕМЫЙ сценарий, не повод ронять детект целиком — RAM/CPU через
// os ни от llama, ни от GPU не зависят, отдаём их в любом случае, а vram*/gpuBackend — null.
async function detect(): Promise<HardwareSnapshot> {
  const ramTotalBytes = os.totalmem()
  const ramFreeBytes = os.freemem()
  const cpuCores = os.cpus().length

  try {
    const llama = await getLlamaBackend()
    const vram = await llama.getVramState()
    return {
      vramTotalBytes: vram.total,
      vramFreeBytes: vram.free,
      gpuBackend: llama.gpu,
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
      ramTotalBytes,
      ramFreeBytes,
      cpuCores,
      detectedAt: Date.now(),
      error: String(e),
    }
  }
}

// Из кэша, либо первый расчёт (и кэширование, если он успешен).
export async function get(): Promise<HardwareSnapshot> {
  if (cached) return cached
  const snapshot = await detect()
  if (snapshot.error === null) cached = snapshot
  return snapshot
}

// Принудительный пересчёт — vramFree/ramFree меняются при загрузке/выгрузке модели, vramTotal
// в кэше этого не отражает без явного refresh().
export async function refresh(): Promise<HardwareSnapshot> {
  const snapshot = await detect()
  if (snapshot.error === null) cached = snapshot
  return snapshot
}
