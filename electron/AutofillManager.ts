// Автозаполнение форм — адреса и банковские карты. НЕ логин/пароль (те — PasswordManager). Тот же
// приём, что у сейфа паролей (CLAUDE.md, зона максимальной осторожности к данным): динамический
// require better-sqlite3, self-heal при битом файле, graceful degradation (падение не роняет
// браузер), свой файл БД (autofill.sqlite) и свой DEK через VaultCrypto (safeStorage/DPAPI).
//
// Модель риска: номер карты — секрет, шифруется DEK и наружу массово НЕ отдаётся (list — только
// маска last4+бренд, полный номер только через revealNumber под OS-подтверждением, гейт в main).
// Адрес — PII, шифруется целиком одним блобом at rest; наружу отдаётся в полном виде (renderer —
// доверенный chrome-UI, не веб-страница). CVC не храним вовсе (PCI).
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import * as VaultCrypto from './VaultCrypto';
import type { AddressProfile, AddressInput, AddressUpdate, CardMeta, CardInput, CardUpdate } from '../shared/ipc';

type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

// Бренд по номеру — грубо, по префиксам (для иконки/маски, не для валидации платежа). '' — неизвестно.
function detectBrand(digits: string): string {
  if (/^4/.test(digits)) return 'Visa';
  if (/^3[47]/.test(digits)) return 'Amex';
  if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(digits)) return 'Mastercard';
  if (/^220[0-4]/.test(digits)) return 'Mir';
  if (/^(6011|65|64[4-9])/.test(digits)) return 'Discover';
  if (/^35(2[89]|[3-8]\d)/.test(digits)) return 'JCB';
  return '';
}

const onlyDigits = (s: string): string => s.replace(/\D/g, '');

export class AutofillManager {
  #db: Database | null = null;
  #dbPath: string;
  #dek: Buffer | null = null;

  constructor() {
    this.#dbPath = path.join(app.getPath('userData'), 'autofill.sqlite');
  }

  async initialize(): Promise<void> {
    let SqliteConstructor: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      SqliteConstructor = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[Autofill] better-sqlite3 не загружен — автозаполнение отключено:', (e as Error).message);
      return;
    }

