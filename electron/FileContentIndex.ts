// Профильный FTS по содержимому завершённых загрузок. Историю и её схему не меняет.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { DownloadEntry } from '../shared/ipc';
import { isDocumentFile } from '../shared/documentFormats';
import { stemText, stemQuery, STEM_VERSION } from './textStemming';
import { profileDataPath } from './ProfilePaths';
import { sqliteOpenFailed } from './sqliteOpenFailed';
import { makeSearchSnippet } from './SearchSnippet';

type Database = import('better-sqlite3').Database;
type FileRow = { id: string; filename: string; save_path: string; size: number; mtime_ms: number };
export type FileContentHit = { downloadId: string; title: string; savePath: string; snippet: string };
type WorkerResult = { ok: boolean; text?: string; error?: string };

const MAX_FILE_BYTES = 64 * 1024 * 1024;
// Совпадает с лимитом FileExtract: не теряем вторую половину уже извлечённого документа.
const MAX_INDEX_CHARS = 200_000;
const CHUNK_CHARS = 1400;
const MAX_CHUNKS = Math.ceil(MAX_INDEX_CHARS / CHUNK_CHARS);

function chunksOf(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, MAX_INDEX_CHARS);
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length && chunks.length < MAX_CHUNKS; start += CHUNK_CHARS) {
    chunks.push(normalized.slice(start, start + CHUNK_CHARS));
  }
  return chunks;
}

function ftsQuery(query: string): string {
  return stemQuery(query).toLowerCase()
    .split(/[\s\-_/|·•,.:;!?()[\]{}'"«»—–]+/)
    .filter((term) => term.length >= 2)
    .slice(0, 8)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' OR ');
}

class FileTextReader {
  #worker: Worker | null = null;
  #nextId = 0;
  #tail: Promise<void> = Promise.resolve();
  #pending = new Map<number, { resolve: (result: WorkerResult) => void; timer: ReturnType<typeof setTimeout> }>();

  read(filePath: string): Promise<WorkerResult> {
    const job = this.#tail.then(() => this.#readOne(filePath));
    this.#tail = job.then(() => undefined, () => undefined);
    return job;
  }

  async #readOne(filePath: string): Promise<WorkerResult> {
    if (!this.#worker) this.#start();
    const id = ++this.#nextId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#reset('таймаут извлечения файла');
      }, 30_000);
      this.#pending.set(id, { resolve, timer });
      this.#worker!.postMessage({ id, filePath });
    });
  }

  #start(): void {
    const worker = new Worker(path.join(__dirname, 'FileTextWorker.js'));
    worker.unref();
    worker.on('message', (message: { id: number; result: WorkerResult }) => {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(message.id);
      pending.resolve(message.result);
    });
    worker.on('error', (error) => {
      if (this.#worker === worker) this.#reset(error.message);
    });
    worker.on('exit', (code) => {
      if (this.#worker === worker) this.#reset(`воркер завершился: ${code}`);
    });
    this.#worker = worker;
  }

  #reset(error: string): void {
    const worker = this.#worker;
    this.#worker = null;
    if (worker) void worker.terminate();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error });
    }
    this.#pending.clear();
  }
}

const reader = new FileTextReader();

