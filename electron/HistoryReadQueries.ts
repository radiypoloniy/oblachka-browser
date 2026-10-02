import type { Database } from 'better-sqlite3';
import type { HistoryEntry, HistoryContentCoverage } from '../shared/ipc';
import { isNoisyForEmbedding } from '../shared/historyIndex';
import type { HistoryContentChunk } from './HistoryManager';
import { historyFtsTerms } from './textStemming';
import { prepareHistoryCandidateChunks } from './HistorySearchSnippet';

export type CandidateChunk = Pick<HistoryContentChunk, 'historyId' | 'url' | 'title' | 'text' | 'lastVisit' | 'visitCount'> & { snippet?: string };
export interface CandidateRows { lexical: HistoryEntry[]; chunks: CandidateChunk[] }
export type HistoryReadRequest =
  | { kind: 'recent'; limit: number }
  | { kind: 'search'; query: string; limit: number }
  | { kind: 'candidates'; query: string; version: string; lexicalLimit: number; ftsLimit: number }
  | { kind: 'coverage' };
export interface HistoryReadResults {
  recent: HistoryEntry[];
  search: HistoryEntry[];
  candidates: CandidateRows;
  coverage: HistoryContentCoverage;
}

export function readRecent(db: Database, limit: number): HistoryEntry[] {
  return db.prepare(`SELECT id, url, title, last_visit AS lastVisit, visit_count AS visitCount
    FROM history ORDER BY last_visit DESC LIMIT ?`).all(limit) as HistoryEntry[];
}
export function readSearch(db: Database, query: string, limit: number): HistoryEntry[] {
  const like = `%${query}%`;
  return db.prepare(`SELECT id, url, title, last_visit AS lastVisit, visit_count AS visitCount
    FROM history WHERE url LIKE ? OR title LIKE ? ORDER BY last_visit DESC LIMIT ?`).all(like, like, limit) as HistoryEntry[];
}
export function buildFtsQuery(query: string): string {
  // Тот же стемминг, что при записи индекса; исходные тексты чанков не меняются.
  return historyFtsTerms(query)
    .map(x => `"${x.replace(/"/g, '""')}"`).join(' OR ');
}
export function readFts(db: Database, query: string, version: string, limit: number): HistoryContentChunk[] {
  const match = buildFtsQuery(query);
  if (!match) return [];
  return db.prepare(`
    SELECT c.id AS chunkId, c.history_id AS historyId, c.chunk_index AS chunkIndex,
      c.url, h.title AS title, c.text, h.last_visit AS lastVisit, h.visit_count AS visitCount,
      c.vector, c.dims, c.model_version AS modelVersion, bm25(history_content_chunks_fts) AS rank
    FROM history_content_chunks_fts
    JOIN history_content_chunks c ON c.id = history_content_chunks_fts.rowid
    JOIN history h ON h.id = c.history_id
    WHERE history_content_chunks_fts MATCH ? AND c.model_version = ?
    ORDER BY rank ASC LIMIT ?`).all(match, version, limit) as HistoryContentChunk[];
}
export function executeHistoryRead(db: Database, request: HistoryReadRequest): HistoryReadResults[keyof HistoryReadResults] {
  switch (request.kind) {
    case 'recent': return readRecent(db, request.limit);
    case 'search': return readSearch(db, request.query, request.limit);
    case 'candidates': return db.transaction(() => {
      // Оба источника видят один снимок при параллельной записи индекса в main.
      let chunks: CandidateChunk[] = [], lexical: HistoryEntry[] = [];
      try { chunks = prepareHistoryCandidateChunks(readFts(db, request.query, request.version, request.ftsLimit), request.query); }
      catch (error) { console.warn('[HistoryReader] FTS:', error); }
      try { lexical = readSearch(db, request.query, request.lexicalLimit); }
      catch (error) { console.warn('[HistoryReader] lexical:', error); }
      return { chunks, lexical };
    })();
    case 'coverage': return db.transaction(() => {
      const count = (db.prepare('SELECT COUNT(DISTINCT history_id) c FROM history_content_chunks').get() as { c: number }).c;
      const rows = db.prepare(`SELECT url, title FROM history
        WHERE id NOT IN (SELECT DISTINCT history_id FROM history_content_chunks)`).iterate() as Iterable<{ url: string; title: string }>;
      // Большой список не материализуется в памяти и не пересылается в main.
      let noisy = 0, missing = 0;
      for (const row of rows) { if (isNoisyForEmbedding(row.url, row.title)) noisy++; else missing++; }
      return { withContent: count, noisy, missing, total: count + noisy + missing };
    })();
  }
}