    try {
      this.#db = new SqliteConstructor(this.#dbPath);
      this.#setup();
    } catch (e) {
      console.error('[Autofill] не удалось открыть БД:', (e as Error).message);
      try {
        fs.unlinkSync(this.#dbPath);
        this.#db = new SqliteConstructor(this.#dbPath);
        this.#setup();
        console.log('[Autofill] БД пересоздана после ошибки');
      } catch (e2) {
        console.error('[Autofill] пересоздание БД провалилось — автозаполнение отключено:', (e2 as Error).message);
        this.#db = null;
        return;
      }
    }

    // Fail closed: без safeStorage не пишем секреты в открытом виде — фича просто недоступна.
    if (!VaultCrypto.isAvailable()) {
      console.error('[Autofill] safeStorage недоступен — автозаполнение отключено');
      this.#db = null;
      return;
    }

    try {
      this.#unlockOrCreateDek();
      console.log('[Autofill] хранилище инициализировано:', this.#dbPath);
    } catch (e) {
      console.error('[Autofill] не удалось развернуть DEK — автозаполнение отключено:', (e as Error).message);
      this.#db = null;
      this.#dek = null;
    }
  }

  get available(): boolean {
    return this.#db !== null && this.#dek !== null;
  }

  // ── Адреса ──────────────────────────────────────────────────────────────────

  listAddresses(): AddressProfile[] {
    if (!this.#db || !this.#dek) return [];
    try {
      const rows = this.#db.prepare(`
        SELECT id, data, created_at AS createdAt, updated_at AS updatedAt
        FROM addresses ORDER BY updated_at DESC
      `).all() as Array<{ id: number; data: Buffer; createdAt: number; updatedAt: number }>;
      const out: AddressProfile[] = [];
      for (const r of rows) {
        try {
          const fields = JSON.parse(VaultCrypto.decryptField(this.#dek, r.data)) as AddressInput;
          out.push({ id: r.id, ...fields, createdAt: r.createdAt, updatedAt: r.updatedAt });
        } catch { /* одна битая запись не должна ронять весь список */ }
      }
      return out;
    } catch (e) {
      console.warn('[Autofill] listAddresses error:', (e as Error).message);
      return [];
    }
  }

  addAddress(input: AddressInput): boolean {
    if (!this.#db || !this.#dek) return false;
    try {
      const now = Date.now();
      const data = VaultCrypto.encryptField(this.#dek, JSON.stringify(normalizeAddress(input)));
      this.#db.prepare(`INSERT INTO addresses (data, created_at, updated_at) VALUES (?, ?, ?)`)
        .run(data, now, now);
      return true;
    } catch (e) {
      console.warn('[Autofill] addAddress error:', (e as Error).message);
      return false;
    }
  }

  updateAddress(input: AddressUpdate): boolean {
    if (!this.#db || !this.#dek) return false;
    try {
      const { id, ...fields } = input;
      const data = VaultCrypto.encryptField(this.#dek, JSON.stringify(normalizeAddress(fields)));
      const info = this.#db.prepare(`UPDATE addresses SET data = ?, updated_at = ? WHERE id = ?`)
        .run(data, Date.now(), id);
      return info.changes > 0;
    } catch (e) {
      console.warn('[Autofill] updateAddress error:', (e as Error).message);
      return false;
    }
  }

  deleteAddress(id: number): boolean {
    if (!this.#db) return false;
    try {
      return this.#db.prepare(`DELETE FROM addresses WHERE id = ?`).run(id).changes > 0;
    } catch (e) {
      console.warn('[Autofill] deleteAddress error:', (e as Error).message);
      return false;
    }
  }

  // ── Карты ───────────────────────────────────────────────────────────────────

  listCards(): CardMeta[] {
    if (!this.#db || !this.#dek) return [];
    try {
      return this.#db.prepare(`
        SELECT id, cardholder, brand, last4, exp_month AS expMonth, exp_year AS expYear,
               created_at AS createdAt, updated_at AS updatedAt
        FROM cards ORDER BY updated_at DESC
      `).all() as CardMeta[];
    } catch (e) {
      console.warn('[Autofill] listCards error:', (e as Error).message);
      return [];
    }
  }

  addCard(input: CardInput): boolean {
    if (!this.#db || !this.#dek) return false;
    const digits = onlyDigits(input.number);
    if (!digits) return false;
    try {
      const now = Date.now();
      const numberEnc = VaultCrypto.encryptField(this.#dek, digits);
      this.#db.prepare(`
        INSERT INTO cards (cardholder, brand, last4, exp_month, exp_year, number_enc, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.cardholder.trim(), detectBrand(digits), digits.slice(-4),
        clampMonth(input.expMonth), clampYear(input.expYear), numberEnc, now, now);
      return true;
    } catch (e) {
      console.warn('[Autofill] addCard error:', (e as Error).message);
      return false;
    }
  }

  updateCard(input: CardUpdate): boolean {
    if (!this.#db || !this.#dek) return false;
    const db = this.#db;
    const dek = this.#dek;
    try {
      const existing = db.prepare(`SELECT cardholder, exp_month, exp_year FROM cards WHERE id = ?`).get(input.id) as
        | { cardholder: string; exp_month: number; exp_year: number } | undefined;
      if (!existing) return false;

      const cardholder = input.cardholder !== undefined ? input.cardholder.trim() : existing.cardholder;
      const expMonth = input.expMonth !== undefined ? clampMonth(input.expMonth) : existing.exp_month;
      const expYear = input.expYear !== undefined ? clampYear(input.expYear) : existing.exp_year;
      const now = Date.now();

      if (input.number !== undefined) {
        const digits = onlyDigits(input.number);
        if (!digits) return false;
        db.prepare(`
          UPDATE cards SET cardholder = ?, brand = ?, last4 = ?, exp_month = ?, exp_year = ?, number_enc = ?, updated_at = ?
          WHERE id = ?
        `).run(cardholder, detectBrand(digits), digits.slice(-4), expMonth, expYear,
          VaultCrypto.encryptField(dek, digits), now, input.id);
      } else {
        db.prepare(`
          UPDATE cards SET cardholder = ?, exp_month = ?, exp_year = ?, updated_at = ? WHERE id = ?
        `).run(cardholder, expMonth, expYear, now, input.id);
      }
      return true;
    } catch (e) {
      console.warn('[Autofill] updateCard error:', (e as Error).message);
      return false;
    }
  }

  deleteCard(id: number): boolean {
    if (!this.#db) return false;
    try {
      return this.#db.prepare(`DELETE FROM cards WHERE id = ?`).run(id).changes > 0;
    } catch (e) {
      console.warn('[Autofill] deleteCard error:', (e as Error).message);
      return false;
    }
  }

  // Полный номер карты — только по явному действию (reveal/fill), под OS-подтверждением (гейт в main).
  revealCardNumber(id: number): string | null {
    if (!this.#db || !this.#dek) return null;
    try {
      const row = this.#db.prepare(`SELECT number_enc FROM cards WHERE id = ?`).get(id) as { number_enc: Buffer } | undefined;
      if (!row) return null;
      return VaultCrypto.decryptField(this.#dek, row.number_enc);
    } catch (e) {
      console.warn('[Autofill] revealCardNumber error:', (e as Error).message);
      return null;
    }
  }

  // ── Приватное ────────────────────────────────────────────────────────────────

  #setup(): void {
    const db = this.#db!;
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS vault_meta (
        id          INTEGER PRIMARY KEY CHECK (id = 1),
        wrapped_dek BLOB    NOT NULL,
        enc_scheme  INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS addresses (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        data       BLOB    NOT NULL,   -- зашифрованный JSON всех полей адреса (PII)
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cards (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        cardholder TEXT    NOT NULL DEFAULT '',
        brand      TEXT    NOT NULL DEFAULT '',
        last4      TEXT    NOT NULL DEFAULT '',
        exp_month  INTEGER NOT NULL DEFAULT 0,
        exp_year   INTEGER NOT NULL DEFAULT 0,
        number_enc BLOB    NOT NULL,   -- зашифрованный полный номер (наружу массово не уходит)
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  // Тот же конверт DEK/KEK, что у PasswordManager — свой DEK в своём vault_meta (файлы не связаны).
  #unlockOrCreateDek(): void {
    const db = this.#db!;
    const row = db.prepare(`SELECT wrapped_dek FROM vault_meta WHERE id = 1`).get() as { wrapped_dek: Buffer } | undefined;
    if (row) {
      this.#dek = VaultCrypto.unwrapDek(row.wrapped_dek);
      return;
    }
    const dek = VaultCrypto.generateDek();
    db.prepare(`INSERT INTO vault_meta (id, wrapped_dek, enc_scheme, created_at) VALUES (1, ?, 1, ?)`)
      .run(VaultCrypto.wrapDek(dek), Date.now());
    this.#dek = dek;
  }
}

function normalizeAddress(a: AddressInput): AddressInput {
  return {
    fullName: a.fullName?.trim() ?? '',
    organization: a.organization?.trim() ?? '',
    email: a.email?.trim() ?? '',
    phone: a.phone?.trim() ?? '',
    street: a.street?.trim() ?? '',
    city: a.city?.trim() ?? '',
    region: a.region?.trim() ?? '',
    postalCode: a.postalCode?.trim() ?? '',
    country: a.country?.trim() ?? '',
  };
}

function clampMonth(m: number): number {
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : 0;
}
function clampYear(y: number): number {
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : 0;
}
