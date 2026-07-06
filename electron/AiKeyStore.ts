// Заход D (шаг 2) — хранилище Gemini API-ключа для AI-фактчека.
// ⚠️ ВРЕМЕННО: только в памяти процесса, НЕ на диске. Персист через safeStorage — шаг 3 этого же
// захода (отдельный коммит, см. историю) — намеренно не смешан с этим шагом (UI-проводка), чтобы
// при живой проверке было видно, на каком именно шаге что сломалось. Публичный API (getKeyStatus/
// saveKey/deleteKey/getKey/onKeyStatusChanged) не изменится — шаг 3 меняет только реализацию
// save/delete/загрузку при старте.
//
// connected-статус — единственное, что когда-либо уходит в renderer; сам ключ наружу из main
// не отдаётся (см. shared/ipc.ts::AI_GET_KEY_STATUS).

type Listener = (connected: boolean) => void;

let apiKey: string | null = null;
const listeners = new Set<Listener>();

export function getKeyStatus(): boolean {
  return apiKey !== null;
}

// Возвращает ключ для реального вызова Gemini (шаг 5) — используется только в main, никогда не
// пересекает границу IPC.
export function getKey(): string | null {
  return apiKey;
}

export function saveKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  apiKey = trimmed;
  notify();
  return true;
}

export function deleteKey(): void {
  apiKey = null;
  notify();
}

export function onKeyStatusChanged(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  const connected = getKeyStatus();
  for (const cb of listeners) cb(connected);
}
