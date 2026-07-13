import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { BookmarkEntry, BulkBookmarkInput } from '../shared/ipc';

// better-sqlite3 — нативный модуль, может отсутствовать если пересборка не прошла.
// Грузим динамически, тот же приём, что HistoryManager.ts — браузер должен запускаться
// даже без C++ инструментов, просто без закладок.
type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

export class BookmarkManager {
  #db: Database | null = null;
  #dbPath: string;

  constructor() {
    // Отдельный файл, не таблица внутри history.sqlite — разный жизненный цикл и разный
    // профиль риска (clearHistory('all') делает bulk DELETE по всей истории; отдельный файл
    // физически не даёт этой логике случайно задеть закладки). Тот же паттерн «один менеджер —
    // один файл», что уже используется в проекте (PasswordManager.ts → passwords.sqlite,
    // VpnKeyStore.ts → vpn-subscription.enc, SettingsManager.ts → settings.json).
    this.#dbPath = path.join(app.getPath('userData'), 'bookmarks.sqlite');
  }

  async initialize(): Promise<void> {
    let SqliteConstructor: BetterSqlite3 | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      SqliteConstructor = require('better-sqlite3') as BetterSqlite3;
    } catch (e) {
      console.warn('[Bookmarks] better-sqlite3 не загружен — закладки отключены:', (e as Error).message);
      return;
    }

    try {
      this.#db = new SqliteConstructor(this.#dbPath);
      this.#setup();
      console.log('[Bookmarks] база инициализирована:', this.#dbPath);
    } catch (e) {
      console.error('[Bookmarks] не удалось открыть БД:', (e as Error).message);
      try {
        fs.unlinkSync(this.#dbPath);
        this.#db = new SqliteConstructor!(this.#dbPath);
        this.#setup();
        console.log('[Bookmarks] БД пересоздана после ошибки');
      } catch (e2) {
        console.error('[Bookmarks] пересоздание БД провалилось — закладки отключены:', (e2 as Error).message);
        this.#db = null;
      }
    }
  }

  // Feature 1 всегда кладёт в корень (parent_id NULL) — колонка parent_id/position в схеме
  // уже готова под будущие папки, но сам код папок (createFolder/move/reorder) сознательно
  // не пишем, пока нет реального UI, который бы их вызывал (см. план).
  add(url: string, title: string): BookmarkEntry | null {
    if (!this.#db || !url) return null;
    try {
      const now = Date.now();
      const position = this.#nextRootPosition();
      this.#db.prepare(`
        INSERT INTO bookmarks (url, title, parent_id, position, created_at)
        VALUES (?, ?, NULL, ?, ?)
        ON CONFLICT(url) WHERE parent_id IS NULL DO UPDATE SET title = excluded.title
      `).run(url, title || url, position, now);
      // ON CONFLICT DO UPDATE не даёт lastInsertRowid новой строки надёжно на всех путях —
      // перечитываем по url, это одна лёгкая SELECT, не узкое место.
      return this.#getByUrlRoot(url);
    } catch (e) {
      console.warn('[Bookmarks] add error:', (e as Error).message);
      return null;
    }
  }

  // Снятие звезды из омнибокса — не требует знания id, только URL текущей вкладки.
  // Убирает ЛЮБОЕ вхождение этого URL (во всех папках) — на плоском UI это ровно то,
  // что ожидает пользователь от «убрать из закладок».
  removeByUrl(url: string): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`DELETE FROM bookmarks WHERE url = ?`).run(url);
    } catch (e) {
      console.warn('[Bookmarks] removeByUrl error:', (e as Error).message);
    }
  }

  remove(id: number): void {
    if (!this.#db) return;
    try {
      this.#db.prepare(`DELETE FROM bookmarks WHERE id = ?`).run(id);
    } catch (e) {
      console.warn('[Bookmarks] remove error:', (e as Error).message);
    }
  }

  isBookmarked(url: string): boolean {
    if (!this.#db || !url) return false;
    try {
      const row = this.#db.prepare(`SELECT 1 FROM bookmarks WHERE url = ? LIMIT 1`).get(url);
      return row !== undefined;
    } catch (e) {
      console.warn('[Bookmarks] isBookmarked error:', (e as Error).message);
      return false;
    }
  }

  // Плоский список корня — единственное, что использует Feature 1 UI.
  list(): BookmarkEntry[] {
    if (!this.#db) return [];
    try {
      return this.#db.prepare(`
        SELECT id, url, title, parent_id AS parentId, position, created_at AS createdAt
        FROM bookmarks
        WHERE parent_id IS NULL
        ORDER BY position ASC, id ASC
      `).all() as BookmarkEntry[];
    } catch (e) {
      console.warn('[Bookmarks] list error:', (e as Error).message);
      return [];
    }
  }

  // Шов под импорт (следующий заход) — bulkInsert пока никем не вызывается, но проверяет,
  // что схема (parent_id/position + уникальный индекс на дубли в корне) реально выдерживает
  // массовую вставку в одной транзакции. items должны идти родитель-перед-детьми — вызывающая
  // сторона (будущий importer) сама формирует такой порядок обходом дерева браузера-источника.
  bulkInsert(items: BulkBookmarkInput[]): { inserted: number; skipped: number } {
    if (!this.#db || items.length === 0) return { inserted: 0, skipped: 0 };
    const db = this.#db;
    let inserted = 0;
    let skipped = 0;
    try {
      const run = db.transaction(() => {
        const insert = db.prepare(`
          INSERT OR IGNORE INTO bookmarks (url, title, parent_id, position, created_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const item of items) {
          const info = insert.run(
            item.url, item.title || item.url, item.parentId, item.position,
            item.createdAt ?? Date.now(),
          );
          if (info.changes > 0) inserted++; else skipped++;
        }
      });
      run();
    } catch (e) {
      console.warn('[Bookmarks] bulkInsert error:', (e as Error).message);
    }
    return { inserted, skipped };
  }

  // ── Приватное ────────────────────────────────────────────────────────────────

  #setup(): void {
    const db = this.#db!;
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        url         TEXT    NOT NULL,
        title       TEXT    NOT NULL DEFAULT '',
        parent_id   INTEGER REFERENCES bookmarks(id),
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bookmarks_parent_position ON bookmarks(parent_id, position);
      -- ⚠️ Обычный UNIQUE(parent_id, url) НЕ сработал бы для корня: SQLite считает каждый NULL
      -- уникальным относительно других NULL даже внутри составного индекса, так что дубликаты
      -- с parent_id=NULL и одинаковым url прошли бы мимо составного индекса незамеченными.
      -- Частичный индекс с WHERE parent_id IS NULL — однoколоночный (только url) в области
      -- своего действия, поэтому NULL там ни при чём. Для папок (parent_id NOT NULL) — свой
      -- отдельный частичный индекс, добавится вместе с кодом папок.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_no_dup_root ON bookmarks(url) WHERE parent_id IS NULL;
    `);
  }

  #nextRootPosition(): number {
    if (!this.#db) return 0;
    const row = this.#db.prepare(`
      SELECT COALESCE(MAX(position), -1) + 1 AS next FROM bookmarks WHERE parent_id IS NULL
    `).get() as { next: number };
    return row.next;
  }

  #getByUrlRoot(url: string): BookmarkEntry | null {
    if (!this.#db) return null;
    const row = this.#db.prepare(`
      SELECT id, url, title, parent_id AS parentId, position, created_at AS createdAt
      FROM bookmarks WHERE url = ? AND parent_id IS NULL
    `).get(url) as BookmarkEntry | undefined;
    return row ?? null;
  }
}
