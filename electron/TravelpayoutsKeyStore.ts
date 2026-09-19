// Токен Travelpayouts Data API для часов на билеты — тот же принцип, что SearxngKeyStore.ts:
// safeStorage (DPAPI на Windows), атомарная запись через .tmp+rename, кэш в памяти.
// В renderer уходит только getStatus() — булев факт «настроено/нет», сам токен границу IPC
// не пересекает (как ключ Gemini и токен SearXNG).
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

interface Stored {
  v: 1;
  token: string;
}

type Listener = (configured: boolean) => void;

let token: string | null = null;
const listeners = new Set<Listener>();

function filePath(): string {
  return path.join(app.getPath('userData'), 'travelpayouts-token.enc');
}

export function loadFromDisk(): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[Travelpayouts] safeStorage недоступен — токен не будет загружен/сохранён');
      return;
    }
    const buf = fs.readFileSync(filePath());
    const parsed = JSON.parse(safeStorage.decryptString(buf)) as Stored;
    if (parsed?.v === 1 && typeof parsed.token === 'string' && parsed.token.trim()) {
      token = parsed.token.trim();
    }
  } catch {
    token = null;
  }
}

export function getStatus(): boolean {
  return token !== null;
}

/** Только main: клиент API читает отсюда. */
export function getToken(): string | null {
  return token;
}

export function saveToken(next: string): boolean {
  const value = next.trim();
  if (!value) return false;
  if (!safeStorage.isEncryptionAvailable()) return false;
  const stored: Stored = { v: 1, token: value };
  const dest = filePath();
  const tmp = dest + '.tmp';
  try {
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(stored)));
    fs.renameSync(tmp, dest);
  } catch (e) {
    console.error('[Travelpayouts] не удалось записать токен:', e);
    return false;
  }
  token = value;
  notify();
  return true;
}

export function deleteToken(): void {
  token = null;
  try { fs.unlinkSync(filePath()); } catch { /* файла и так нет */ }
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
