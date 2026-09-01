// Контракт между main и процессом инференса (electron/inference/worker.ts).
// Отдельным файлом, а не внутри одного из них: его импортируют ОБЕ стороны, и это единственное
// место, где описано, что именно ходит через границу процессов — тот же приём, что shared/ipc.ts
// для main↔renderer.
//
// Через границу ходит только сериализуемое: строки, числа и история диалога (она и так хранится
// в SQLite как JSON). Ни одного объекта node-llama-cpp наружу не уезжает — они живут и умирают
// в дочернем процессе.

export interface LoadedInfo {
  loadMs: number
  modelId: string
  nCtx: number
  gpu: string
  // Сколько видеопамяти было свободно сразу после того, как модель и её контекст встали на карту
  // (null — карты нет либо замер не удался). ⚠️ Нужно политике выгрузки как точка отсчёта: по
  // разности с ней она видит, что после нас на карту пришёл кто-то ещё.
  vramFreeAtLoad: number | null
}

export interface PromptResult {
  out: string
  tokens: number
  stopReason: string
}

export interface ChatResult {
  out: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[]
  ms: number
  tokens: number
}

export interface VramInfo {
  total: number
  free: number
  gpu: string
  // Имена устройств, которые увидел llama.cpp. ⚠️ Нужны не для красоты: на гибридном ноутбуке
  // (встроенная + дискретная) по одному числу VRAM нельзя понять, ту ли карту взяли, а именно
  // так выглядела жалоба «браузер считает, что ноут не подходит, хотя карта хорошая». Пустой
  // массив — бэкенд GPU не поднялся вовсе.
  deviceNames: string[]
}

export type InferRequest =
  | { id: number; kind: 'load'; modelPath: string; modelId: string; label: string; contextMaxTokens: number }
  | { id: number; kind: 'unload' }
  // schema — JSON Schema, к которой привязывается ГРАММАТИКА генерации. Это данные, а не
  // промпт: через границу процессов по-прежнему ходит только «что на вход, что на выход».
  // ⚠️ С грамматикой невалидный ответ не «редкий», а недостижимый — ограничение действует на
  // каждом токене. Ради этого она и заведена: модели 3–4B плывут именно в структуре.
  | { id: number; kind: 'prompt'; prompt: string; maxTokens: number; stream: boolean; schema?: unknown }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { id: number; kind: 'chat'; userText: string; history: any[]; maxTokens: number; systemPrompt: string; stream: boolean }
  | { id: number; kind: 'vram' }
  // Прервать УЖЕ ИДУЩУЮ генерацию. target — id того запроса, который надо остановить.
  //
  // ⚠️ Отдельным сообщением, а не флагом в запросе: прерывание приходит ПОЗЖЕ и должно быть
  // обработано, пока первый запрос ещё висит в await. Очередь сообщений utilityProcess это
  // позволяет — обработчик 'abort' возвращается мгновенно и не ждёт генерацию.
  | { id: number; kind: 'abort'; target: number }

export type InferResponse =
  | { id: number; ready: true }                                   // процесс поднялся и готов
  | { id: number; chunk: string }                                 // кусок текста по мере генерации
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { code?: string; message: string } }
