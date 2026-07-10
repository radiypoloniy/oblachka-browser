import { app } from 'electron';
import type { Session } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import type { PermissionRequest, PermKey } from '../shared/ipc';
import { isBackgroundWebContents } from './BackgroundWebContents';

type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');
type Decision = 'granted' | 'denied';

// Проверяем, является ли permission ключом, требующим UI.
// Остальное (USB, HID, Serial, MIDI sysex, pointerLock и т.д.) — запрещать без prompt.
function resolveForRequest(
  permission: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any,
): { keys: PermKey[]; displayKey: PermKey } | null {
  if (permission === 'media') {
    const types: string[] = details?.mediaTypes ?? [];
    const video = types.includes('video');
    const audio = types.includes('audio');
    if (video && audio) return { keys: ['camera', 'microphone'], displayKey: 'camera+microphone' };
    if (video)          return { keys: ['camera'],               displayKey: 'camera' };
    if (audio)          return { keys: ['microphone'],           displayKey: 'microphone' };
    return null; // нет mediaTypes → экзотика → запретить
  }
  switch (permission) {
    case 'geolocation':              return { keys: ['geolocation'],              displayKey: 'geolocation' };
    case 'notifications':            return { keys: ['notifications'],            displayKey: 'notifications' };
    case 'fullscreen':               return { keys: ['fullscreen'],               displayKey: 'fullscreen' };
    case 'clipboard-read':           return { keys: ['clipboard-read'],           displayKey: 'clipboard-read' };
    case 'clipboard-sanitized-write':return { keys: ['clipboard-sanitized-write'],displayKey: 'clipboard-sanitized-write' };
    default:                         return null; // всё остальное — запрещать без UI
  }
}

function resolveForCheck(
  permission: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any,
): PermKey | null {
  if (permission === 'media') {
    const mt: string = details?.mediaType ?? '';
    if (mt === 'video') return 'camera';
    if (mt === 'audio') return 'microphone';
    return null; // unknown → запретить
  }
  switch (permission) {
    case 'geolocation':               return 'geolocation';
    case 'notifications':             return 'notifications';
    case 'fullscreen':                return 'fullscreen';
    case 'clipboard-read':            return 'clipboard-read';
    case 'clipboard-sanitized-write': return 'clipboard-sanitized-write';
    default:                          return null;
  }
}

function safeOrigin(url: string): string {
  if (!url) return '';
  try { return new URL(url).origin; }
  catch { return url; }
}

interface PendingEntry {
  callback: (granted: boolean) => void;
  origin: string;
  keysToStore: PermKey[];
}

export class PermissionManager {
  #db: Database | null = null;
  #dbPath: string;
  #pending = new Map<string, PendingEntry>();
  #sendRequest: ((req: PermissionRequest) => void) | null = null;

  constructor() {
    this.#dbPath = path.join(app.getPath('userData'), 'permissions.sqlite');
  }

  async initialize(): Promise<void> {
    let Sqlite: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Sqlite = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[Permissions] better-sqlite3 недоступен — разрешения не персистируются:', (e as Error).message);
      return;
    }
    try {
      this.#db = new Sqlite(this.#dbPath);
      this.#setup();
      console.log('[Permissions] база инициализирована:', this.#dbPath);
    } catch (e) {
      console.error('[Permissions] ошибка открытия БД:', (e as Error).message);
      try {
        fs.unlinkSync(this.#dbPath);
        this.#db = new Sqlite!(this.#dbPath);
        this.#setup();
        console.log('[Permissions] БД пересоздана');
      } catch (e2) {
        console.error('[Permissions] пересоздание провалилось:', (e2 as Error).message);
        this.#db = null;
      }
    }
  }

  attach(sess: Session, sendRequest: (req: PermissionRequest) => void): void {
    this.#sendRequest = sendRequest;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sess as any).setPermissionRequestHandler(
      (wc: { id: number; getURL(): string } | null, permission: string, callback: (granted: boolean) => void, details: unknown) => {
        // Фоновая (не пользователем открытая) вкладка — см. BackgroundWebContents.ts. Тихий deny,
        // без всплытия в UI: запрос разрешения без видимой вкладки-источника только запутал бы.
        if (wc && isBackgroundWebContents(wc.id)) { callback(false); return; }

        const rawUrl = (details as { requestingUrl?: string })?.requestingUrl
          ?? (wc ? wc.getURL() : '');
        const origin = safeOrigin(rawUrl);

        const resolved = resolveForRequest(permission, details);
        if (!resolved) { callback(false); return; }

        const { keys, displayKey } = resolved;

        // Проверяем сохранённые решения для всех нужных ключей.
        const decisions = keys.map((k) => this.#lookup(origin, k));
        if (decisions.every((d) => d !== null)) {
          // Все ключи уже решены — отвечаем без prompt.
          callback(decisions.every((d) => d === 'granted'));
          return;
        }
        if (decisions.some((d) => d === 'denied')) {
          // Хоть один явно запрещён — запрещаем всё без prompt.
          callback(false);
          return;
        }

        const requestId = randomUUID();
        this.#pending.set(requestId, { callback, origin, keysToStore: keys });
        this.#sendRequest?.({ requestId, origin, permission: displayKey });
      },
    );

    // check-хендлер синхронный — только чтение из БД, ничего тяжёлого.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sess as any).setPermissionCheckHandler(
      (wc: { getURL(): string } | null, permission: string, requestingOrigin: string, details: unknown) => {
        const key = resolveForCheck(permission, details);
        if (!key) return false;
        const origin = safeOrigin(requestingOrigin || (wc ? wc.getURL() : ''));
        return this.#lookup(origin, key) === 'granted';
      },
    );
  }

  // Вызывается из IPC-хендлера когда пользователь ответил на prompt.
  respond(requestId: string, granted: boolean, remember: boolean): void {
    const entry = this.#pending.get(requestId);
    if (!entry) return;
    this.#pending.delete(requestId);
    entry.callback(granted);
    if (remember) {
      for (const key of entry.keysToStore) {
        this.#store(entry.origin, key, granted ? 'granted' : 'denied');
      }
    }
  }

  // ── Приватное ────────────────────────────────────────────────────────────────

  #lookup(origin: string, key: string): Decision | null {
    if (!this.#db) return null;
    try {
      const row = this.#db
        .prepare('SELECT decision FROM permissions WHERE origin = ? AND permission = ?')
        .get(origin, key) as { decision: Decision } | undefined;
      return row?.decision ?? null;
    } catch {
      return null;
    }
  }

  #store(origin: string, key: string, decision: Decision): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`
        INSERT INTO permissions (origin, permission, decision, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(origin, permission) DO UPDATE SET
          decision   = excluded.decision,
          updated_at = excluded.updated_at
      `).run(origin, key, decision, Date.now());
    } catch (e) {
      console.warn('[Permissions] #store error:', (e as Error).message);
    }
  }

  #setup(): void {
    const db = this.#db!;
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS permissions (
        origin      TEXT    NOT NULL,
        permission  TEXT    NOT NULL,
        decision    TEXT    NOT NULL CHECK(decision IN ('granted','denied')),
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (origin, permission)
      );
    `);
  }
}
