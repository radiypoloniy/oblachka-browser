// Проверяет два профиля с одинаковыми числовыми ID на временных SQLite-базах.
import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const historyModule = path.resolve('dist-electron/electron/HistoryManager.js');
  const indexerModule = path.resolve('dist-electron/electron/HistoryIndexer.js');
  const relatedModule = path.resolve('dist-electron/electron/RelatedHistory.js');
  const result = await ctx.evalMain(`(async () => {
    const { HistoryManager } = process.mainModule.require(${JSON.stringify(historyModule)});
    const { indexVisit, isHistoryIndexInFlight } = process.mainModule.require(${JSON.stringify(indexerModule)});
    const { findRelatedPages } = process.mainModule.require(${JSON.stringify(relatedModule)});
    const a = new HistoryManager(':memory:');
    const b = new HistoryManager(':memory:');
    await a.initialize();
    await b.initialize();
    const shared = 'https://example.com/quantum-potato';
    a.recordVisit(shared, 'Quantum potato');
    b.recordVisit(shared, 'Quantum potato');
    a.recordVisit('https://a.example.com/result', 'Quantum potato');
    b.recordVisit('https://b.example.com/result', 'Quantum potato');
    const wc = {
      isDestroyed: () => false,
      getURL: () => shared,
      getTitle: () => 'Quantum potato',
      executeJavaScript: async () => { throw new Error('test extraction'); },
    };
    const job = indexVisit(a, shared, 'Quantum potato', wc, { trigger: 'sleep' });
    const activeInA = isHistoryIndexInFlight(a, shared);
    const activeInB = isHistoryIndexInFlight(b, shared);
    await job;
    const ra = await findRelatedPages(a, shared, 'Quantum potato');
    const rb = await findRelatedPages(b, shared, 'Quantum potato');
    a.deleteEntry(a.getIdByUrl('https://a.example.com/result'));
    const afterDelete = await findRelatedPages(a, shared, 'Quantum potato');
    return {
      ids: [a.getIdByUrl(shared), b.getIdByUrl(shared)],
      activeInA, activeInB,
      a: ra.results.map((row) => row.url),
      b: rb.results.map((row) => row.url),
      afterDelete: afterDelete.results.map((row) => row.url),
    };
  })()`);
  assert.deepEqual(result.ids, [1, 1]);
  assert.equal(result.activeInA, true);
  assert.equal(result.activeInB, false);
  assert.deepEqual(result.a, ['https://a.example.com/result']);
  assert.deepEqual(result.b, ['https://b.example.com/result']);
  assert.deepEqual(result.afterDelete, []);
  console.log('Профили изолированы: очередь индексации и связанные страницы не пересекаются');
}, { main: true });
