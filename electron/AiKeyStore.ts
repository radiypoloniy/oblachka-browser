// Заход D (шаг 3) — хранилище Gemini API-ключа для AI-фактчека, персистентно через
// Electron safeStorage (тот же DPAPI-принцип, что заложен в CLAUDE.md для будущего SecretStore
// паролей — на Windows это Data Protection API, ключ шифруется под учётной записью пользователя
// ОС). Публичный API (getKeyStatus/saveKey/deleteKey/getKey/onKeyStatusChanged) не изменился
// относительно шага 2 — поменялась только реализация: файл на диске вместо только-памяти.
//
// ⚠️ Ключ — секрет, не настройка: НЕ в settings.json рядом с несекретными значениями (см.
// SettingsManager.ts) — отдельный файл, зашифрованный блоб, а не JSON-строка. Пишем сразу через
// safeStorage, без промежуточного plaintext-этапа — если ключ хоть раз попадёт на диск открытым
// текстом, он рискует остаться читаемым в бэкапах даже после перехода на шифрование, а сам переход
// создаст скачок (старое значение новый код не прочитает, будет казаться, что ключ пропал).
//
// connected-статус — единственное, что когда-либо уходит в renderer; сам ключ наружу из main
// не отдаётся (см. shared/ipc.ts::AI_GET_KEY_STATUS). Не перечитываем safeStorage на каждый
// вопрос "подключено ли" — держим булев флаг в памяти, инвалидируем при save/delete/загрузке.
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

type Listener = (connected: boolean) => void;

let apiKey: string | null = null;
const listeners = new Set<Listener>();

function keyFilePath(): string {
  return path.join(app.getPath('userData'), 'gemini-key.enc');
}

// Вызывается один раз при старте, ПОСЛЕ app.whenReady() — safeStorage требует готовое приложение
// (см. main.ts::app.whenReady). Не в конструкторе/на верхнем уровне модуля.
export function loadFromDisk(): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[AiKeyStore] safeStorage недоступен на этой машине — ключ Gemini не будет загружен/сохранён');
      return;
    }
    const buf = fs.readFileSync(keyFilePath());
    const decrypted = safeStorage.decryptString(buf);
    apiKey = decrypted || null;
  } catch {
    // Файла нет (первый запуск / ключ не сохранён) или он битый — остаёмся без ключа, это норма.
    apiKey = null;
  }
}

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
  if (!safeStorage.isEncryptionAvailable()) return false;

  const encrypted = safeStorage.encryptString(trimmed);
  const filePath = keyFilePath();
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, encrypted);
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error('[AiKeyStore] не удалось записать зашифрованный ключ на диск:', e);
    return false;
  }

  apiKey = trimmed;
  notify();
  return true;
}

// ⚠️ Удаляет и ключ из памяти, и файл на диске — не должно оставаться «осиротевшего»
// зашифрованного блоба после удаления через UI.
export function deleteKey(): void {
  apiKey = null;
  try {
    fs.unlinkSync(keyFilePath());
  } catch {
    // Файла и так нет (уже удалён/никогда не сохранялся) — не ошибка.
  }
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
