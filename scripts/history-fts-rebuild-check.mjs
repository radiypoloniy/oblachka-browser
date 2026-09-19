// Миграция FTS проверяется на отдельной базе временного профиля.
import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const historyModule = path.resolve('dist-electron/electron/HistoryManager.js');
  const stemModule = path.resolve('dist-electron/electron/textStemming.js');
  const sqliteModule = path.resolve('node_modules/better-sqlite3');
  const dbPath = path.join(ctx.profile, 'history-rebuild-check.sqlite');
  const result = await ctx.evalMain(`(async () => {
    const { HistoryManager, TEXT_EXTRACTION_VERSION } = process.mainModule.require(${JSON.stringify(historyModule)});
    const { stemText, STEM_VERSION } = process.mainModule.require(${JSON.stringify(stemModule)});
    const Database = process.mainModule.require(${JSON.stringify(sqliteModule)});
    const first = new HistoryManager(${JSON.stringify(dbPath)});
    await first.initialize();
    const url = 'https://example.com/rebuild';
    first.recordVisit(url, 'Машины');
    const id = first.getIdByUrl(url);
    const saved = first.saveContentChunks(id, [{ chunkIndex: 0, url, title: 'Машины',
      text: 'Красивые машины', vector: new Float32Array(0), dims: 0 }], TEXT_EXTRACTION_VERSION);
    const db = new Database(${JSON.stringify(dbPath)});
    db.prepare('UPDATE history_content_chunks_fts SET text = ? WHERE rowid = ?').run('испорченный индекс', 1);
    db.prepare("DELETE FROM history_meta WHERE key = 'fts_stem_version'").run();
    const insertMany = db.transaction(() => {
      const insertHistory = db.prepare('INSERT INTO history(url, title, last_visit, visit_count) VALUES (?, ?, ?, 1)');
      const insertChunk = db.prepare('INSERT INTO history_content_chunks(history_id, chunk_index, url, title, text, vector, dims, model_version, indexed_at) VALUES (?, 0, ?, ?, ?, ?, 0, ?, ?)');
      for (let i = 0; i < 1000; i++) {
        const otherUrl = 'https://example.com/extra/' + i;
        const historyId = Number(insertHistory.run(otherUrl, 'Extra', Date.now()).lastInsertRowid);
        insertChunk.run(historyId, otherUrl, 'Extra', 'Дополнительный текст', Buffer.alloc(0), TEXT_EXTRACTION_VERSION, Date.now());
      }
    });
    insertMany();
    const started = Date.now();
    const second = new HistoryManager(${JSON.stringify(dbPath)});
    await second.initialize();
    const rebuildMs = Date.now() - started;
    const row = db.prepare('SELECT text FROM history_content_chunks_fts WHERE rowid = ?').get(1);
    const marker = db.prepare("SELECT value FROM history_meta WHERE key = 'fts_stem_version'").get();
    const hits = second.searchContentChunksFts('машина', TEXT_EXTRACTION_VERSION, 5).length;
    const ftsRows = db.prepare('SELECT COUNT(*) AS n FROM history_content_chunks_fts').get().n;
    db.close();
    return { saved, text: row?.text, expected: stemText('Красивые машины'), marker: marker?.value, version: STEM_VERSION, hits, ftsRows, rebuildMs };
  })()`);
  if (result.text !== result.expected) console.error(ctx.appLog.join('').slice(-1500));
  assert.equal(result.saved, true);
  assert.equal(result.text, result.expected);
  assert.equal(result.marker, result.version);
  assert.equal(result.hits, 1);
  assert.equal(result.ftsRows, 1001);
  console.log(`FTS пересобран из 1001 чанка за ${result.rebuildMs} мс, версия отмечена после миграции`);
}, { main: true });
