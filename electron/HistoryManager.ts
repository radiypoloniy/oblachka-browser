import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { HistoryEntry, HistoryClearPeriod } from '../shared/ipc';
import { isSearchResultUrl } from '../shared/searchEngines';
import { normalizeForOmnibox } from '../shared/frecency';

// better-sqlite3 — нативный модуль, может отсутствовать если пересборка не прошла.
// Грузим динамически, чтобы браузер запускался даже без C++ инструментов.
type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

const RECENT_LIMIT = 500;

export interface ContentChunkInput {
  chunkIndex: number;
  url: string;
  title: string;
  text: string;
  vector: Float32Array;
  dims: number;
}

export interface HistoryContentChunk {
  chunkId: number;
  historyId: number;
  chunkIndex: number;
  url: string;
  title: string;
  text: string;
  lastVisit: number;
  visitCount: number;
  vector: Buffer;
  dims: number;
  modelVersion: string;
}

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

  // Для HistoryIndexer.ts::indexVisit — источник истины «уже проиндексирована ли эта страница
  // ТЕКУЩЕЙ версией модели», вместо in-memory Set, который не переживает рестарт (живой замер:
  // 750-850% CPU на 40с при рестарте с 10 закреплёнными вкладками — каждая переиндексировалась
  // заново, хотя содержимое не менялось). history_id — PRIMARY KEY history_embeddings (см. #setup
  // ниже), поэтому WHERE history_id=? — точечный поиск по уже существующему PK-индексу, не полный
  // скан; отдельная миграция/индекс не нужны. На пару (history_id, currentVersion) в этой таблице
  // всегда максимум одна строка (PK не составной) — ON CONFLICT(history_id) DO UPDATE в
  // saveEmbedding() перезаписывает старую версию новой, не добавляет вторую строку.
  hasEmbeddingForVersion(historyId: number, modelVersion: string): boolean {
    if (!this.#db) return false;
    try {
      const row = this.#db.prepare(`
        SELECT 1 FROM history_embeddings WHERE history_id = ? AND model_version = ?
      `).get(historyId, modelVersion);
      return row !== undefined;
    } catch (e) {
      console.warn('[History] hasEmbeddingForVersion error:', (e as Error).message);
      return false;
    }
  }

  // Блок 6: все проиндексированные записи с векторами для brute-force top-k поиска —
  // на объёме ~700 строк полный скан дешевле, чем инфраструктура ANN-индекса ради этого.
  getAllEmbeddings(modelVersion?: string): Array<{ id: number; url: string; title: string; lastVisit: number; visitCount: number; vector: Buffer; dims: number; modelVersion: string }> {
    if (!this.#db) return [];
    try {
      const sql = `
        SELECT h.id, h.url, h.title, h.last_visit AS lastVisit, h.visit_count AS visitCount,
               he.vector, he.dims, he.model_version AS modelVersion
        FROM history_embeddings he
        JOIN history h ON h.id = he.history_id
        ${modelVersion ? 'WHERE he.model_version = ?' : ''}
      `;
      return this.#db.prepare(sql).all(...(modelVersion ? [modelVersion] : [])) as Array<{ id: number; url: string; title: string; lastVisit: number; visitCount: number; vector: Buffer; dims: number; modelVersion: string }>;
    } catch (e) {
      console.warn('[History] getAllEmbeddings error:', (e as Error).message);
      return [];
    }
  }

  // Разовый бэкфилл (заход G, блок 5): чанк ещё не проиндексированных записей, свежее/чаще
  // посещаемое — первым (last_visit DESC), чтобы при прерывании уже сделанная часть была
  // максимально полезной. NOT IN на history_embeddings естественно даёт возобновляемость —
  // повторный вызов после прерывания просто не вернёт уже обработанные строки.
  getUnindexedHistory(limit: number, modelVersion?: string): Array<{ id: number; url: string; title: string }> {
    if (!this.#db) return [];
    try {
      if (modelVersion) {
        return this.#db.prepare(`
          SELECT id, url, title FROM history
          WHERE id NOT IN (
            SELECT history_id FROM history_embeddings
            WHERE model_version = ? OR model_version = 'excluded'
          )
          ORDER BY last_visit DESC
          LIMIT ?
        `).all(modelVersion, limit) as Array<{ id: number; url: string; title: string }>;
      }
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
  countUnindexed(modelVersion?: string): number {
    if (!this.#db) return 0;
    try {
      if (modelVersion) {
        const row = this.#db.prepare(`
          SELECT COUNT(*) c FROM history
          WHERE id NOT IN (
            SELECT history_id FROM history_embeddings
            WHERE model_version = ? OR model_version = 'excluded'
          )
        `).get(modelVersion) as { c: number };
        return row.c;
      }
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

  saveContentChunks(historyId: number, chunks: ContentChunkInput[], modelVersion: string): void {
    if (!this.#db || chunks.length === 0) return;
    const db = this.#db;
    try {
      const run = db.transaction(() => {
        const oldIds = db.prepare(`
          SELECT id FROM history_content_chunks WHERE history_id = ? AND model_version = ?
        `).all(historyId, modelVersion) as Array<{ id: number }>;
        for (const row of oldIds) {
          try { db.prepare(`DELETE FROM history_content_chunks_fts WHERE rowid = ?`).run(row.id); } catch { /* FTS может быть недоступен */ }
        }
        db.prepare(`DELETE FROM history_content_chunks WHERE history_id = ? AND model_version = ?`).run(historyId, modelVersion);

        const insertChunk = db.prepare(`
          INSERT INTO history_content_chunks
            (history_id, chunk_index, url, title, text, vector, dims, model_version, indexed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        let insertFts: import('better-sqlite3').Statement | null = null;
        try {
          insertFts = db.prepare(`
            INSERT INTO history_content_chunks_fts(rowid, text, title, url) VALUES (?, ?, ?, ?)
          `);
        } catch { /* FTS может быть недоступен */ }
        const indexedAt = Date.now();
        for (const chunk of chunks) {
          const buf = Buffer.from(chunk.vector.buffer, chunk.vector.byteOffset, chunk.vector.byteLength);
          const info = insertChunk.run(
            historyId, chunk.chunkIndex, chunk.url, chunk.title, chunk.text,
            buf, chunk.dims, modelVersion, indexedAt,
          );
          try { insertFts?.run(Number(info.lastInsertRowid), chunk.text, chunk.title, chunk.url); } catch { /* FTS может быть недоступен */ }
        }
      });
      run();
    } catch (e) {
      console.warn('[History] saveContentChunks error:', (e as Error).message);
    }
  }

  // Индикатор качества индекса умного поиска (Settings.tsx::HistoryBackfillSection): сколько
  // записей истории реально имеют контентные чанки (не только заголовок+домен). Без фильтра по
  // model_version — любой сохранённый чанк уже сигнал «текст страницы был извлечён», даже если
  // модель эмбеддингов сменилась и сам вектор в нём успел устареть.
  countHistoryWithContent(): number {
    if (!this.#db) return 0;
    try {
      const row = this.#db.prepare(`SELECT COUNT(DISTINCT history_id) c FROM history_content_chunks`).get() as { c: number };
      return row.c;
    } catch (e) {
      console.warn('[History] countHistoryWithContent error:', (e as Error).message);
      return 0;
    }
  }

  // Для HistoryContentBackfill.ts (тихое переоткрытие старых URL для извлечения текста) —
  // все записи без единого чанка, свежее/чаще посещаемые первыми (та же логика приоритета,
  // что у getUnindexedHistory). Шумные (логин/OAuth/голый домен) здесь НЕ отфильтрованы —
  // это делает вызывающая сторона до навигации (isNoisyForEmbedding), чтобы не открывать их
  // вообще, не только не индексировать результат.
  getHistoryWithoutContent(): Array<{ id: number; url: string; title: string }> {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT id, url, title FROM history
        WHERE id NOT IN (SELECT DISTINCT history_id FROM history_content_chunks)
        ORDER BY last_visit DESC
      `).all() as Array<{ id: number; url: string; title: string }>;
    } catch (e) {
      console.warn('[History] getHistoryWithoutContent error:', (e as Error).message);
      return [];
    }
  }

  countAll(): number {
    if (!this.#db) return 0;
    try {
      return (this.#db.prepare(`SELECT COUNT(*) c FROM history`).get() as { c: number }).c;
    } catch (e) {
      console.warn('[History] countAll error:', (e as Error).message);
      return 0;
    }
  }

  getAllContentChunks(modelVersion: string): HistoryContentChunk[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT c.id AS chunkId, c.history_id AS historyId, c.chunk_index AS chunkIndex,
               c.url, h.title AS title, c.text, h.last_visit AS lastVisit, h.visit_count AS visitCount,
               c.vector, c.dims, c.model_version AS modelVersion
        FROM history_content_chunks c
        JOIN history h ON h.id = c.history_id
        WHERE c.model_version = ?
      `).all(modelVersion) as HistoryContentChunk[];
    } catch (e) {
      console.warn('[History] getAllContentChunks error:', (e as Error).message);
      return [];
    }
  }

  // Для кластеризации вкладок (сниппет первого чанка каждой открытой вкладки без повторного
  // извлечения текста страницы) — один запрос вместо N обращений в цикле. Сопоставление по URL,
  // не historyId: у вызывающего есть только url живой вкладки. history.url — UNIQUE (см. #setup
  // ниже) → это уже индекс, WHERE ... IN (...) на десятки значений идёт по нему, не полным
  // сканом. Текст обрезан до 300 символов прямо в SQL (substr) — не тащить килобайты через
  // границу FFI ради сниппета.
  // ⚠️ Сопоставление IN идёт по СЫРЫМ url, как записаны в history.url при визите (recordVisit
  // ничего не нормализует — см. её же тело выше). Если переданный url чуть отличается от
  // сохранённого (другой utm/слэш/фрагмент), матча не будет. Возвращаемый Map намеренно ключуется
  // normalizeForOmnibox(row.url) — тем же нормализованным ключом, что уже используют
  // Toolbar.tsx/HistorySearch.ts (см. shared/frecency.ts), а не сырым url — вызывающая сторона
  // должна нормализовать СВОЙ ключ поиска так же перед обращением к Map.
  // На одном historyId может быть больше одной строки chunk_index=0 (старая версия эмбеддинга +
  // '+prefixed' — обе хранятся, пока explicit не удалены), ORDER BY indexed_at DESC + "не
  // перезаписывать уже увиденный ключ" ниже оставляет самую свежую версию.
  getFirstChunksByUrls(urls: string[]): Map<string, string> {
    const result = new Map<string, string>();
    if (!this.#db || urls.length === 0) return result;
    try {
      const placeholders = urls.map(() => '?').join(',');
      const rows = this.#db.prepare(`
        SELECT h.url AS historyUrl, substr(c.text, 1, 300) AS text
        FROM history h
        JOIN history_content_chunks c ON c.history_id = h.id AND c.chunk_index = 0
        WHERE h.url IN (${placeholders})
        ORDER BY c.indexed_at DESC
      `).all(...urls) as Array<{ historyUrl: string; text: string }>;
      for (const row of rows) {
        const key = normalizeForOmnibox(row.historyUrl);
        if (!result.has(key)) result.set(key, row.text);
      }
    } catch (e) {
      console.warn('[History] getFirstChunksByUrls error:', (e as Error).message);
    }
    return result;
  }

  searchContentChunksFts(query: string, modelVersion: string, limit: number): HistoryContentChunk[] {
    if (!this.#db) return [];
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];
    try {
      return this.#db.prepare(`
        SELECT c.id AS chunkId, c.history_id AS historyId, c.chunk_index AS chunkIndex,
               c.url, h.title AS title, c.text, h.last_visit AS lastVisit, h.visit_count AS visitCount,
               c.vector, c.dims, c.model_version AS modelVersion,
               bm25(history_content_chunks_fts) AS rank
        FROM history_content_chunks_fts
        JOIN history_content_chunks c ON c.id = history_content_chunks_fts.rowid
        JOIN history h ON h.id = c.history_id
        WHERE history_content_chunks_fts MATCH ? AND c.model_version = ?
        ORDER BY rank ASC
        LIMIT ?
      `).all(ftsQuery, modelVersion, limit) as HistoryContentChunk[];
    } catch (e) {
      console.warn('[History] searchContentChunksFts error:', (e as Error).message);
      return [];
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
      this.#deleteContentChunksForHistoryIds([id]);
      this.#db.prepare(`DELETE FROM history_embeddings WHERE history_id = ?`).run(id);
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
          try { db.prepare(`DELETE FROM history_content_chunks_fts`).run(); } catch { /* FTS может быть недоступен */ }
          db.prepare(`DELETE FROM history_content_chunks`).run();
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
          const rows = db.prepare(`SELECT id FROM history WHERE last_visit >= ?`).all(cutoff) as Array<{ id: number }>;
          this.#deleteContentChunksForHistoryIds(rows.map((r) => r.id));
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

      CREATE TABLE IF NOT EXISTS history_content_chunks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        history_id    INTEGER NOT NULL REFERENCES history(id),
        chunk_index   INTEGER NOT NULL,
        url           TEXT    NOT NULL,
        title         TEXT    NOT NULL DEFAULT '',
        text          TEXT    NOT NULL,
        vector        BLOB    NOT NULL,
        dims          INTEGER NOT NULL,
        model_version TEXT    NOT NULL,
        indexed_at    INTEGER NOT NULL,
        UNIQUE(history_id, chunk_index, model_version)
      );
      CREATE INDEX IF NOT EXISTS idx_history_content_chunks_history ON history_content_chunks(history_id);
      CREATE INDEX IF NOT EXISTS idx_history_content_chunks_model ON history_content_chunks(model_version);
    `);
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS history_content_chunks_fts
        USING fts5(text, title, url, tokenize='unicode61');
      `);
    } catch (e) {
      console.warn('[History] FTS5 для content chunks недоступен:', (e as Error).message);
    }
  }

  #deleteContentChunksForHistoryIds(ids: number[]): void {
    if (!this.#db || ids.length === 0) return;
    const db = this.#db;
    const select = db.prepare(`SELECT id FROM history_content_chunks WHERE history_id = ?`);
    let deleteFts: import('better-sqlite3').Statement | null = null;
    try { deleteFts = db.prepare(`DELETE FROM history_content_chunks_fts WHERE rowid = ?`); } catch { /* FTS может быть недоступен */ }
    const deleteChunks = db.prepare(`DELETE FROM history_content_chunks WHERE history_id = ?`);
    for (const id of ids) {
      const chunks = select.all(id) as Array<{ id: number }>;
      for (const chunk of chunks) {
        try { deleteFts?.run(chunk.id); } catch { /* FTS может быть недоступен */ }
      }
      deleteChunks.run(id);
    }
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

function buildFtsQuery(query: string): string {
  const terms = query
    .toLowerCase()
    .split(/[\s\-_/|·•,.:;!?()[\]{}'"«»—–]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .slice(0, 8)
    .map((x) => `"${x.replace(/"/g, '""')}"`);
  return terms.join(' OR ');
}
