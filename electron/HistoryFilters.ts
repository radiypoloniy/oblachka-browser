import type { Database } from 'better-sqlite3';
import type { HistorySearchFilters } from '../shared/ipc';

export function historyHostname(url: unknown): string {
  try { return typeof url === 'string' ? new URL(url).hostname.toLowerCase() : ''; }
  catch { return ''; }
}
export function installHistoryFunctions(db: Database): void {
  db.function('history_hostname', { deterministic: true }, historyHostname);
}
export function historyFilterSql(filters?: HistorySearchFilters, prefix = ''): { sql: string; args: (string | number)[] } {
  const conditions: string[] = [], args: (string | number)[] = [];
  for (const key of ['from', 'to'] as const) {
    const value = filters?.[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid history period');
    conditions.push(`${prefix}last_visit ${key === 'from' ? '>=' : '<'} ?`); args.push(value);
  }
  if (filters?.from !== undefined && filters.to !== undefined && filters.from >= filters.to) throw new Error('Invalid history period');
  if (filters?.domain) {
    const raw = filters.domain.trim();
    if (raw.length > 253) throw new Error('Invalid history domain');
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    if (!host || url.username || url.password) throw new Error('Invalid history domain');
    // Граница поддомена исключает похожие адреса и host в пути/userinfo.
    conditions.push(`(history_hostname(${prefix}url) = ? OR history_hostname(${prefix}url) LIKE ?)`);
    args.push(host, `%.${host}`);
  }
  return { sql: conditions.length ? ` AND ${conditions.join(' AND ')}` : '', args };
}
