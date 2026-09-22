// Холодная модель: вкладка без слов запроса в заголовке находится по тексту страницы.
import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const historyModule = path.resolve('dist-electron/electron/HistoryManager.js');
  const tabModule = path.resolve('dist-electron/electron/TabSearch.js');
  const memoryModule = path.resolve('dist-electron/electron/TabContentMemory.js');
  const result = await ctx.evalMain(`(async () => {
    const { HistoryManager, TEXT_EXTRACTION_VERSION } = process.mainModule.require(${JSON.stringify(historyModule)});
    const { searchTabsByMeaning, searchTabsByContent } = process.mainModule.require(${JSON.stringify(tabModule)});
    const mem = process.mainModule.require(${JSON.stringify(memoryModule)});
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
    const content = searchTabsByContent('сверхпроводимость', tabs, history);
    tabs[69].tab.incognito = true;
    const privateFound = await searchTabsByMeaning('сверхпроводимость', tabs, history);
    const live = {
      windowId: 1,
      tab: { id: 'tab-live', title: 'Черновик', url: 'https://example.com/live',
        isHub: false, incognito: false },
    };
    mem.rememberOpenTabContent(42, live.tab.url, live.tab.title,
      'В черновике разобрана квантовая запутанность фотонов');
    const fromMemory = searchTabsByContent('запутанность', [live], history);
    mem.forgetOpenTabContent(42);
    const afterForget = searchTabsByContent('запутанность', [live], history);
    return {
      found: found.map((hit) => hit.tab.id),
      content: content.map((hit) => hit.tab.id),
      snippet: content[0] && content[0].snippet.includes('сверхпроводимость'),
      privateFound: privateFound.map((hit) => hit.tab.id),
      fromMemory: fromMemory.map((hit) => hit.tab.id),
      afterForget: afterForget.map((hit) => hit.tab.id),
    };
  })()`);
  assert.deepEqual(result.found, ['tab-69']);
  assert.deepEqual(result.content, ['tab-69']);
  assert.equal(result.snippet, true);
  assert.deepEqual(result.privateFound, []);
  assert.deepEqual(result.fromMemory, ['tab-live']);
  assert.deepEqual(result.afterForget, []);
  console.log('Холодный поиск нашёл 70-ю вкладку по тексту; снимок в памяти и приватную исключил');
}, { main: true });
