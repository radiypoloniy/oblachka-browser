import type { Database } from 'better-sqlite3';
import type { HistoryEntry, HistoryPage, HistoryPageRequest } from '../shared/ipc';

export function readHistoryPage(db: Database, request: HistoryPageRequest): HistoryPage {
  const { query, before } = request;
  if (typeof query !== 'string' || (before && (!Number.isSafeInteger(before.id) || before.id < 1
    || !Number.isSafeInteger(before.lastVisit) || before.lastVisit < 0))) {
    throw new Error('Invalid history page request');
  }
  const conditions: string[] = [], args: (string | number)[] = [];
  if (query.trim()) {
    conditions.push('(url LIKE ? OR title LIKE ?)');
    args.push(`%${query}%`, `%${query}%`);
  }
  if (before) {
    // Переход по ключу не пропускает записи с одинаковым временем и не читает OFFSET строк.
    conditions.push('last_visit <= ? AND (last_visit < ? OR id < ?)');
    args.push(before.lastVisit, before.lastVisit, before.id);
  }
  const rows = db.prepare(`SELECT id, url, title, last_visit AS lastVisit, visit_count AS visitCount
    FROM history ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY last_visit DESC, id DESC LIMIT 501`).all(...args) as HistoryEntry[];
  const entries = rows.slice(0, 500), last = entries.at(-1);
  return { entries, ...(rows.length > 500 && last ? { next: { lastVisit: last.lastVisit, id: last.id } } : {}) };
}
