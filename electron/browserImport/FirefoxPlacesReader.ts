import path from 'node:path';
import type { BookmarkManager } from '../BookmarkManager';
import type { HistoryManager } from '../HistoryManager';
import type { ImportBookmarkNode, ImportTypeResult } from '../../shared/ipc';
import { withCopiedDb } from './chromiumSqlite';

// Закладки и история Firefox. ⚠️ Оба типа лежат в ОДНОМ файле places.sqlite — в отличие от Chromium
// с отдельными Bookmarks (JSON) и History (SQLite). Отсюда один модуль на два импортёра: таблицы
// moz_places и moz_bookmarks связаны, и разносить их по файлам значило бы дважды описывать одну схему.

// Firefox хранит время как PRTime — МИКРОсекунды с 1970-01-01 UTC. Не эпоха Chromium (та от 1601-го
// года) и не миллисекунды JS: перепутать легко, а ошибка тихая — импортированные закладки просто
// окажутся в 1970-м или в далёком будущем, и порядок в списке развалится.
function prTimeToUnixMs(raw: number | bigint | null | undefined): number {
  if (raw === null || raw === undefined) return Date.now();
  try {
    const micros = typeof raw === 'bigint' ? raw : BigInt(Math.trunc(Number(raw)));
    if (micros <= 0n) return Date.now();
    return Number(micros / 1000n);
  } catch {
    return Date.now();
  }
}

interface PlaceRow {
  url: string;
  title: string | null;
  last_visit_date: number | bigint | null;
  visit_count: number | null;
}

export function importFirefoxHistory(profilePath: string, history: HistoryManager): ImportTypeResult | null {
  const dbPath = path.join(profilePath, 'places.sqlite');
  return withCopiedDb(dbPath, (db) => {
    // hidden = 1 — редиректы и служебные записи (то же значение, что у Chromium), их не тащим.
    const rows = db.prepare(`
      SELECT url, title, last_visit_date, visit_count
      FROM moz_places
      WHERE visit_count > 0 AND hidden = 0
    `).all() as PlaceRow[];
    const visits = rows
      // place: — внутренние запросы Firefox («Недавние закладки» и подобные умные папки), это не
      // адреса и в истории браузера им не место.
      .filter((r) => r.url && !r.url.startsWith('place:'))
      .map((r) => ({
        url: r.url,
        title: r.title ?? '',
        lastVisit: prTimeToUnixMs(r.last_visit_date),
        visitCount: r.visit_count ?? 1,
      }));
    return history.bulkImportVisits(visits);
  });
}

interface BookmarkRow {
  id: number;
  type: number;         // 1 — закладка, 2 — папка, 3 — разделитель
  parent: number;
  title: string | null;
  dateAdded: number | bigint | null;
  position: number;
  guid: string | null;
  url: string | null;
}

const TYPE_BOOKMARK = 1;
const TYPE_FOLDER = 2;

// ⚠️ Корни берём по GUID, а не по числовым id. Id корней (2 — меню, 3 — панель, 5 — прочие,
// 6 — мобильные) стабильны у свежесозданного профиля, но профиль, переживший восстановление из
// резервной копии, получает другие номера — а guid Firefox сохраняет. Ошибка была бы тихой:
// импортировалось бы «что-то», но не то.
const ROOT_GUIDS = new Set(['menu________', 'toolbar_____', 'unfiled_____', 'mobile______']);
// Теги — не закладки: это плоский словарь меток, который Firefox держит в том же дереве. Перенос
// дал бы человеку папку с дублями всех помеченных страниц.
const TAGS_GUID = 'tags________';

export function importFirefoxBookmarks(profilePath: string, bookmarks: BookmarkManager): ImportTypeResult | null {
  const dbPath = path.join(profilePath, 'places.sqlite');
  return withCopiedDb(dbPath, (db) => {
    const rows = db.prepare(`
      SELECT b.id, b.type, b.parent, b.title, b.dateAdded, b.position, b.guid, p.url
      FROM moz_bookmarks b
      LEFT JOIN moz_places p ON p.id = b.fk
      ORDER BY b.parent, b.position
    `).all() as BookmarkRow[];

    // Дети по родителю: порядок внутри родителя уже задан ORDER BY position.
    const childrenOf = new Map<number, BookmarkRow[]>();
    const tagsRoot = rows.find((r) => r.guid === TAGS_GUID)?.id;
    for (const row of rows) {
      if (row.parent === tagsRoot) continue; // ветку тегов не переносим целиком
      const list = childrenOf.get(row.parent);
      if (list) list.push(row); else childrenOf.set(row.parent, [row]);
    }

    const toTree = (row: BookmarkRow): ImportBookmarkNode | null => {
      const createdAt = prTimeToUnixMs(row.dateAdded);
      if (row.type === TYPE_BOOKMARK) {
        // place: — умные папки Firefox, не настоящие адреса (см. импорт истории выше).
        if (!row.url || row.url.startsWith('place:')) return null;
        return { kind: 'link', title: row.title || row.url, url: row.url, createdAt };
      }
      if (row.type !== TYPE_FOLDER) return null; // разделитель переносить некуда
      const children = (childrenOf.get(row.id) ?? []).map(toTree).filter((n): n is ImportBookmarkNode => n !== null);
      if (children.length === 0) return null; // пустые папки не переносим, см. bulkInsertTree
      return { kind: 'folder', title: row.title || 'Без названия', createdAt, children };
    };

    // ⚠️ Содержимое корней (панель, меню, прочие, мобильные) кладём на НАШ корень, а не в папки с
    // их именами — ровно как в импорте Chromium: «Панель закладок» для человека это место, а не
    // папка, и заворачивание добавило бы уровень, которого у него не было.
    const items: ImportBookmarkNode[] = [];
    for (const root of rows.filter((r) => r.guid && ROOT_GUIDS.has(r.guid))) {
      for (const child of childrenOf.get(root.id) ?? []) {
        const tree = toTree(child);
        if (tree) items.push(tree);
      }
    }
    return bookmarks.bulkInsertTree(items, null);
  });
}
