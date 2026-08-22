// Хранилище конфига SearXNG (endpoint + токен) для будущего web-grounding в AI-панели — тот же
// принцип, что AiKeyStore.ts (Gemini) и VpnKeyStore.ts (подписка): safeStorage (DPAPI на
// Windows), атомарная запись через .tmp+rename, кэш в памяти (не перечитываем диск на каждый
// вопрос "настроено ли"). Как у VpnKeyStore — JSON-конверт (два поля), не один секрет, как у
// AiKeyStore. Пишем сразу через safeStorage, без промежуточного plaintext-этапа (тот же довод,
// что в AiKeyStore.ts: если секрет хоть раз попадёт на диск открытым текстом, он рискует
// остаться читаемым в бэкапах даже после перехода на шифрование).
//
// ⚠️ getConfig() — только main (нужен будущему запросу к SearXNG через fetchInProfile, см.
// GeminiFactCheck.ts за образец сетевого вызова). В renderer уходит только getStatus() —
// булев факт "настроено/нет", ни endpoint, ни токен наружу через IPC не пересекают границу.
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface SearxngConfig {
  endpoint: string;
  token: string; // пустая строка — валидно: не у каждого self-hosted SearXNG есть auth
}

interface StoredConfig {
  v: 1;
  endpoint: string;
  token: string;
}

type Listener = (configured: boolean) => void;

let config: SearxngConfig | null = null;
const listeners = new Set<Listener>();

function filePath(): string {
  return path.join(app.getPath('userData'), 'searxng-config.enc');
}

// Вызывается один раз при старте, ПОСЛЕ app.whenReady() — safeStorage требует готовое приложение
// (тот же порядок, что AiKeyStore.ts::loadFromDisk, main.ts).
export function loadFromDisk(): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[SearxngKeyStore] safeStorage недоступен на этой машине — конфиг SearXNG не будет загружен/сохранён');
      return;
    }
    const buf = fs.readFileSync(filePath());
    const decrypted = safeStorage.decryptString(buf);
    const parsed = JSON.parse(decrypted) as StoredConfig;
    if (parsed?.v === 1 && typeof parsed.endpoint === 'string' && typeof parsed.token === 'string' && parsed.endpoint) {
      config = { endpoint: parsed.endpoint, token: parsed.token };
    }
  } catch {
    // Файла нет (первый запуск / не настроено) или он битый — остаёмся без конфига, это норма.
    config = null;
  }
}

export function getStatus(): boolean {
  return config !== null;
}

// Только main: будущий вызов к SearXNG (fetchInProfile, тот же путь и та же VPN-проводка через
// session.defaultSession.setProxy, что у Gemini — см. GeminiFactCheck.ts) читает отсюда.
export function getConfig(): SearxngConfig | null {
  return config;
}

export function saveConfig(next: SearxngConfig): boolean {
  const endpoint = next.endpoint.trim();
  const token = next.token.trim();
  if (!endpoint) return false;
  if (!safeStorage.isEncryptionAvailable()) return false;

  const stored: StoredConfig = { v: 1, endpoint, token };
  const encrypted = safeStorage.encryptString(JSON.stringify(stored));
  const dest = filePath();
  const tmp = dest + '.tmp';
  try {
    fs.writeFileSync(tmp, encrypted);
    fs.renameSync(tmp, dest);
  } catch (e) {
    console.error('[SearxngKeyStore] не удалось записать зашифрованный конфиг на диск:', e);
    return false;
  }

  config = { endpoint, token };
  notify();
  return true;
}

// ⚠️ Удаляет и из памяти, и файл на диске — не оставляем осиротевший зашифрованный блоб.
export function deleteConfig(): void {
  config = null;
  try {
    fs.unlinkSync(filePath());
  } catch {
    // Файла и так нет (уже удалён/никогда не сохранялся) — не ошибка.
  }
  notify();
}

export function onStatusChanged(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  const configured = getStatus();
  for (const cb of listeners) cb(configured);
}
