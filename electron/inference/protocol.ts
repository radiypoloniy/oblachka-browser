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
}

export type InferRequest =
  | { id: number; kind: 'load'; modelPath: string; modelId: string; label: string; contextMaxTokens: number }
  | { id: number; kind: 'unload' }
  | { id: number; kind: 'prompt'; prompt: string; maxTokens: number; stream: boolean }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { id: number; kind: 'chat'; userText: string; history: any[]; maxTokens: number; systemPrompt: string; stream: boolean }
  | { id: number; kind: 'vram' }

export type InferResponse =
  | { id: number; ready: true }                                   // процесс поднялся и готов
  | { id: number; chunk: string }                                 // кусок текста по мере генерации
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { code?: string; message: string } }
