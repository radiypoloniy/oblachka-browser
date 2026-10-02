import type { Database } from 'better-sqlite3';
const generations = new WeakMap<Database, number>();

// Большой импорт не должен синхронно оплачивать триграммы для каждой записи.
export function resetHistoryLookupForImport(db: Database): boolean {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='history_lookup'").get()) return false;
  db.exec('DROP TRIGGER IF EXISTS history_lookup_insert; DROP TRIGGER IF EXISTS history_lookup_update; DROP TRIGGER IF EXISTS history_lookup_delete;');
  db.prepare("INSERT INTO history_lookup(history_lookup) VALUES('delete-all')").run();
  db.prepare('DELETE FROM history_lookup_ids').run();
  db.prepare("UPDATE history_meta SET value='0' WHERE key='trigram-ready'").run();
  generations.set(db, (generations.get(db) ?? 0) + 1);
  return true;
}

export function historyLookupReady(db: Database): boolean {
  try { return (db.prepare("SELECT value FROM history_meta WHERE key='trigram-ready'").get() as { value: string } | undefined)?.value === '1'; }
  catch { return false; }
}

export function setupHistoryLookup(db: Database, allowWork: () => boolean = () => true): void {
  db.transaction(() => db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS history_lookup USING fts5(title,url,content='history',content_rowid='id',tokenize='trigram',detail='none');
    CREATE TABLE IF NOT EXISTS history_lookup_ids(id INTEGER PRIMARY KEY);
    CREATE TRIGGER IF NOT EXISTS history_lookup_insert AFTER INSERT ON history BEGIN
      INSERT INTO history_lookup(rowid,title,url) VALUES(new.id,new.title,new.url);
      INSERT OR REPLACE INTO history_lookup_ids VALUES(new.id);
    END;
    CREATE TRIGGER IF NOT EXISTS history_lookup_delete AFTER DELETE ON history WHEN EXISTS(SELECT 1 FROM history_lookup_ids WHERE id=old.id) BEGIN
      INSERT INTO history_lookup(history_lookup,rowid,title,url) VALUES('delete',old.id,old.title,old.url);
      DELETE FROM history_lookup_ids WHERE id=old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS history_lookup_update AFTER UPDATE OF title,url ON history WHEN old.title!=new.title OR old.url!=new.url BEGIN
      INSERT INTO history_lookup(history_lookup,rowid,title,url) SELECT 'delete',old.id,old.title,old.url WHERE EXISTS(SELECT 1 FROM history_lookup_ids WHERE id=old.id);
      INSERT INTO history_lookup(rowid,title,url) VALUES(new.id,new.title,new.url);
      INSERT OR REPLACE INTO history_lookup_ids VALUES(new.id);
    END;
  `))();
  if (historyLookupReady(db)) return;
  const generation = (generations.get(db) ?? 0) + 1;
  generations.set(db, generation);
  // Старую историю достраиваем малыми транзакциями; до готовности поиск использует прежний путь.
  let cursor = 0;
  const mark = db.prepare("INSERT INTO history_meta(key,value) VALUES('trigram-ready','1') ON CONFLICT(key) DO UPDATE SET value='1'");
  const step = () => {
    if (generations.get(db) !== generation) return;
    if (!allowWork()) { setTimeout(step, 1000).unref(); return; }
    try {
      const rows = db.prepare('SELECT id,title,url FROM history WHERE id>? ORDER BY id LIMIT 64').all(cursor) as { id: number; title: string; url: string }[];
      if (!rows.length) { mark.run(); return; }
      db.transaction(() => {
        const exists = db.prepare('SELECT 1 FROM history_lookup_ids WHERE id=?');
        const insert = db.prepare('INSERT INTO history_lookup(rowid,title,url) VALUES(?,?,?)');
        const indexed = db.prepare('INSERT INTO history_lookup_ids VALUES(?)');
        for (const row of rows) if (!exists.get(row.id)) { insert.run(row.id,row.title,row.url); indexed.run(row.id); }
      })();
      cursor = rows.at(-1)!.id;
      setTimeout(step, 25).unref();
    } catch (error) { console.warn('[History] достройка триграмм отложена:', error); }
  };
  if (!db.prepare('SELECT 1 FROM history LIMIT 1').get()) mark.run();
  else setTimeout(step, 500).unref();
}

export function historyTrigrams(query: string): string | null {
  const literal = query.toLowerCase().split(/[%_]/).sort((a,b)=>b.length-a.length)[0] ?? '';
  const chars = [...literal];
  if (chars.length < 3) return null;
  // detail=none не хранит позиции: несколько триграмм дают кандидатов, LIKE проверяет целую подстроку.
  const grams = new Set<string>();
  const count = Math.min(6, chars.length - 2);
  for (let i=0;i<count;i++) {
    const start=count===1?0:Math.floor((chars.length-3)*i/(count-1));
    grams.add(`"${chars.slice(start,start+3).join('').replace(/"/g,'""')}"`);
  }
  return [...grams].join(' AND ');
}
