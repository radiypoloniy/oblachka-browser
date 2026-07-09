// Менеджер паролей, шаг 1 — слой БД passwords.sqlite. Тот же паттерн, что HistoryManager.ts
// (динамический require better-sqlite3, self-heal при битом файле, graceful degradation —
// падение инициализации не должно ронять запуск браузера, см. main.ts::app.whenReady).
// Отдельный файл БД от history.sqlite — изоляция, независимый бэкап, миграции истории не задевают
// сейф паролей (см. CLAUDE.md — зона максимальной осторожности к потере данных).
//
import { app, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as VaultCrypto from './VaultCrypto';
import type { PasswordMeta, PasswordAddInput, PasswordUpdateInput, PasswordCopyField, PasswordGenerateOptions } from '../shared/ipc';

type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

const CLIPBOARD_CLEAR_MS = 30_000;
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?';

export class PasswordManager {
  #db: Database | null = null;
  #dbPath: string;
  #dek: Buffer | null = null; // ключ шифрования записей, в памяти на сессию, никогда не логируется

  constructor() {
    this.#dbPath = path.join(app.getPath('userData'), 'passwords.sqlite');
  }

  async initialize(): Promise<void> {
    let SqliteConstructor: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      SqliteConstructor = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[Passwords] better-sqlite3 не загружен — сейф паролей отключён:', (e as Error).message);
      return;
    }

    try {
      this.#db = new SqliteConstructor(this.#dbPath);
      this.#setup();
    } catch (e) {
      console.error('[Passwords] не удалось открыть БД:', (e as Error).message);
      try {
        fs.unlinkSync(this.#dbPath);
        this.#db = new SqliteConstructor(this.#dbPath);
        this.#setup();
        console.log('[Passwords] БД пересоздана после ошибки');
      } catch (e2) {
        console.error('[Passwords] пересоздание БД провалилось — сейф паролей отключён:', (e2 as Error).message);
        this.#db = null;
        return;
      }
    }

    // Fail closed: если safeStorage недоступен, НЕ создаём vault_meta и не пишем псевдо-плейнтекст —
    // фича просто недоступна, а не работает без защиты (см. бриф).
    if (!VaultCrypto.isAvailable()) {
      console.error('[Passwords] safeStorage недоступен на этой машине — сейф паролей отключён');
      this.#db = null;
      return;
    }

    try {
      this.#unlockOrCreateDek();
      console.log('[Passwords] сейф инициализирован:', this.#dbPath);
    } catch (e) {
      console.error('[Passwords] не удалось развернуть DEK — сейф паролей отключён:', (e as Error).message);
      this.#db = null;
      this.#dek = null;
    }
  }

  get available(): boolean {
    return this.#db !== null && this.#dek !== null;
  }

  list(): PasswordMeta[] {
    if (!this.#db || !this.#dek) return [];
    try {
      return this.#db.prepare(`
        SELECT id, origin, url, username, title, created_at AS createdAt, updated_at AS updatedAt
        FROM credentials
        ORDER BY updated_at DESC
      `).all() as PasswordMeta[];
    } catch (e) {
      console.warn('[Passwords] list error:', (e as Error).message);
      return [];
    }
  }

  reveal(id: number): string | null {
    if (!this.#db || !this.#dek) return null;
    try {
      const row = this.#db.prepare(`SELECT secret FROM credentials WHERE id = ?`).get(id) as { secret: Buffer } | undefined;
      if (!row) return null;
      return VaultCrypto.decryptField(this.#dek, row.secret);
    } catch (e) {
      console.warn('[Passwords] reveal error:', (e as Error).message);
      return null;
    }
  }

  // Менеджер паролей, шаг 2 — сверка перехваченного при submit пароля с сейфом (см.
  // PasswordAutofillManager.ts::handleCredentialSubmitted). 'match' → ничего не предлагаем
  // (никогда не сохраняем молча, но и не спамим уже известным); 'differs' → matchId для
  // строгого update() ПО ID (не «размытый» матчинг); 'new' — сейф недоступен трактуем как
  // 'new' тоже — безопасный дефолт, add() всё равно деградирует сам, ничего не потеряется.
  checkCredential(origin: string, username: string, password: string): { status: 'new' | 'match' | 'differs'; matchId?: number } {
    if (!this.#db || !this.#dek) return { status: 'new' };
    try {
      const row = this.#db.prepare(`SELECT id, secret FROM credentials WHERE origin = ? AND username = ?`).get(origin, username) as
        | { id: number; secret: Buffer } | undefined;
      if (!row) return { status: 'new' };
      const existing = VaultCrypto.decryptField(this.#dek, row.secret);
      return existing === password ? { status: 'match' } : { status: 'differs', matchId: row.id };
    } catch (e) {
      console.warn('[Passwords] checkCredential error:', (e as Error).message);
      return { status: 'new' };
    }
  }

  // Копирует значение в буфер сам — плейнтекст в ответ вызывающей стороне никогда не возвращается
  // (см. бриф). Пароль (не логин) автоочищается через 30с, но только если буфер всё ещё содержит
  // именно это значение — не затираем более позднее копирование пользователя чем-то другим.
  copyField(id: number, field: PasswordCopyField): boolean {
    if (!this.#db || !this.#dek) return false;
    try {
      if (field === 'username') {
        const row = this.#db.prepare(`SELECT username FROM credentials WHERE id = ?`).get(id) as { username: string } | undefined;
        if (!row) return false;
        clipboard.writeText(row.username);
        return true;
      }
      const value = this.reveal(id);
      if (value === null) return false;
      clipboard.writeText(value);
      setTimeout(() => {
        if (clipboard.readText() === value) clipboard.writeText('');
      }, CLIPBOARD_CLEAR_MS);
      return true;
    } catch (e) {
      console.warn('[Passwords] copyField error:', (e as Error).message);
      return false;
    }
  }

  add(input: PasswordAddInput): boolean {
    if (!this.#db || !this.#dek) return false;
    try {
      const now = Date.now();
      const secret = VaultCrypto.encryptField(this.#dek, input.password);
      const notes = input.notes ? VaultCrypto.encryptField(this.#dek, input.notes) : null;
      this.#db.prepare(`
        INSERT INTO credentials (origin, url, username, secret, title, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(originOf(input.url), input.url, input.username, secret, input.title, notes, now, now);
      return true;
    } catch (e) {
      console.warn('[Passwords] add error:', (e as Error).message);
      return false;
    }
  }

  update(input: PasswordUpdateInput): boolean {
    if (!this.#db || !this.#dek) return false;
    const db = this.#db;
    const dek = this.#dek;
    try {
      const existing = db.prepare(`SELECT url, username, title FROM credentials WHERE id = ?`).get(input.id) as
        | { url: string; username: string; title: string } | undefined;
      if (!existing) return false;

      const url = input.url ?? existing.url;
      const username = input.username ?? existing.username;
      const title = input.title ?? existing.title;
      const now = Date.now();

      const run = db.transaction(() => {
        if (input.password !== undefined) {
          const secret = VaultCrypto.encryptField(dek, input.password);
          db.prepare(`
            UPDATE credentials SET origin = ?, url = ?, username = ?, title = ?, secret = ?, updated_at = ?
            WHERE id = ?
          `).run(originOf(url), url, username, title, secret, now, input.id);
        } else {
          db.prepare(`
            UPDATE credentials SET origin = ?, url = ?, username = ?, title = ?, updated_at = ?
            WHERE id = ?
          `).run(originOf(url), url, username, title, now, input.id);
        }
        if (input.notes !== undefined) {
          const notes = input.notes ? VaultCrypto.encryptField(dek, input.notes) : null;
          db.prepare(`UPDATE credentials SET notes = ? WHERE id = ?`).run(notes, input.id);
        }
      });
      run();
      return true;
    } catch (e) {
      console.warn('[Passwords] update error:', (e as Error).message);
      return false;
    }
  }

  delete(id: number): boolean {
    if (!this.#db) return false;
    try {
      this.#db.prepare(`DELETE FROM credentials WHERE id = ?`).run(id);
      return true;
    } catch (e) {
      console.warn('[Passwords] delete error:', (e as Error).message);
      return false;
    }
  }

  // crypto.randomInt — без modulo bias (в отличие от % на randomBytes), не Math.random() —
  // явное требование брифа для генератора паролей.
  generate(opts: PasswordGenerateOptions): string {
    let charset = '';
    if (opts.lower) charset += LOWER;
    if (opts.upper) charset += UPPER;
    if (opts.digits) charset += DIGITS;
    if (opts.symbols) charset += SYMBOLS;
    if (!charset) charset = LOWER + UPPER + DIGITS; // защита от пустого набора символов
    const length = Math.max(4, Math.min(128, opts.length || 16));
    let out = '';
    for (let i = 0; i < length; i++) out += charset[crypto.randomInt(charset.length)];
    return out;
  }

  // Расшифровывает все секреты через DEK, собирает JSON в памяти, шифрует целиком под
  // passphrase — портируемый формат (в отличие от DPAPI-сейфа, непереносимого между машинами).
  // Запись на диск — забота вызывающей стороны (main.ts IPC-хендлер, см. шаг 3/5).
  exportVault(passphrase: string): string | null {
    if (!this.#db || !this.#dek) return null;
    const dek = this.#dek;
    try {
      const rows = this.#db.prepare(`
        SELECT url, username, secret, title, notes FROM credentials
      `).all() as Array<{ url: string; username: string; secret: Buffer; title: string; notes: Buffer | null }>;
      const plain = rows.map((r) => ({
        url: r.url,
        username: r.username,
        password: VaultCrypto.decryptField(dek, r.secret),
        title: r.title,
        notes: r.notes ? VaultCrypto.decryptField(dek, r.notes) : null,
      }));
      return VaultCrypto.encryptWithPassphrase(passphrase, JSON.stringify(plain));
    } catch (e) {
      console.warn('[Passwords] exportVault error:', (e as Error).message);
      return null;
    }
  }

  // Возвращает число импортированных записей (0 = неверная passphrase / битый файл / сейф
  // недоступен) — вызывающая сторона (UI) отличает "ничего не было" от "ошибка" по этому числу.
  importVault(passphrase: string, payload: string): number {
    if (!this.#db || !this.#dek) return 0;
    try {
      const json = VaultCrypto.decryptWithPassphrase(passphrase, payload);
      const entries = JSON.parse(json) as Array<{ url: string; username: string; password: string; title: string; notes: string | null }>;
      let count = 0;
      for (const entry of entries) {
        const ok = this.add({
          url: entry.url,
          username: entry.username,
          password: entry.password,
          title: entry.title,
          notes: entry.notes ?? undefined,
        });
        if (ok) count++;
      }
      return count;
    } catch (e) {
      console.warn('[Passwords] importVault error (неверная passphrase или битый файл):', (e as Error).message);
      return 0;
    }
  }

  // ── Приватное ────────────────────────────────────────────────────────────────

  #setup(): void {
    const db = this.#db!;
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS vault_meta (
        id          INTEGER PRIMARY KEY CHECK (id = 1),
        wrapped_dek BLOB    NOT NULL,
        enc_scheme  INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS credentials (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        origin     TEXT    NOT NULL,
        url        TEXT    NOT NULL,
        username   TEXT    NOT NULL DEFAULT '',
        secret     BLOB    NOT NULL,
        title      TEXT    NOT NULL DEFAULT '',
        notes      BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_credentials_origin ON credentials(origin);
    `);
  }

  // Разворачивает DEK из vault_meta за сессию — при первом обращении к сейфу (строки ещё нет)
  // создаёт DEK и вставляет обёрнутую копию. Бросает наружу — вызывающая сторона (initialize)
  // сама решает, что делать с провалом (отключить фичу, не уронить браузер).
  #unlockOrCreateDek(): void {
    const db = this.#db!;
    const row = db.prepare(`SELECT wrapped_dek FROM vault_meta WHERE id = 1`).get() as { wrapped_dek: Buffer } | undefined;
    if (row) {
      this.#dek = VaultCrypto.unwrapDek(row.wrapped_dek);
      return;
    }
    const dek = VaultCrypto.generateDek();
    const wrapped = VaultCrypto.wrapDek(dek);
    db.prepare(`
      INSERT INTO vault_meta (id, wrapped_dek, enc_scheme, created_at) VALUES (1, ?, 1, ?)
    `).run(wrapped, Date.now());
    this.#dek = dek;
  }
}

// Менеджер паролей, шаг 2 — экспортирована для PasswordAutofillManager.ts (тот же расчёт origin,
// что использует эта таблица сама, не дублируем логику).
export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
