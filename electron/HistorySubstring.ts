import type { Database } from 'better-sqlite3';
import type { HistoryEntry, HistoryPageRequest } from '../shared/ipc';
import { historyLookupReady, historyTrigrams } from './HistoryLookup';
import { historyFilterSql } from './HistoryFilters';

export function readHistorySubstring(db: Database, request: HistoryPageRequest, limit: number): HistoryEntry[] {
  const { query, before } = request;
  const filter = historyFilterSql(request.filters, 'h.');
  const cursor = before ? ' AND h.last_visit<=? AND (h.last_visit<? OR h.id<?)' : '';
  const args: (string | number)[] = [...(before ? [before.lastVisit,before.lastVisit,before.id] : []), ...filter.args];
  const base = `1${cursor}${filter.sql}`, order = 'h.last_visit DESC,h.id DESC';
  const projection = 'h.id,h.url,h.title,h.last_visit AS lastVisit,h.visit_count AS visitCount';
  if (!query.trim()) return db.prepare(`SELECT ${projection} FROM history h WHERE ${base} ORDER BY ${order} LIMIT ?`).all(...args,limit) as HistoryEntry[];
  const ready = historyLookupReady(db), grams = ready ? historyTrigrams(query) : null;
  const unicode = ready && /[^\x00-\x7F]/.test(query);
  const match = unicode ? '(history_lower(h.url) LIKE ? OR history_lower(h.title) LIKE ?)' : '(h.url LIKE ? OR h.title LIKE ?)';
  const like = `%${unicode ? query.toLowerCase() : query}%`;
  if (grams) {
    try {
      // Материализуем только небольшой набор; частые запросы сохраняют прежний проход по дате.
      const ids = db.prepare('SELECT rowid FROM history_lookup WHERE history_lookup MATCH ? LIMIT 4097').all(grams) as { rowid: number }[];
      if (ids.length <= 4096) return db.prepare(`SELECT ${projection} FROM history h WHERE ${base}
        AND h.id IN (SELECT value FROM json_each(?)) AND ${match} ORDER BY ${order} LIMIT ?`).all(...args,JSON.stringify(ids.map(r=>r.rowid)),like,like,limit) as HistoryEntry[];
    } catch (error) { console.warn('[History] индекс подстрок недоступен, используем LIKE:', error); }
  }
  return db.prepare(`SELECT ${projection} FROM history h WHERE ${base} AND ${match} ORDER BY ${order} LIMIT ?`).all(...args,like,like,limit) as HistoryEntry[];
}
