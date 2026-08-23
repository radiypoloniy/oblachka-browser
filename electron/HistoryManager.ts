import { app } from 'electron';
import path from 'node:path';
import type { HistoryEntry, HistoryClearPeriod } from '../shared/ipc';
import { isSearchResultUrl } from '../shared/searchEngines';
import { normalizeForOmnibox } from '../shared/frecency';
import { stemText, stemQuery } from './textStemming';
import { sqliteOpenFailed } from './sqliteOpenFailed';

// better-sqlite3 — нативный модуль, может отсутствовать если пересборка не прошла.
// Грузим динамически, чтобы браузер запускался даже без C++ инструментов.
type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

const RECENT_LIMIT = 500;

// Версия поколения ИЗВЛЕЧЕНИЯ+ЧАНКИНГА текста (HistoryIndexer.ts::buildTextChunks/extractEnrichedText),
// независима от версии эмбеддинг-модели — раньше model_version в history_content_chunks паразитировал
// на embeddingService.getModelVersion() (единственная причина, по которой searchHistorySmart/
// saveContentChunks вообще звали requestEmbedding), хотя текст чанка от эмбеддинг-модели никак не
// зависит. Инкрементировать при изменении логики извлечения/чанкинга — старые чанки перестанут
// совпадать по версии и переиндексируются, как и раньше при смене версии эмбеддинг-модели.
export const TEXT_EXTRACTION_VERSION = 'text-v2';

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

  // dbPath задаётся ProfileData: у каждого профиля своя база (см. ProfilePaths.ts). Без
  // аргумента — прежний путь профиля по умолчанию, чтобы менеджер оставался пригодным для
  // разовых проверок и не тянул за собой реестр профилей.
  constructor(dbPath?: string) {
    this.#dbPath = dbPath ?? path.join(app.getPath('userData'), 'history.sqlite');
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
      this.#migrateContentChunksToTextVersion();
      this.#dropEmbeddingsTable();
      console.log('[History] база инициализирована:', this.#dbPath);
    } catch (e) {
      this.#db = sqliteOpenFailed('History', this.#dbPath, e);
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

  // Массовый импорт визитов из другого браузера (electron/browserImport/). Отличается от
  // recordVisit: сохраняет исходный visit_count источника (не единица за визит), при конфликте по
  // url СУММИРУЕТ счётчики и берёт более позднюю дату (повторный импорт/пересечение с нашей
  // историей не затирает, а сливается). Тот же #shouldRecord, что у обычной записи, — импорт не
  // тащит в историю то, что мы и сами бы не записали (шумные/служебные URL). Контент не
  // индексируется (FTS докачается лениво при реальном визите) — сознательно, это тяжёлый процесс.
  bulkImportVisits(visits: Array<{ url: string; title: string; lastVisit: number; visitCount: number }>): { inserted: number; skipped: number } {
    if (!this.#db || visits.length === 0) return { inserted: 0, skipped: 0 };
    const db = this.#db;
    let inserted = 0;
    let skipped = 0;
    try {
      const existsStmt = db.prepare(`SELECT 1 FROM history WHERE url = ? LIMIT 1`);
      const upsert = db.prepare(`
        INSERT INTO history (url, title, last_visit, visit_count)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          title       = excluded.title,
          last_visit  = MAX(history.last_visit, excluded.last_visit),
          visit_count = history.visit_count + excluded.visit_count
      `);
      const run = db.transaction(() => {
        for (const v of visits) {
          if (!this.#shouldRecord(v.url)) { skipped++; continue; }
          // «Уже были» для отчёта = слияние с существующим url (не ошибка, просто не новая строка).
          const isNew = existsStmt.get(v.url) === undefined;
          upsert.run(v.url, v.title || v.url, v.lastVisit, Math.max(1, v.visitCount));
          if (isNew) inserted++; else skipped++;
        }
      });
      run();
    } catch (e) {
      console.warn('[History] bulkImportVisits error:', (e as Error).message);
    }
    return { inserted, skipped };
  }

  // Для HistoryIndexer.ts::indexVisit — источник истины «уже проиндексирована ли эта страница
  // ТЕКУЩЕЙ версией извлечения текста (TEXT_EXTRACTION_VERSION)», вместо in-memory Set, который
  // не переживает рестарт (живой замер: 750-850% CPU на 40с при рестарте с 10 закреплёнными
  // вкладками — каждая переиндексировалась заново, хотя содержимое не менялось). Раньше этот же
  // источник истины смотрел в history_embeddings (hasEmbeddingForVersion, удалена вместе с
  // вызовом embed из indexVisit — эмбеддинги в пути индексации больше не считаются) — теперь
  // history_content_chunks, где реально пишется text-v1.
  hasContentForVersion(historyId: number, textVersion: string): boolean {
    if (!this.#db) return false;
    try {
      const row = this.#db.prepare(`
        SELECT 1 FROM history_content_chunks WHERE history_id = ? AND model_version = ? LIMIT 1
      `).get(historyId, textVersion);
      return row !== undefined;
    } catch (e) {
      console.warn('[History] hasContentForVersion error:', (e as Error).message);
      return false;
    }
  }

  /**
   * Сохранённый текст страницы одной строкой — снимок прошлого визита (см. electron/PageChanges.ts).
   * Пусто — эту страницу не индексировали (индексируются не все, см. HistoryNoiseFilter).
   * ⚠️ Чанки склеиваются В ПОРЯДКЕ chunk_index: разбивка на чанки не несёт смысла для сравнения,
   * а перепутанный порядок сделал бы «изменением» простую перестановку абзацев.
   */
  getContentText(historyId: number, modelVersion: string): string {
    if (!this.#db) return '';
    try {
      const rows = this.#db.prepare(`
        SELECT text FROM history_content_chunks
        WHERE history_id = ? AND model_version = ?
        ORDER BY chunk_index ASC
      `).all(historyId, modelVersion) as Array<{ text: string }>;
      return rows.map((r) => r.text).join('\n');
    } catch (e) {
      console.warn('[History] getContentText error:', (e as Error).message);
      return '';
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
          // Стеммим ТОЛЬКО копию для FTS — chunk.text/chunk.title выше в history_content_chunks
          // остаются как есть (сниппеты, промпт Qwen). url не стеммим — не проза, стеммер на нём
          // не навредит (латиница проходит без изменений), но и пользы нет, лишний повод для сомнений.
          try { insertFts?.run(Number(info.lastInsertRowid), stemText(chunk.text), stemText(chunk.title), chunk.url); } catch { /* FTS может быть недоступен */ }
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

  /** Визиты начиная с момента времени — для «итогов дня» (см. DayDigest.ts). Только чтение. */
  getSince(sinceMs: number, limit = 400): HistoryEntry[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT id, url, title, last_visit AS lastVisit, visit_count AS visitCount
        FROM history
        WHERE last_visit >= ?
        ORDER BY last_visit DESC
        LIMIT ?
      `).all(sinceMs, limit) as HistoryEntry[];
    } catch (e) {
      console.warn('[History] getSince error:', (e as Error).message);
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
          // history_content_chunks.history_id → history(id) БЕЗ ON DELETE CASCADE, а foreign_keys=ON
          // (#setup) — DELETE FROM history без предварительной чистки детей падает на FK constraint.
          // Порядок обязателен: сначала дети, потом родители.
          try { db.prepare(`DELETE FROM history_content_chunks_fts`).run(); } catch { /* FTS может быть недоступен */ }
          db.prepare(`DELETE FROM history_content_chunks`).run();
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

      -- Key-value для разовых идемпотентных миграций, которым нужен явный маркер «уже сделано»,
      -- а не переносимый в данные признак (см. #rebuildFtsWithStemming — версия стемминга FTS).
      CREATE TABLE IF NOT EXISTS history_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
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

  // Разовая (идемпотентная) миграция на TEXT_EXTRACTION_VERSION — вызывается на каждом старте после
  // #setup(), но реально что-то трогает только один раз (после первого прогона WHERE ниже не находит
  // строк). Старые чанки тегированы версией ЭМБЕДДИНГ-модели (см. историю ниже) — просто UPDATE
  // model_version='text-v1' сломал бы UNIQUE(history_id, chunk_index, model_version): на живой базе
  // подтверждено (2026-07-2x) — 116 пар (history_id, chunk_index) одновременно держат СТАРУЮ
  // (без суффикса) и НОВУЮ (+prefixed) версию одного и того же чанка (смена схемы префиксов раньше
  // не удаляла старые строки, см. EmbedClient.ts::MODEL_VERSION_SUFFIX) — обе версии сколлапсировались
  // бы в один и тот же (history_id, chunk_index, 'text-v1') ключ. Поэтому сначала дедуп: в каждой
  // такой паре остаётся строка с МАКСИМАЛЬНЫМ id (PRIMARY KEY AUTOINCREMENT — самая свежая по вставке,
  // без ничьих, в отличие от indexed_at, где коллизия миллисекунды теоретически возможна), остальные
  // и их FTS-записи удаляются. Текст не меняется нигде — только тег версии и то, какая из ДУБЛИРУЮЩИХ
  // записей одного чанка остаётся.
  #migrateContentChunksToTextVersion(): void {
    if (!this.#db) return;
    const db = this.#db;
    try {
      const run = db.transaction(() => {
        const stale = db.prepare(`
          SELECT id FROM history_content_chunks
          WHERE id NOT IN (SELECT MAX(id) FROM history_content_chunks GROUP BY history_id, chunk_index)
        `).all() as Array<{ id: number }>;
        if (stale.length > 0) {
          let deleteFts: import('better-sqlite3').Statement | null = null;
          try { deleteFts = db.prepare(`DELETE FROM history_content_chunks_fts WHERE rowid = ?`); } catch { /* FTS может быть недоступен */ }
          const deleteChunk = db.prepare(`DELETE FROM history_content_chunks WHERE id = ?`);
          for (const row of stale) {
            try { deleteFts?.run(row.id); } catch { /* FTS может быть недоступен */ }
            deleteChunk.run(row.id);
          }
          console.log(`[History] миграция text-v1: удалено ${stale.length} устаревших дублей чанков (разные версии одного (history_id, chunk_index))`);
        }
        const { changes } = db.prepare(`
          UPDATE history_content_chunks SET model_version = ? WHERE model_version != ?
        `).run(TEXT_EXTRACTION_VERSION, TEXT_EXTRACTION_VERSION);
        if (changes > 0) console.log(`[History] миграция text-v1: перетегировано ${changes} чанков`);
      });
      run();
    } catch (e) {
      console.warn('[History] migrateContentChunksToTextVersion error:', (e as Error).message);
    }
  }

  // Разовая (идемпотентная) миграция — вызывается на каждом старте после #setup(), реально
  // что-то делает только один раз. history_embeddings (векторы истории для семантического поиска)
  // осталась без единого вызывающего после удаления searchHistorySemantic/getAllEmbeddings/
  // HistoryBackfill.ts — грепом по кодовой базе перед этим коммитом подтверждено, что таблица
  // ничем больше не читается и не пишется. IF EXISTS — не падает на уже удалённой таблице
  // при повторных запусках.
  #dropEmbeddingsTable(): void {
    if (!this.#db) return;
    try {
      this.#db.exec(`DROP TABLE IF EXISTS history_embeddings;`);
    } catch (e) {
      console.warn('[History] dropEmbeddingsTable error:', (e as Error).message);
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
  // stemQuery ДО разбиения на термины — тот же textStemming.ts::stemText, что уже стеммит
  // индекс при записи (см. saveContentChunks/rebuildFtsWithStemming). Расхождение здесь дало бы
  // тихий пустой результат: запрос искал бы нестеммленные токены в стеммленном индексе.
  const terms = stemQuery(query)
    .toLowerCase()
    .split(/[\s\-_/|·•,.:;!?()[\]{}'"«»—–]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .slice(0, 8)
    .map((x) => `"${x.replace(/"/g, '""')}"`);
  return terms.join(' OR ');
}
