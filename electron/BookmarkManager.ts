import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { BookmarkEntry, BookmarkNode, BulkBookmarkInput, ImportBookmarkNode } from '../shared/ipc';
import { setupBookmarksSchema } from './bookmarksSchema';

// better-sqlite3 — нативный модуль, может отсутствовать если пересборка не прошла.
// Грузим динамически, тот же приём, что HistoryManager.ts — браузер должен запускаться
// даже без C++ инструментов, просто без закладок.
type Database = import('better-sqlite3').Database;
type BetterSqlite3 = typeof import('better-sqlite3');

// Один список колонок на все выборки: строки уезжают наружу как BookmarkEntry, и разъехавшийся
// SELECT в одном из методов дал бы запись без kind — то есть папку, неотличимую от ссылки.
const COLUMNS = `id, kind, url, title, parent_id AS parentId, position, created_at AS createdAt`;
// Папки выше ссылок на одном уровне — как в проводнике и в самих браузерах; внутри — по позиции.
const ORDER = `ORDER BY kind = 'link', position ASC, id ASC`;

export class BookmarkManager {
  #db: Database | null = null;
  #dbPath: string;

  // dbPath задаётся только в проверочном прогоне (scripts/bookmarks-schema-check.mjs): с явным
  // путём менеджер не трогает app.getPath, а значит запускается вне Electron — и логику папок
  // (кольца при переносе, сборку дерева) можно прогнать по-настоящему, а не прочитать глазами.
  constructor(dbPath?: string) {
    if (dbPath) { this.#dbPath = dbPath; return; }
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

  // parentId=null — корень (звезда в омнибоксе кладёт именно так, пока нет выбора папки).
  add(url: string, title: string, parentId: number | null = null): BookmarkEntry | null {
    if (!this.#db || !url) return null;
    try {
      const now = Date.now();
      const position = this.#nextPosition(parentId);
      // ⚠️ Два разных ON CONFLICT, потому что дубли ловят ДВА разных частичных индекса
      // (см. bookmarksSchema.ts): в корне уникален url, внутри папки — пара parent_id+url.
      // Одним запросом это не выражается: целевой индекс в ON CONFLICT указывается явно.
      if (parentId === null) {
        this.#db.prepare(`
          INSERT INTO bookmarks (kind, url, title, parent_id, position, created_at)
          VALUES ('link', ?, ?, NULL, ?, ?)
          ON CONFLICT(url) WHERE parent_id IS NULL AND kind = 'link'
            DO UPDATE SET title = excluded.title
        `).run(url, title || url, position, now);
      } else {
        this.#db.prepare(`
          INSERT INTO bookmarks (kind, url, title, parent_id, position, created_at)
          VALUES ('link', ?, ?, ?, ?, ?)
          ON CONFLICT(parent_id, url) WHERE parent_id IS NOT NULL AND kind = 'link'
            DO UPDATE SET title = excluded.title
        `).run(url, title || url, parentId, position, now);
      }
      // ON CONFLICT DO UPDATE не даёт lastInsertRowid новой строки надёжно на всех путях —
      // перечитываем по url, это одна лёгкая SELECT, не узкое место.
      return this.#getByUrl(url, parentId);
    } catch (e) {
      console.warn('[Bookmarks] add error:', (e as Error).message);
      return null;
    }
  }

  // ── Папки ────────────────────────────────────────────────────────────────────

  createFolder(title: string, parentId: number | null = null): BookmarkEntry | null {
    if (!this.#db) return null;
    try {
      // Папки НЕ дедуплицируются по имени: две папки «Работа» — законная ситуация (у человека
      // может быть работа и в корне, и внутри «Архива»), а автоматическое слияние по имени
      // молча смешало бы разное содержимое.
      const info = this.#db.prepare(`
        INSERT INTO bookmarks (kind, url, title, parent_id, position, created_at)
        VALUES ('folder', '', ?, ?, ?, ?)
      `).run(title || 'Новая папка', parentId, this.#nextPosition(parentId), Date.now());
      return this.#getById(Number(info.lastInsertRowid));
    } catch (e) {
      console.warn('[Bookmarks] createFolder error:', (e as Error).message);
      return null;
    }
  }

  rename(id: number, title: string): boolean {
    if (!this.#db) return false;
    try {
      const info = this.#db.prepare(`UPDATE bookmarks SET title = ? WHERE id = ?`).run(title, id);
      return info.changes > 0;
    } catch (e) {
      console.warn('[Bookmarks] rename error:', (e as Error).message);
      return false;
    }
  }

  // Правка адреса — только у ссылок: у папки адреса нет, и запись его туда сломала бы
  // инвариант «url папки пуст», на котором стоят оба индекса уникальности.
  setUrl(id: number, url: string): boolean {
    if (!this.#db || !url) return false;
    try {
      const info = this.#db.prepare(`UPDATE bookmarks SET url = ? WHERE id = ? AND kind = 'link'`).run(url, id);
      return info.changes > 0;
    } catch (e) {
      console.warn('[Bookmarks] setUrl error:', (e as Error).message);
      return false;
    }
  }

  /**
   * Переносит запись в другого родителя и на заданное место. position=null — в конец.
   *
   * ⚠️ Папку нельзя положить внутрь самой себя или своего потомка: получилось бы кольцо, которое
   * не видно ни в одном индексе — такая ветка просто исчезла бы из дерева (обход от корня в неё
   * не заходит), а CASCADE при удалении родителя её бы не достал. Проверка обязана быть здесь:
   * SQLite ссылочной целостностью циклы не ловит, для него это законные строки.
   */
  move(id: number, parentId: number | null, position: number | null = null): boolean {
    if (!this.#db) return false;
    try {
      if (parentId !== null) {
        if (parentId === id) return false;
        const target = this.#getById(parentId);
        if (!target || target.kind !== 'folder') return false;
        if (this.#isDescendant(parentId, id)) return false;
      }
      const pos = position ?? this.#nextPosition(parentId);
      const info = this.#db.prepare(`UPDATE bookmarks SET parent_id = ?, position = ? WHERE id = ?`)
        .run(parentId, pos, id);
      return info.changes > 0;
    } catch (e) {
      console.warn('[Bookmarks] move error:', (e as Error).message);
      return false;
    }
  }

  /** Новый порядок внутри ОДНОГО родителя: позиции переписываются по индексу в массиве. */
  reorder(parentId: number | null, orderedIds: number[]): boolean {
    if (!this.#db || orderedIds.length === 0) return false;
    const db = this.#db;
    try {
      db.transaction(() => {
        // parent_id пишем тоже: перетаскивание в панели нередко и переносит, и меняет порядок
        // одним жестом, а два отдельных запроса на один жест дали бы промежуточное состояние.
        const upd = db.prepare(`UPDATE bookmarks SET position = ?, parent_id = ? WHERE id = ?`);
        orderedIds.forEach((id, i) => upd.run(i, parentId, id));
      })();
      return true;
    } catch (e) {
      console.warn('[Bookmarks] reorder error:', (e as Error).message);
      return false;
    }
  }

  // Снятие звезды из омнибокса — не требует знания id, только URL текущей вкладки.
  // Убирает ЛЮБОЕ вхождение этого URL (во всех папках) — на плоском UI это ровно то,
  // что ожидает пользователь от «убрать из закладок».
  // ⚠️ kind = 'link' обязательно: у папок url пустой, и без этого условия removeByUrl('')
  // снесло бы разом ВСЕ папки. Пустой url отсекается и проверкой выше — но полагаться на одну
  // защиту в запросе, который удаляет строки, не стоит.
  removeByUrl(url: string): void {
    if (!this.#db || !url) return;
    try {
      this.#db.prepare(`DELETE FROM bookmarks WHERE url = ? AND kind = 'link'`).run(url);
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
      const row = this.#db.prepare(`SELECT 1 FROM bookmarks WHERE url = ? AND kind = 'link' LIMIT 1`).get(url);
      return row !== undefined;
    } catch (e) {
      console.warn('[Bookmarks] isBookmarked error:', (e as Error).message);
      return false;
    }
  }

  /** Содержимое одного уровня: корня (parentId=null) или конкретной папки. */
  list(parentId: number | null = null): BookmarkEntry[] {
    if (!this.#db) return [];
    try {
      const sql = `SELECT ${COLUMNS} FROM bookmarks WHERE parent_id ${parentId === null ? 'IS NULL' : '= ?'} ${ORDER}`;
      const stmt = this.#db.prepare(sql);
      return (parentId === null ? stmt.all() : stmt.all(parentId)) as BookmarkEntry[];
    } catch (e) {
      console.warn('[Bookmarks] list error:', (e as Error).message);
      return [];
    }
  }

  /**
   * Всё дерево целиком, папки со своими children.
   *
   * ⚠️ Один SELECT на всю таблицу и сборка в памяти, а не рекурсивный обход с запросом на
   * каждую папку: закладок у человека тысячи, а папок сотни — «запрос на папку» превратился бы
   * в сотни обращений к диску ради данных, которые целиком влезают в память одним чтением.
   * Записи, оторвавшиеся от несуществующего родителя, в дерево не попадут — поэтому в конце
   * стоит проверка, что собранное совпало по количеству с прочитанным.
   */
  listTree(): BookmarkNode[] {
    if (!this.#db) return [];
    try {
      const rows = this.#db.prepare(`SELECT ${COLUMNS} FROM bookmarks ${ORDER}`).all() as BookmarkEntry[];
      const byId = new Map<number, BookmarkNode>();
      for (const r of rows) byId.set(r.id, { ...r, children: r.kind === 'folder' ? [] : undefined });

      const roots: BookmarkNode[] = [];
      let attached = 0;
      for (const r of rows) {
        const node = byId.get(r.id)!;
        if (r.parentId === null) { roots.push(node); attached++; continue; }
        const parent = byId.get(r.parentId);
        // Родитель есть, но он не папка — данные испорчены; вешаем в корень, чтобы запись не
        // пропала с глаз совсем: потерянную закладку человек хотя бы увидит и разберётся.
        if (parent?.children) { parent.children.push(node); attached++; } else { roots.push(node); attached++; }
      }
      if (attached !== rows.length) console.warn('[Bookmarks] listTree: потеряно записей:', rows.length - attached);
      return roots;
    } catch (e) {
      console.warn('[Bookmarks] listTree error:', (e as Error).message);
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
          INSERT OR IGNORE INTO bookmarks (kind, url, title, parent_id, position, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const item of items) {
          // Папка приезжает из импорта с пустым url — kind решает всё, а не «пустой ли адрес».
          const kind = item.kind ?? 'link';
          const info = insert.run(
            kind, kind === 'folder' ? '' : item.url, item.title || item.url, item.parentId, item.position,
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

  /**
   * Импорт ДЕРЕВОМ: папки создаются, вложенность сохраняется. Одной транзакцией — импорт либо
   * приезжает целиком, либо не приезжает вовсе, а не половиной дерева.
   *
   * ⚠️ Пустые папки НЕ создаются. У любого живого профиля Chrome их десятки (заготовки, следы
   * синхронизации), и перенести их значило бы отдать человеку дерево, где половина веток пустая.
   *
   * ⚠️ Папка с ТАКИМ ЖЕ именем у того же родителя ПЕРЕИСПОЛЬЗУЕТСЯ, а не создаётся второй раз.
   * Это расходится с createFolder, где одноимённые папки законны, и намеренно: там имя выбирает
   * человек и две «Работы» — его право, а здесь повторный импорт иначе удваивал бы всё дерево.
   * Ссылки от дублей защищает индекс уникальности (origin+url в пределах папки).
   */
  bulkInsertTree(nodes: ImportBookmarkNode[], parentId: number | null = null): { inserted: number; skipped: number } {
    if (!this.#db || nodes.length === 0) return { inserted: 0, skipped: 0 };
    const db = this.#db;
    let inserted = 0;
    let skipped = 0;

    // Есть ли внутри ветки хоть одна ссылка — иначе папку не заводим.
    const hasLinks = (n: ImportBookmarkNode): boolean =>
      n.kind === 'link' ? !!n.url : (n.children ?? []).some(hasLinks);

    try {
      const insertLink = db.prepare(`
        INSERT OR IGNORE INTO bookmarks (kind, url, title, parent_id, position, created_at)
        VALUES ('link', ?, ?, ?, ?, ?)
      `);
      // Поиск существующей папки — два подготовленных запроса, а не один с подстановкой:
      // parent_id сравнивается через IS NULL либо через =, и одним текстом это не выражается.
      const findRootFolder = db.prepare(`SELECT id FROM bookmarks WHERE kind='folder' AND title=? AND parent_id IS NULL`);
      const findSubFolder = db.prepare(`SELECT id FROM bookmarks WHERE kind='folder' AND title=? AND parent_id=?`);
      const insertFolder = db.prepare(`
        INSERT INTO bookmarks (kind, url, title, parent_id, position, created_at)
        VALUES ('folder', '', ?, ?, ?, ?)
      `);

      const walk = (list: ImportBookmarkNode[], parent: number | null): void => {
        let pos = this.#nextPosition(parent);
        for (const n of list) {
          if (n.kind === 'link') {
            if (!n.url) continue;
            const info = insertLink.run(n.url, n.title || n.url, parent, pos++, n.createdAt ?? Date.now());
            if (info.changes > 0) inserted++; else skipped++;
            continue;
          }
          if (!hasLinks(n)) continue;
          const existing = (parent === null
            ? findRootFolder.get(n.title)
            : findSubFolder.get(n.title, parent)) as { id: number } | undefined;
          const folderId = existing?.id ?? Number(
            insertFolder.run(n.title || 'Без названия', parent, pos++, n.createdAt ?? Date.now()).lastInsertRowid,
          );
          walk(n.children ?? [], folderId);
        }
      };

      db.transaction(() => walk(nodes, parentId))();
    } catch (e) {
      console.warn('[Bookmarks] bulkInsertTree error:', (e as Error).message);
    }
    return { inserted, skipped };
  }

  // ── Приватное ────────────────────────────────────────────────────────────────

  // Схема и миграции — в bookmarksSchema.ts, отдельным модулем без импортов из 'electron':
  // это единственный код закладок, трогающий файл с реальными данными, и он обязан проверяться
  // прогоном (scripts/bookmarks-schema-check.mjs), а не чтением глазами.
  #setup(): void {
    const outcome = setupBookmarksSchema(this.#db!, this.#dbPath);
    if (outcome.action === 'migrated') {
      console.log(`[Bookmarks] схема обновлена v${outcome.from} → v2, снимок: ${outcome.backup ?? 'не сделан'}`);
    }
  }

  #nextPosition(parentId: number | null): number {
    if (!this.#db) return 0;
    const row = (parentId === null
      ? this.#db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM bookmarks WHERE parent_id IS NULL`).get()
      : this.#db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM bookmarks WHERE parent_id = ?`).get(parentId)
    ) as { next: number };
    return row.next;
  }

  #getById(id: number): BookmarkEntry | null {
    if (!this.#db) return null;
    const row = this.#db.prepare(`SELECT ${COLUMNS} FROM bookmarks WHERE id = ?`).get(id) as BookmarkEntry | undefined;
    return row ?? null;
  }

  #getByUrl(url: string, parentId: number | null): BookmarkEntry | null {
    if (!this.#db) return null;
    const sql = `SELECT ${COLUMNS} FROM bookmarks WHERE url = ? AND kind = 'link' AND parent_id ${parentId === null ? 'IS NULL' : '= ?'}`;
    const stmt = this.#db.prepare(sql);
    const row = (parentId === null ? stmt.get(url) : stmt.get(url, parentId)) as BookmarkEntry | undefined;
    return row ?? null;
  }

  /** Является ли candidate потомком ancestor — защита от кольца в move(). */
  #isDescendant(candidate: number, ancestor: number): boolean {
    if (!this.#db) return false;
    const row = this.#db.prepare(`
      WITH RECURSIVE up(id, parent_id) AS (
        SELECT id, parent_id FROM bookmarks WHERE id = ?
        UNION ALL
        SELECT b.id, b.parent_id FROM bookmarks b JOIN up ON b.id = up.parent_id
      )
      SELECT 1 AS hit FROM up WHERE id = ? LIMIT 1
    `).get(candidate, ancestor) as { hit: number } | undefined;
    return row !== undefined;
  }
}
