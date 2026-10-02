import type { Database } from 'better-sqlite3';
import type { HistoryPage, HistoryPageRequest } from '../shared/ipc';
import { readHistorySubstring } from './HistorySubstring';

export function readHistoryPage(db: Database, request: HistoryPageRequest): HistoryPage {
  const { query, before } = request;
  if (typeof query !== 'string' || (before && (!Number.isSafeInteger(before.id) || before.id < 1
    || !Number.isSafeInteger(before.lastVisit) || before.lastVisit < 0))) {
    throw new Error('Invalid history page request');
  }
  const rows = readHistorySubstring(db, request, 501);
  const entries = rows.slice(0, 500), last = entries.at(-1);
  return { entries, ...(rows.length > 500 && last ? { next: { lastVisit: last.lastVisit, id: last.id } } : {}) };
}
