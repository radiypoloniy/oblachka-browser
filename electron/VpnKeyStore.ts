// VPN, шаг 1 — хранилище подписки, тот же принцип, что AiKeyStore.ts: safeStorage (DPAPI на
// Windows), атомарная запись через .tmp+rename, в памяти держим кэш, не перечитываем диск на
// каждый вопрос. Отличие от AiKeyStore: здесь не один секрет, а JSON-конверт — сама ссылка
// подписки (в ней бывает встроенный токен доступа — тоже секрет) и уже распарсенный список
// серверов (там uuid/пароль каждого — тоже секрет, см. VpnParser.ts::VpnServer.credential).
// Ссылка/серверы НИКОГДА не возвращаются в renderer как есть — см. shared/ipc.ts::VpnServerMeta
// (редактированная форма без credential) и getVpnStatus() (только факт "подписка есть").
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { VpnServer } from './VpnParser';

interface StoredSubscription {
  v: 1;
  url: string;
  servers: VpnServer[];
  fetchedAt: number;
}

type Listener = () => void;

let stored: StoredSubscription | null = null;
const listeners = new Set<Listener>();

function filePath(): string {
  return path.join(app.getPath('userData'), 'vpn-subscription.enc');
}

// Вызывается один раз при старте, ПОСЛЕ app.whenReady() — safeStorage требует готовое приложение
// (тот же порядок, что AiKeyStore.ts::loadFromDisk, main.ts).
export function loadFromDisk(): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[VpnKeyStore] safeStorage недоступен на этой машине — подписка VPN не будет загружена/сохранена');
      return;
    }
    const buf = fs.readFileSync(filePath());
    const decrypted = safeStorage.decryptString(buf);
    const parsed = JSON.parse(decrypted) as StoredSubscription;
    if (parsed?.v === 1 && typeof parsed.url === 'string' && Array.isArray(parsed.servers)) {
      stored = parsed;
    }
  } catch {
    // Файла нет (первый запуск) или он битый — остаёмся без подписки, это норма.
    stored = null;
  }
}

export function hasSubscription(): boolean {
  return stored !== null;
}

export function getServerCount(): number {
  return stored?.servers.length ?? 0;
}

export function getFetchedAt(): number | null {
  return stored?.fetchedAt ?? null;
}

// Только main: url нужен VpnSubscription.ts для refresh (повторный fetch по уже сохранённой
// ссылке), наружу через IPC не отдаётся.
export function getUrl(): string | null {
  return stored?.url ?? null;
}

// Только main: полный список с credential — нужен VpnManager.ts (шаг 2) для генерации конфига
// Xray. Renderer получает редактированную версию — см. shared/ipc.ts::VpnServerMeta.
export function getServers(): VpnServer[] {
  return stored?.servers ?? [];
}

export function save(url: string, servers: VpnServer[]): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const next: StoredSubscription = { v: 1, url, servers, fetchedAt: Date.now() };

  const encrypted = safeStorage.encryptString(JSON.stringify(next));
  const dest = filePath();
  const tmp = dest + '.tmp';
  try {
    fs.writeFileSync(tmp, encrypted);
    fs.renameSync(tmp, dest);
  } catch (e) {
    console.error('[VpnKeyStore] не удалось записать зашифрованную подписку на диск:', e);
    return false;
  }

  stored = next;
  notify();
  return true;
}

// ⚠️ Удаляет и из памяти, и файл на диске — не оставляем осиротевший зашифрованный блоб.
export function deleteSubscription(): void {
  stored = null;
  try {
    fs.unlinkSync(filePath());
  } catch {
    // Файла и так нет — не ошибка.
  }
  notify();
}

export function onChanged(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  for (const cb of listeners) cb();
}
