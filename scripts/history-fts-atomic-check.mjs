// Проверяет атомарность записи текста и FTS на временной базе Electron ABI.
import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const historyModule = path.resolve('dist-electron/electron/HistoryManager.js');
  const sqliteModule = path.resolve('node_modules/better-sqlite3');
  const dbPath = path.join(ctx.profile, 'history-atomic-check.sqlite');
  const result = await ctx.evalMain(`(async () => {
    const { HistoryManager, TEXT_EXTRACTION_VERSION } = process.mainModule.require(${JSON.stringify(historyModule)});
    const Database = process.mainModule.require(${JSON.stringify(sqliteModule)});
    const history = new HistoryManager(${JSON.stringify(dbPath)});
    await history.initialize();
    const url = 'https://example.com/atomic';
    history.recordVisit(url, 'Atomic');
    const id = history.getIdByUrl(url);
    const chunk = (text) => [{ chunkIndex: 0, url, title: 'Atomic', text, vector: new Float32Array(0), dims: 0 }];
    const first = history.saveContentChunks(id, chunk('старый текст'), TEXT_EXTRACTION_VERSION);
    const before = history.searchContentChunksFts('старый', TEXT_EXTRACTION_VERSION, 5).length;
    const db = new Database(${JSON.stringify(dbPath)});
    db.exec('DROP TABLE history_content_chunks_fts');
    db.close();
    const second = history.saveContentChunks(id, chunk('новый текст'), TEXT_EXTRACTION_VERSION);
    const retained = history.getContentText(id, TEXT_EXTRACTION_VERSION);
    return { first, before, second, retained };
  })()`);
  assert.equal(result.first, true);
  assert.equal(result.before, 1);
  assert.equal(result.second, false);
  assert.equal(result.retained, 'старый текст');
  console.log('При сбое FTS запись откатывается, прежний текст остаётся');
}, { main: true });
