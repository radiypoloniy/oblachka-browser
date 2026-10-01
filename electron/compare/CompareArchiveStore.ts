import type { CompareSnapshot, CompareArchivePage } from '../../shared/compareArchive';
import { compareArchiveEntry } from '../../shared/compareArchive';
import { parseCompareArchiveEntry, parseCompareSnapshot } from '../../shared/compareArchiveValidation';

// Отдельная база профиля: очистка истории посещений не удаляет сохранённые решения.
// Один UPSERT атомарен; ошибки чтения не приводят к пересозданию или стиранию файла.
export class CompareArchiveStore {
  private db: import('better-sqlite3').Database;
  constructor(file: string) {
    const Sqlite = require('better-sqlite3') as typeof import('better-sqlite3');
    this.db = new Sqlite(file);
    try {
      const version = this.db.pragma('user_version', { simple: true });
      if (version !== 0 && version !== 1) throw new Error('Архив сравнений создан более новой версией браузера');
      this.db.pragma('journal_mode = WAL');
      this.db.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS comparison (
          id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, search_text TEXT NOT NULL,
          entry TEXT NOT NULL, snapshot TEXT NOT NULL
        ); CREATE INDEX IF NOT EXISTS comparison_date ON comparison(updated_at DESC);
        PRAGMA user_version = 1;`);
      })();
    } catch (e) { this.db.close(); throw e; }
  }
  save(snapshot: CompareSnapshot): void {
    const entry = compareArchiveEntry(snapshot);
    const search = [entry.title, entry.summary, ...entry.products.flatMap(p => [p.title, p.url])].join(' ').toLocaleLowerCase();
    this.db.prepare(`INSERT INTO comparison VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, search_text=excluded.search_text,
        entry=excluded.entry, snapshot=excluded.snapshot`).run(snapshot.id, snapshot.updatedAt, search, JSON.stringify(entry), JSON.stringify(snapshot));
  }
  list(query: string, offset: number): CompareArchivePage {
    const q = query.trim().toLocaleLowerCase().slice(0, 200);
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM comparison WHERE instr(search_text, ?) > 0').get(q) as { n: number }).n;
    const rows = this.db.prepare('SELECT entry FROM comparison WHERE instr(search_text, ?) > 0 ORDER BY updated_at DESC, id DESC LIMIT 60 OFFSET ?').all(q, offset) as { entry: string }[];
    return { entries: rows.map(r => parseCompareArchiveEntry(JSON.parse(r.entry))), total, hasMore: offset + rows.length < total };
  }
  get(id: string): CompareSnapshot | null {
    const row = this.db.prepare('SELECT snapshot FROM comparison WHERE id = ?').get(id) as { snapshot: string } | undefined;
    if (!row) return null;
    const snapshot = parseCompareSnapshot(JSON.parse(row.snapshot));
    if (snapshot.id !== id) throw new Error('Некорректный идентификатор сравнения');
    return snapshot;
  }
  remove(id: string): void { this.db.prepare('DELETE FROM comparison WHERE id = ?').run(id); }
  close(): void { this.db.close(); }
}
