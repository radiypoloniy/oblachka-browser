// Худший случай для FTS: каждая из 12 страниц заняла все 8 чанков.
import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const historyModule = path.resolve('dist-electron/electron/HistoryManager.js');
  const searchModule = path.resolve('dist-electron/electron/HistorySearch.js');
  const result = await ctx.evalMain(`(async () => {
    const { HistoryManager, TEXT_EXTRACTION_VERSION } = process.mainModule.require(${JSON.stringify(historyModule)});
    const { collectHistoryCandidates } = process.mainModule.require(${JSON.stringify(searchModule)});
    const history = new HistoryManager(':memory:');
    await history.initialize();
    for (let i = 0; i < 12; i++) {
      const url = 'https://example.com/article/' + i;
      history.recordVisit(url, 'Article ' + i);
      const id = history.getIdByUrl(url);
      const chunks = Array.from({ length: 8 }, (_, chunkIndex) => ({
        chunkIndex, url, title: 'Article ' + i, text: 'квантовый',
        vector: new Float32Array(0), dims: 0,
      }));
      if (!history.saveContentChunks(id, chunks, TEXT_EXTRACTION_VERSION)) throw new Error('сохранение не удалось');
    }
    return collectHistoryCandidates(history, 'квантовый').map((row) => row.url);
  })()`);
  assert.equal(result.length, 12);
  assert.equal(new Set(result).size, 12);
  console.log('FTS передал переранжированию 12 разных страниц при восьми чанках на страницу');
}, { main: true });
