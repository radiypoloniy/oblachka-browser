// Ранжирование истории по frecency (частота × свежесть).
// Используется и на хабе (плитки), и в омнибоксе (саджесты) — чистые функции.

import type { HistoryEntry } from './ipc';

// Веса бакетов свежести — крутятся без переписывания логики.
const BUCKET_WEIGHT_TODAY  = 4;
const BUCKET_WEIGHT_WEEK   = 2;
const BUCKET_WEIGHT_MONTH  = 1;
const BUCKET_WEIGHT_OLDER  = 0.25;

const MS_DAY   = 24 * 60 * 60 * 1000;
const MS_WEEK  = 7  * MS_DAY;
const MS_MONTH = 30 * MS_DAY;

function recencyWeight(lastVisit: number, now: number): number {
  const age = now - lastVisit;
  if (age < MS_DAY)   return BUCKET_WEIGHT_TODAY;
  if (age < MS_WEEK)  return BUCKET_WEIGHT_WEEK;
  if (age < MS_MONTH) return BUCKET_WEIGHT_MONTH;
  return BUCKET_WEIGHT_OLDER;
}

export function scoreEntry(entry: HistoryEntry, now: number): number {
  return entry.visitCount * recencyWeight(entry.lastVisit, now);
}

// Схлопывает URL до origin без www — ключ дедупликации для плиток.
// https://www.github.com/foo?bar=1 → https://github.com
export function normalizeForTiles(url: string): string {
  try {
    const u = new URL(url);
    const hostname = u.hostname.replace(/^www\./, '');
    return `${u.protocol}//${hostname}`;
  } catch {
    return url;
  }
}

// Полный URL без utm-параметров и фрагментов — для дедупликации в омнибоксе.
export function normalizeForOmnibox(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(key)) u.searchParams.delete(key);
    }
    // trailing slash у root-пути убираем
    let result = u.toString();
    if (u.pathname === '/' && result.endsWith('/')) result = result.slice(0, -1);
    return result;
  } catch {
    return url;
  }
}

export interface TileSite {
  origin: string;   // ключ дедупликации (нормализованный)
  url: string;      // URL последнего/лучшего визита
  title: string;
  score: number;
}

// Топ-N сайтов по frecency, по одному на домен.
export function getTopSites(entries: HistoryEntry[], n: number): TileSite[] {
  const now = Date.now();
  const byOrigin = new Map<string, TileSite>();

  for (const entry of entries) {
    const origin = normalizeForTiles(entry.url);
    const score = scoreEntry(entry, now);
    const existing = byOrigin.get(origin);
    if (!existing || score > existing.score) {
      byOrigin.set(origin, { origin, url: entry.url, title: entry.title, score });
    }
  }

  return [...byOrigin.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

// Сортирует записи истории по frecency-баллу (убывание).
export function rankByFrecency(entries: HistoryEntry[]): HistoryEntry[] {
  const now = Date.now();
  return [...entries].sort((a, b) => scoreEntry(b, now) - scoreEntry(a, now));
}
