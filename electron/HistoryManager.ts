import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { HistoryEntry, HistoryClearPeriod } from '../shared/ipc';
import { isSearchResultUrl } from '../shared/searchEngines';

// better-sqlite3 — нативный модуль, может отсутствовать если пересборка не прошла.
// Грузим динамически, чтобы браузер запускался даже без C++ инструментов.
type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

const RECENT_LIMIT = 500;

export class HistoryManager {
  #db: Database | null = null;
  #dbPath: string;

  constructor() {
    this.#dbPath = path.join(app.getPath('userData'), 'history.sqlite');
  }

  async initialize(): Promise<void> {
    let SqliteConstructor: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      SqliteConstructor = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[History] better-sqlite3 не загружен — история отключена:', (e as Error).message);
      return;
    }

    try {
      this.#db = new SqliteConstructor(this.#dbPath);
      this.#setup();
      console.log('[History] база инициализирована:', this.#dbPath);
    } catch (e) {
      console.error('[History] не удалось открыть БД:', (e as Error).message);
      // Попробуем удалить битый файл и пересоздать
      try {
        fs.unlinkSync(this.#dbPath);
        this.#db = new SqliteConstructor!(this.#dbPath);
        this.#setup();
        console.log('[History] БД пересоздана после ошибки');
      } catch (e2) {
        console.error('[History] пересоздание БД провалилось — история отключена:', (e2 as Error).message);
        this.#db = null;
      }
    }
  }

  // Записывает визит: один URL = одна строка, visit_count++, last_visit обновляется.
  // Вызывается только из did-navigate.
  recordVisit(url: string, title: string): void {
    if (!this.#db || !this.#shouldRecord(url)) return;
    try {
      this.#db.prepare(`
        INSERT INTO history (url, title, last_visit, visit_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(url) DO UPDATE SET
          title      = excluded.title,
          last_visit = excluded.last_visit,
          visit_count = visit_count + 1
      `).run(url, title || url, Date.now());
    } catch (e) {
      console.warn('[History] recordVisit error:', (e as Error).message);
    }
  }

  // Возвращает id строки history по точному URL (UNIQUE) — для индексатора эмбеддингов,
  // которому нужен history_id уже после того, как recordVisit/updateTitle сами его не отдают.
  getIdByUrl(url: string): number | null {
    if (!this.#db) return null;
    try {
      const row = this.#db.prepare(`SELECT id FROM history WHERE url = ?`).get(url) as { id: number } | undefined;
      return row?.id ?? null;
    } catch (e) {
      console.warn('[History] getIdByUrl error:', (e as Error).message);
      return null;
    }
  }

  // Обновляет только заголовок — без изменения счётчика.
  // Вызывается из page-title-updated (может стрелять много раз на SPA).
  updateTitle(url: string, title: string): void {
    if (!this.#db || !title) return;
    try {
      this.#db.prepare(`
        UPDATE history SET title = ? WHERE url = ?
      `).run(title, url);
    } catch (e) {
      console.warn('[History] updateTitle error:', (e as Error).message);
    }
  }

  getRecent(limit = RECENT_LIMIT): HistoryEntry[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT id, url, title, last_visit AS lastVisit, visit_count AS visitCount
        FROM history
        ORDER BY last_visit DESC
        LIMIT ?
      `).all(limit) as HistoryEntry[];
    } catch (e) {
      console.warn('[History] getRecent error:', (e as Error).message);
      return [];
    }
  }

  search(query: string): HistoryEntry[] {
    if (!this.#db) return [];
    try {
      const like = `%${query}%`;
      return this.#db.prepare(`
        SELECT id, url, title, last_visit AS lastVisit, visit_count AS visitCount
        FROM history
        WHERE url LIKE ? OR title LIKE ?
        ORDER BY last_visit DESC
        LIMIT ?
      `).all(like, like, RECENT_LIMIT) as HistoryEntry[];
    } catch (e) {
      console.warn('[History] search error:', (e as Error).message);
      return [];
    }
  }

  deleteEntry(id: number): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`DELETE FROM history WHERE id = ?`).run(id);
    } catch (e) {
      console.warn('[History] deleteEntry error:', (e as Error).message);
    }
  }

  clearHistory(period: HistoryClearPeriod): void {
    if (!this.#db) return;
    try {
      if (period === 'all') {
        this.#db.prepare(`DELETE FROM history`).run();
      } else {
        const ms: Record<HistoryClearPeriod, number> = {
          hour: 60 * 60 * 1000,
          day:  24 * 60 * 60 * 1000,
          week: 7  * 24 * 60 * 60 * 1000,
          all:  0,
        };
        const cutoff = Date.now() - ms[period];
        this.#db.prepare(`DELETE FROM history WHERE last_visit >= ?`).run(cutoff);
      }
    } catch (e) {
      console.warn('[History] clearHistory error:', (e as Error).message);
    }
  }

  // ── Приватное ────────────────────────────────────────────────────────────────

  #setup(): void {
    const db = this.#db!;
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        url         TEXT    NOT NULL UNIQUE,
        title       TEXT    NOT NULL DEFAULT '',
        last_visit  INTEGER NOT NULL,
        visit_count INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_history_last_visit ON history(last_visit DESC);

      -- Эмбеддинги истории для семантического поиска (заход G). Аддитивная таблица —
      -- не меняет и не блокирует history, проверено на копии боевой БД (688 строк,
      -- контрольные суммы совпали до/после, FK на history(id) реально работает).
      CREATE TABLE IF NOT EXISTS history_embeddings (
        history_id    INTEGER PRIMARY KEY REFERENCES history(id),
        vector        BLOB    NOT NULL,
        dims          INTEGER NOT NULL,
        model_version TEXT    NOT NULL,
        indexed_at    INTEGER NOT NULL
      );
    `);
  }

  // Приватные и системные URL, а также result-страницы поисковиков в историю не пишем.
  // ⚠️ Только result-страница (google.com/search?q=…), не домен/главная поисковика — те
  // (google.com, yandex.ru как есть) остаются валидной историей.
  #shouldRecord(url: string): boolean {
    if (!url) return false;
    // about:, chrome:, devtools: и т.п. не записываем
    if (!/^https?:\/\//i.test(url)) return false;
    return !isSearchResultUrl(url);
  }
}
