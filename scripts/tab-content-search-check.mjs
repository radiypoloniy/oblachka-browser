// Холодная модель: вкладка без слов запроса в заголовке находится по тексту страницы.
import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const historyModule = path.resolve('dist-electron/electron/HistoryManager.js');
  const tabModule = path.resolve('dist-electron/electron/TabSearch.js');
  const result = await ctx.evalMain(`(async () => {
    const { HistoryManager, TEXT_EXTRACTION_VERSION } = process.mainModule.require(${JSON.stringify(historyModule)});
    const { searchTabsByMeaning } = process.mainModule.require(${JSON.stringify(tabModule)});
    const history = new HistoryManager(':memory:');
    await history.initialize();
    const tabs = Array.from({ length: 70 }, (_, i) => ({
      windowId: 1,
      tab: { id: 'tab-' + i, title: 'Страница ' + i, url: 'https://example.com/page/' + i,
        isHub: false, incognito: false },
    }));
    for (let i = 0; i < 200; i++) {
      const closedUrl = 'https://example.com/closed/' + i;
      history.recordVisit(closedUrl, 'Закрытая страница ' + i);
      history.saveContentChunks(history.getIdByUrl(closedUrl), [{ chunkIndex: 0,
        url: closedUrl, title: 'Закрытая страница', text: 'Сверхпроводимость материалов',
        vector: new Float32Array(0), dims: 0 }], TEXT_EXTRACTION_VERSION);
    }
    const target = tabs[69].tab;
    history.recordVisit(target.url, target.title);
    const id = history.getIdByUrl(target.url);
    history.saveContentChunks(id, [{ chunkIndex: 0, url: target.url, title: target.title,
      text: 'В этой статье подробно разобрана сверхпроводимость материалов',
      vector: new Float32Array(0), dims: 0 }], TEXT_EXTRACTION_VERSION);
    const found = await searchTabsByMeaning('сверхпроводимость', tabs, history);
    tabs[69].tab.incognito = true;
    const privateFound = await searchTabsByMeaning('сверхпроводимость', tabs, history);
    return { found: found.map((hit) => hit.tab.id), privateFound: privateFound.map((hit) => hit.tab.id) };
  })()`);
  assert.deepEqual(result.found, ['tab-69']);
  assert.deepEqual(result.privateFound, []);
  console.log('Холодный поиск нашёл 70-ю вкладку по тексту; приватную исключил');
}, { main: true });
