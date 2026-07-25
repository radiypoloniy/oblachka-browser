import path from 'node:path';
import type { HistoryManager } from '../HistoryManager';
import type { ImportTypeResult } from '../../shared/ipc';
import { withCopiedDb, chromeTimeToUnixMs } from './chromiumSqlite';

// Чтение истории из профиля Chromium. Таблица `urls` (url, title, last_visit_time, visit_count) —
// одинакова у Chrome/Edge/Brave/Яндекс/Opera/Vivaldi, не зашифрована (в отличие от Login Data).
// Файл History залочен работающим браузером — читаем через копию (см. chromiumSqlite.ts).

interface UrlRow {
  url: string;
  title: string | null;
  last_visit_time: number | bigint | null;
  visit_count: number | null;
}

export function importChromiumHistory(profilePath: string, history: HistoryManager): ImportTypeResult | null {
  const dbPath = path.join(profilePath, 'History');
  const result = withCopiedDb(dbPath, (db) => {
    // Только реальные страницы с посещениями. hidden=1 — служебные записи Chromium (редиректы и
    // т.п.), их не тащим. Порядок не важен — bulkImportVisits сам мержит по url.
    const rows = db.prepare(`
      SELECT url, title, last_visit_time, visit_count
      FROM urls
      WHERE visit_count > 0 AND hidden = 0
    `).all() as UrlRow[];
    const visits = rows.map((r) => ({
      url: r.url,
      title: r.title ?? '',
      lastVisit: chromeTimeToUnixMs(r.last_visit_time),
      visitCount: r.visit_count ?? 1,
    }));
    return history.bulkImportVisits(visits);
  });
  return result; // null — файл залочен намертво/битый/нет модуля (см. withCopiedDb)
}
