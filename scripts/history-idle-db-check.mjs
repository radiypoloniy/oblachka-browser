// Реальная SQLite-проверка в Electron ABI и на временном профиле.
// Выборка тихого добора должна совпадать с прежней политикой на тех же строках.
import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const historyModule = path.resolve('dist-electron/electron/HistoryManager.js');
  const policyModule = path.resolve('dist-electron/shared/historyIndex.js');
  const result = await ctx.evalMain(`(async () => {
    const { HistoryManager } = process.mainModule.require(${JSON.stringify(historyModule)});
    const { pickIdleCatchupPages, isNoisyForEmbedding } = process.mainModule.require(${JSON.stringify(policyModule)});
    const history = new HistoryManager(':memory:');
    await history.initialize();
    for (let i = 0; i < 12; i++) {
      history.recordVisit('https://example.com/article/' + i, 'Article ' + i);
    }
    history.recordVisit('https://accounts.google.com/signin/v2/identifier', 'Welcome to Google');
    const indexedUrl = 'https://example.com/already-indexed';
    history.recordVisit(indexedUrl, 'Indexed article');
    const indexedId = history.getIdByUrl(indexedUrl);
    if (indexedId === null) throw new Error('не удалось создать запись истории');
    history.saveContentChunks(indexedId, [{
      chunkIndex: 0, url: indexedUrl, title: 'Indexed article', text: 'Indexed content',
      vector: new Float32Array(0), dims: 0,
    }], 'text-v2');
    const now = Date.now();
    const previous = pickIdleCatchupPages(
      history.getHistoryWithoutContent().map((row) => ({
        ...row, noisy: isNoisyForEmbedding(row.url, row.title),
      })), now,
    ).map((row) => row.url);
    return {
      previous,
      current: history.getIdleCatchupPages(now).map((row) => row.url),
      expired: history.getIdleCatchupPages(now + 37 * 60 * 60 * 1000).length,
    };
  })()`);

  assert.deepEqual(result.current, result.previous);
  assert.equal(result.current.length, 8);
  assert.equal(result.expired, 0);
  console.log('SQLite: выборка совпала, шум и проиндексированная страница исключены, предел 36 ч соблюдён');
}, { main: true });
