import type { Database } from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { ContentChunkInput } from './HistoryManager';
import { stemText } from './textStemming';

// Предыдущий снимок живёт отдельно: старые версии браузера не удалят его миграцией model_version.
export function setupHistoryContentStore(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS history_content_state (
    history_id INTEGER PRIMARY KEY REFERENCES history(id) ON DELETE CASCADE,
    checked_at INTEGER NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history_previous_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, history_id INTEGER NOT NULL REFERENCES history(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL,
      vector BLOB NOT NULL, dims INTEGER NOT NULL, model_version TEXT NOT NULL, indexed_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_history_previous_page ON history_previous_chunks(history_id);`);
  try { db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS history_previous_chunks_fts USING fts5(text, title, url, tokenize='unicode61');
    CREATE TRIGGER IF NOT EXISTS history_previous_cleanup AFTER DELETE ON history_previous_chunks BEGIN
      DELETE FROM history_previous_chunks_fts WHERE rowid=old.id;
    END;`); }
  catch (error) { console.warn('[History] индекс предыдущего снимка недоступен:', error); }
}

export function saveHistoryContent(db: Database, historyId: number, chunks: ContentChunkInput[], version: string): void {
  db.transaction(() => {
    const hash = createHash('sha256').update(chunks.map(c => c.text).join('\n')).digest('hex');
    const state = db.prepare('SELECT hash FROM history_content_state WHERE history_id = ?').get(historyId) as { hash: string } | undefined;
    if (state?.hash !== hash) {
      const old = db.prepare('SELECT * FROM history_content_chunks WHERE history_id = ? AND model_version = ? ORDER BY chunk_index').all(historyId, version) as Array<{
        id: number; chunk_index: number; url: string; title: string; text: string; vector: Buffer; dims: number; indexed_at: number;
      }>;
      if (old.length) {
        deletePreviousHistoryContent(db, [historyId]);
        const insert = db.prepare(`INSERT INTO history_previous_chunks(history_id,chunk_index,url,title,text,vector,dims,model_version,indexed_at) VALUES(?,?,?,?,?,?,?,?,?)`);
        const fts = db.prepare('INSERT INTO history_previous_chunks_fts(rowid,text,title,url) VALUES(?,?,?,?)');
        for (const row of old) {
          const saved = insert.run(historyId, row.chunk_index, row.url, row.title, row.text, row.vector, row.dims, version, row.indexed_at);
          fts.run(Number(saved.lastInsertRowid), stemText(row.text), stemText(row.title), row.url);
        }
      }
      const deleteFts = db.prepare('DELETE FROM history_content_chunks_fts WHERE rowid = ?');
      for (const row of old) deleteFts.run(row.id);
      db.prepare('DELETE FROM history_content_chunks WHERE history_id = ? AND model_version = ?').run(historyId, version);
      const insert = db.prepare(`INSERT INTO history_content_chunks(history_id,chunk_index,url,title,text,vector,dims,model_version,indexed_at) VALUES(?,?,?,?,?,?,?,?,?)`);
      const fts = db.prepare('INSERT INTO history_content_chunks_fts(rowid,text,title,url) VALUES(?,?,?,?)');
      const capturedAt = Date.now();
      for (const chunk of chunks) {
        const vector = Buffer.from(chunk.vector.buffer, chunk.vector.byteOffset, chunk.vector.byteLength);
        const saved = insert.run(historyId, chunk.chunkIndex, chunk.url, chunk.title, chunk.text, vector, chunk.dims, version, capturedAt);
        fts.run(Number(saved.lastInsertRowid), stemText(chunk.text), stemText(chunk.title), chunk.url);
      }
    }
    db.prepare(`INSERT INTO history_content_state(history_id,checked_at,hash) VALUES(?,?,?)
      ON CONFLICT(history_id) DO UPDATE SET checked_at=excluded.checked_at,hash=excluded.hash`).run(historyId, Date.now(), hash);
  })();
}

export function deletePreviousHistoryContent(db: Database, ids: number[]): void {
  const rows = db.prepare('SELECT id FROM history_previous_chunks WHERE history_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as { id: number }[];
  let remove: import('better-sqlite3').Statement | null = null;
  try { remove = db.prepare('DELETE FROM history_previous_chunks_fts WHERE rowid = ?'); } catch { /* Отсутствие FTS не мешает удалению текста. */ }
  for (const row of rows) remove?.run(row.id);
  db.prepare('DELETE FROM history_previous_chunks WHERE history_id IN (SELECT value FROM json_each(?))').run(JSON.stringify(ids));
}