export class FileContentIndex {
  readonly #db: Database | null;
  #syncing: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(profileId: string, dbPath = profileDataPath(profileId, 'file-content.sqlite')) {
    let db: Database | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sqlite = require('better-sqlite3') as typeof import('better-sqlite3');
      db = new Sqlite(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.exec(`
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY, filename TEXT NOT NULL, save_path TEXT NOT NULL,
          size INTEGER NOT NULL, mtime_ms REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chunks (
          id INTEGER PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL, text TEXT NOT NULL,
          UNIQUE(file_id, chunk_index)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, tokenize='unicode61');
        CREATE TABLE IF NOT EXISTS file_index_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      const version = db.prepare("SELECT value FROM file_index_meta WHERE key = 'stem_version'").get() as { value: string } | undefined;
      if (version?.value !== STEM_VERSION) {
        const rebuild = db.transaction(() => {
          db!.prepare('DELETE FROM chunks_fts').run();
          const nextRows = db!.prepare('SELECT id, text FROM chunks WHERE id > ? ORDER BY id LIMIT 256');
          const insert = db!.prepare('INSERT INTO chunks_fts(rowid, text) VALUES (?, ?)');
          let lastId = 0;
          while (true) {
            const rows = nextRows.all(lastId) as Array<{ id: number; text: string }>;
            if (rows.length === 0) break;
            for (const row of rows) insert.run(row.id, stemText(row.text));
            lastId = rows[rows.length - 1].id;
          }
          db!.prepare("INSERT INTO file_index_meta(key, value) VALUES ('stem_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .run(STEM_VERSION);
        });
        rebuild();
      }
    } catch (error) {
      db = sqliteOpenFailed('FileContentIndex', dbPath, error);
    }
    this.#db = db;
  }

  schedule(entries: DownloadEntry[]): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.sync(entries);
    }, 1500);
  }

  sync(entries: DownloadEntry[]): Promise<void> {
    if (!this.#db) return Promise.resolve();
    if (this.#syncing) return this.#syncing.then(() => this.sync(entries));
    const job = this.#sync(entries).catch((error: unknown) => {
      console.warn('[FileContentIndex] синхронизация не удалась:', error);
    });
    this.#syncing = job;
    return job.finally(() => { if (this.#syncing === job) this.#syncing = null; });
  }

  async #sync(entries: DownloadEntry[]): Promise<void> {
    const db = this.#db!;
    const eligible = entries.filter((entry) =>
      entry.state === 'completed' && !!entry.savePath && isDocumentFile(entry.filename) && !entry.fileMissing,
    );
    const wanted = new Set(eligible.map((entry) => entry.id));
    const stored = db.prepare('SELECT id, filename, save_path, size, mtime_ms FROM files').all() as FileRow[];
    for (const row of stored) if (!wanted.has(row.id)) this.#remove(row.id);
    const byId = new Map(stored.map((row) => [row.id, row]));

    for (const entry of eligible) {
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try { stat = await fs.stat(entry.savePath); } catch { this.#remove(entry.id); continue; }
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) { this.#remove(entry.id); continue; }
      const old = byId.get(entry.id);
      if (old?.save_path === entry.savePath && old.filename === entry.filename
        && old.size === stat.size && old.mtime_ms === stat.mtimeMs) continue;
      this.#remove(entry.id);
      const extracted = await reader.read(entry.savePath);
      if (!extracted.ok || !extracted.text) continue;
      // Файл мог поменяться во время разбора; не сохраняем смесь двух версий.
      let after: Awaited<ReturnType<typeof fs.stat>>;
      try { after = await fs.stat(entry.savePath); } catch { continue; }
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) continue;
      const chunks = chunksOf(extracted.text);
      if (chunks.length === 0) continue;
      const write = db.transaction(() => {
        db.prepare('INSERT INTO files(id, filename, save_path, size, mtime_ms) VALUES (?, ?, ?, ?, ?)')
          .run(entry.id, entry.filename, entry.savePath, stat.size, stat.mtimeMs);
        const insertChunk = db.prepare('INSERT INTO chunks(file_id, chunk_index, text) VALUES (?, ?, ?)');
        const insertFts = db.prepare('INSERT INTO chunks_fts(rowid, text) VALUES (?, ?)');
        for (const [index, text] of chunks.entries()) {
          const row = insertChunk.run(entry.id, index, text);
          insertFts.run(Number(row.lastInsertRowid), stemText(text));
        }
      });
      try { write(); } catch (error) { console.warn('[FileContentIndex] запись не удалась:', error); }
    }
  }

  #remove(id: string): void {
    const db = this.#db;
    if (!db) return;
    const remove = db.transaction(() => {
      const rows = db.prepare('SELECT id FROM chunks WHERE file_id = ?').all(id) as Array<{ id: number }>;
      const deleteFts = db.prepare('DELETE FROM chunks_fts WHERE rowid = ?');
      for (const row of rows) deleteFts.run(row.id);
      db.prepare('DELETE FROM files WHERE id = ?').run(id);
    });
    remove();
  }

  search(query: string, limit = 8): FileContentHit[] {
    const db = this.#db;
    const match = ftsQuery(query);
    if (!db || !match) return [];
    try {
      const rows = db.prepare(`
        SELECT f.id AS downloadId, f.filename AS title, f.save_path AS savePath,
               c.text AS snippet, bm25(chunks_fts) AS rank
        FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
        JOIN files f ON f.id = c.file_id
        WHERE chunks_fts MATCH ? ORDER BY rank ASC LIMIT ?
      `).all(match, limit * MAX_CHUNKS) as Array<FileContentHit & { rank: number }>;
      const seen = new Set<string>();
      return rows.filter((row) => {
        if (seen.has(row.downloadId)) return false;
        seen.add(row.downloadId);
        return true;
      }).slice(0, limit).map((row) => ({
        downloadId: row.downloadId, title: row.title, savePath: row.savePath,
        snippet: makeSearchSnippet(row.snippet, query),
      }));
    } catch (error) {
      console.warn('[FileContentIndex] поиск не удался:', error);
      return [];
    }
  }
}

const byProfile = new Map<string, FileContentIndex>();
export function fileContentIndexFor(profileId: string): FileContentIndex {
  let index = byProfile.get(profileId);
  if (!index) { index = new FileContentIndex(profileId); byProfile.set(profileId, index); }
  return index;
}
