// Хранилище отслеживаемых товаров и их цен (отслеживание товаров, срез 1).
//
// Свой файл `tracking.sqlite`, а не таблица в истории — тот же приём «один менеджер, один файл»,
// что у закладок, паролей, графов и автозаполнения: разный жизненный цикл и разный профиль риска
// (очистка истории не должна задевать то, что человек поставил на отслеживание).
import { app } from 'electron';
import path from 'node:path';
import type { TrackedProduct, TrackedPricePoint } from '../shared/ipc';

type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

// Сколько точек истории отдаём наружу на график. Больше на спарклайне всё равно не различить.
const MAX_POINTS = 180;

export class TrackingStore {
  #db: Database | null = null;
  #dbPath: string;

  constructor(dbPath?: string) {
    this.#dbPath = dbPath ?? path.join(app.getPath('userData'), 'tracking.sqlite');
  }

  initialize(): void {
    let SqliteConstructor: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      SqliteConstructor = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[Tracking] better-sqlite3 не загружен — отслеживание отключено:', (e as Error).message);
      return;
    }
    try {
      this.#db = new SqliteConstructor(this.#dbPath);
      this.#db.pragma('journal_mode = WAL');
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS tracked (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          url        TEXT    NOT NULL UNIQUE,
          host       TEXT    NOT NULL DEFAULT '',
          title      TEXT    NOT NULL DEFAULT '',
          brand      TEXT    NOT NULL DEFAULT '',
          sku        TEXT    NOT NULL DEFAULT '',
          gtin       TEXT    NOT NULL DEFAULT '',
          currency   TEXT    NOT NULL DEFAULT 'RUB',
          created_at INTEGER NOT NULL
        );
        -- ⚠️ Точка цены — отдельная строка на КАЖДОЕ наблюдение, а не поле «текущая цена»: вся
        -- ценность фичи в динамике, и переписывать одно поле значило бы стирать историю.
        CREATE TABLE IF NOT EXISTS price_point (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          tracked_id   INTEGER NOT NULL REFERENCES tracked(id) ON DELETE CASCADE,
          price        REAL    NOT NULL,
          availability TEXT    NOT NULL DEFAULT '',
          seen_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_price_point_tracked ON price_point(tracked_id, seen_at);
      `);
      // ⚠️ Миграция ТОЛЬКО добавлением колонок и по одной, каждая в своём try: база уже лежит у
      // людей с их данными (срез 1), и перестраивать таблицу ради двух полей незачем. Повторный
      // запуск ловит «duplicate column name» и идёт дальше — это и есть признак «уже применено».
      for (const alter of [
        `ALTER TABLE tracked ADD COLUMN last_checked_at INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE tracked ADD COLUMN last_check_ok INTEGER NOT NULL DEFAULT 1`,
        // 0 — товар читается обычным запросом (дёшево), 1 — нужна загрузка страницы (дорого).
        // От этого зависит, как часто мы к нему ходим (см. TrackingChecker).
        `ALTER TABLE tracked ADD COLUMN check_cost INTEGER NOT NULL DEFAULT 1`,
      ]) {
        try { this.#db.exec(alter); } catch { /* колонка уже есть */ }
      }
      this.#db.pragma('foreign_keys = ON');
      console.log('[Tracking] база инициализирована:', this.#dbPath);
    } catch (e) {
      console.warn('[Tracking] база недоступна:', (e as Error).message);
      this.#db = null;
    }
  }

  get available(): boolean { return this.#db !== null; }

  /** Отслеживается ли этот адрес. */
  idForUrl(url: string): number | null {
    if (!this.#db) return null;
    try {
      const row = this.#db.prepare(`SELECT id FROM tracked WHERE url = ?`).get(url) as { id: number } | undefined;
      return row?.id ?? null;
    } catch { return null; }
  }

  /**
   * Поставить на отслеживание и сразу записать первую цену.
   * ⚠️ Идемпотентно по адресу: повторное «отслеживать» на той же странице не заводит второй записи.
   */
  track(p: { url: string; host: string; title: string; brand: string; sku: string; gtin: string; currency: string; price: number; availability: string }): number | null {
    if (!this.#db) return null;
    try {
      const existing = this.idForUrl(p.url);
      if (existing !== null) { this.addPoint(existing, p.price, p.availability); return existing; }
      const info = this.#db.prepare(`
        INSERT INTO tracked (url, host, title, brand, sku, gtin, currency, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(p.url, p.host, p.title, p.brand, p.sku, p.gtin, p.currency || 'RUB', Date.now());
      const id = Number(info.lastInsertRowid);
      this.addPoint(id, p.price, p.availability);
      return id;
    } catch (e) {
      console.warn('[Tracking] не удалось поставить на отслеживание:', (e as Error).message);
      return null;
    }
  }

  untrack(id: number): void {
    if (!this.#db) return;
    try { this.#db.prepare(`DELETE FROM tracked WHERE id = ?`).run(id); } catch { /* нечего удалять */ }
  }

  /**
   * Записать наблюдение.
   *
   * ⚠️ Одинаковое подряд НЕ пишем: человек открывает карточку по десять раз за вечер, и без этого
   * график превратился бы в частокол из одинаковых точек, а «цена изменилась» пришлось бы искать
   * глазами. Меняется цена или наличие — пишем.
   */
  addPoint(trackedId: number, price: number, availability: string): void {
    if (!this.#db || !(price > 0)) return;
    try {
      const last = this.#db.prepare(`
        SELECT price, availability FROM price_point WHERE tracked_id = ? ORDER BY seen_at DESC LIMIT 1
      `).get(trackedId) as { price: number; availability: string } | undefined;
      if (last && last.price === price && last.availability === availability) return;
      this.#db.prepare(`
        INSERT INTO price_point (tracked_id, price, availability, seen_at) VALUES (?, ?, ?, ?)
      `).run(trackedId, price, availability, Date.now());
    } catch (e) {
      console.warn('[Tracking] точка цены не записалась:', (e as Error).message);
    }
  }

  /**
   * Отметить, чем кончилась фоновая проверка.
   *
   * ⚠️ Неудачу записываем ТОЖЕ, и это несущее: без неё экран показывал бы последнюю известную цену
   * как свежую, а человек принимал бы решение о покупке по данным месячной давности, не зная об
   * этом. «Не смогли проверить» — честный и обязательный исход.
   */
  markChecked(id: number, ok: boolean, cost?: 0 | 1): void {
    if (!this.#db) return;
    try {
      if (cost === undefined) {
        this.#db.prepare(`UPDATE tracked SET last_checked_at = ?, last_check_ok = ? WHERE id = ?`)
          .run(Date.now(), ok ? 1 : 0, id);
      } else {
        this.#db.prepare(`UPDATE tracked SET last_checked_at = ?, last_check_ok = ?, check_cost = ? WHERE id = ?`)
          .run(Date.now(), ok ? 1 : 0, cost, id);
      }
    } catch { /* запись отметки не критична */ }
  }

  /**
   * Что пора проверить. Срок СВОЙ у каждого товара и зависит от того, во что нам обходится
   * проверка (см. TrackingChecker): дешёвые ходят чаще, дорогие реже, неудачные — с отступом.
   * Самое давнее — первым.
   */
  dueForCheck(rawMs: number, viewMs: number, failMs: number, limit: number): Array<{ id: number; url: string }> {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT id, url FROM tracked
        WHERE last_checked_at < (? - CASE
          WHEN last_check_ok = 0 THEN ?
          WHEN check_cost = 0   THEN ?
          ELSE ? END)
        ORDER BY last_checked_at ASC LIMIT ?
      `).all(Date.now(), failMs, rawMs, viewMs, limit) as Array<{ id: number; url: string }>;
    } catch { return []; }
  }

  /** Все отслеживаемые адреса — для проверки по кнопке «проверить сейчас». */
  allForCheck(): Array<{ id: number; url: string }> {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`SELECT id, url FROM tracked ORDER BY created_at DESC`)
        .all() as Array<{ id: number; url: string }>;
    } catch { return []; }
  }

  /** Список отслеживаемого вместе с историей — экран рисует по нему и список, и график. */
  list(): TrackedProduct[] {
    if (!this.#db) return [];
    try {
      const rows = this.#db.prepare(`
        SELECT id, url, host, title, brand, currency, created_at AS createdAt,
               last_checked_at AS lastCheckedAt, last_check_ok AS lastCheckOk
        FROM tracked ORDER BY created_at DESC
      `).all() as Array<Omit<TrackedProduct, 'points'>>;
      const stmt = this.#db.prepare(`
        SELECT price, availability, seen_at AS seenAt FROM price_point
        WHERE tracked_id = ? ORDER BY seen_at ASC LIMIT ${MAX_POINTS}
      `);
      return rows.map((r) => ({ ...r, points: stmt.all(r.id) as TrackedPricePoint[] }));
    } catch (e) {
      console.warn('[Tracking] список не прочитался:', (e as Error).message);
      return [];
    }
  }
}
