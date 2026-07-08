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

  // Блок 6: все проиндексированные записи с векторами для brute-force top-k поиска —
  // на объёме ~700 строк полный скан дешевле, чем инфраструктура ANN-индекса ради этого.
  getAllEmbeddings(): Array<{ id: number; url: string; title: string; lastVisit: number; visitCount: number; vector: Buffer; dims: number }> {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT h.id, h.url, h.title, h.last_visit AS lastVisit, h.visit_count AS visitCount, he.vector, he.dims
        FROM history_embeddings he
        JOIN history h ON h.id = he.history_id
      `).all() as Array<{ id: number; url: string; title: string; lastVisit: number; visitCount: number; vector: Buffer; dims: number }>;
    } catch (e) {
      console.warn('[History] getAllEmbeddings error:', (e as Error).message);
      return [];
    }
  }

  // Разовый бэкфилл (заход G, блок 5): чанк ещё не проиндексированных записей, свежее/чаще
  // посещаемое — первым (last_visit DESC), чтобы при прерывании уже сделанная часть была
  // максимально полезной. NOT IN на history_embeddings естественно даёт возобновляемость —
  // повторный вызов после прерывания просто не вернёт уже обработанные строки.
  getUnindexedHistory(limit: number): Array<{ id: number; url: string; title: string }> {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT id, url, title FROM history
        WHERE id NOT IN (SELECT history_id FROM history_embeddings)
        ORDER BY last_visit DESC
        LIMIT ?
      `).all(limit) as Array<{ id: number; url: string; title: string }>;
    } catch (e) {
      console.warn('[History] getUnindexedHistory error:', (e as Error).message);
      return [];
    }
  }

  // Общее число невыполненных записей — для индикатора прогресса бэкфилла (блок 5).
  countUnindexed(): number {
    if (!this.#db) return 0;
    try {
      const row = this.#db.prepare(`
        SELECT COUNT(*) c FROM history
        WHERE id NOT IN (SELECT history_id FROM history_embeddings)
      `).get() as { c: number };
      return row.c;
    } catch (e) {
      console.warn('[History] countUnindexed error:', (e as Error).message);
      return 0;
    }
  }

  // Пишет/обновляет вектор эмбеддинга для уже существующей строки history (заход G).
  // ON CONFLICT — та же логика, что и у recordVisit: повторная индексация той же страницы
  // (ревизит, или переиндексация после смены модели) молча перезаписывает, не падает на PK.
  saveEmbedding(historyId: number, vector: Float32Array, dims: number, modelVersion: string): void {
    if (!this.#db) return;
    try {
      const buf = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
      this.#db.prepare(`
        INSERT INTO history_embeddings (history_id, vector, dims, model_version, indexed_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(history_id) DO UPDATE SET
          vector        = excluded.vector,
          dims          = excluded.dims,
          model_version = excluded.model_version,
          indexed_at    = excluded.indexed_at
      `).run(historyId, buf, dims, modelVersion, Date.now());
    } catch (e) {
      console.warn('[History] saveEmbedding error:', (e as Error).message);
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

  // Возвращает true/false — раньше ошибка тихо проглатывалась в catch, и пользователь не мог
  // узнать, что очистка не выполнилась (см. History.tsx::handleClear).
  clearHistory(period: HistoryClearPeriod): boolean {
    if (!this.#db) return false;
    const db = this.#db;
    try {
      const run = db.transaction(() => {
        if (period === 'all') {
          // history_embeddings.history_id → history(id) БЕЗ ON DELETE CASCADE, а foreign_keys=ON
          // (#setup) — DELETE FROM history без предварительной чистки детей падает на FK constraint
          // (проверено на копии боевой БД: 627 строк с эмбеддингами → весь DELETE откатывался,
          // ни одна запись не удалялась). Порядок обязателен: сначала дети, потом родители.
          db.prepare(`DELETE FROM history_embeddings`).run();
          db.prepare(`DELETE FROM history`).run();
        } else {
          const ms: Record<HistoryClearPeriod, number> = {
            hour: 60 * 60 * 1000,
            day:  24 * 60 * 60 * 1000,
            week: 7  * 24 * 60 * 60 * 1000,
            all:  0,
          };
          const cutoff = Date.now() - ms[period];
          db.prepare(`
            DELETE FROM history_embeddings
            WHERE history_id IN (SELECT id FROM history WHERE last_visit >= ?)
          `).run(cutoff);
          db.prepare(`DELETE FROM history WHERE last_visit >= ?`).run(cutoff);
        }
      });
      run();
      return true;
    } catch (e) {
      console.error('[History] clearHistory ОШИБКА — очистка НЕ выполнена:', (e as Error).message);
      return false;
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
