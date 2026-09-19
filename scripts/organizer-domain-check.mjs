import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const tabModule = path.resolve('dist-electron/electron/TabOrganizer.js');
  const bookmarkModule = path.resolve('dist-electron/electron/BookmarkOrganizer.js');
  const result = await ctx.evalMain(`(() => {
    const { siteOf } = process.mainModule.require(${JSON.stringify(tabModule)});
    const { parseAndValidate } = process.mainModule.require(${JSON.stringify(bookmarkModule)});
    const items = [1, 2, 3].map((id) => ({ id, title: 'Item ' + id, url: 'https://example.com/' + id }));
    return {
      privateA: siteOf('https://foo.github.io/a'),
      privateB: siteOf('https://bar.github.io/b'),
      newsA: siteOf('https://daily.afisha.ru/a'),
      newsB: siteOf('https://m.afisha.ru/b'),
      folders: parseAndValidate('Одиночка: 1\\nПара: 1,2', items),
    };
  })()`);
  assert.equal(result.privateA, 'foo.github.io');
  assert.equal(result.privateB, 'bar.github.io');
  assert.equal(result.newsA, 'afisha.ru');
  assert.equal(result.newsB, 'afisha.ru');
  assert.deepEqual(result.folders, [{ label: 'Пара', ids: [1, 2] }]);
  console.log('Домены и группы закладок разбираются без ложного склеивания');
}, { main: true });
