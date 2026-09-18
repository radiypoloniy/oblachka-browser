// Живой прогон стопки в изолированном профиле: native-поповер должен появиться над страницей,
// а крестик обязан убрать связь, сохранив саму вкладку.
import assert from 'node:assert/strict';
import { withStand, connectCdp, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const urls = ['left', 'old-right', 'new-right'].map((name) => `${ctx.echoUrl}?split=${name}`);
  const ids = await ctx.chrome.evaluate(`(async () => {
    const urls = ${JSON.stringify(urls)};
    const ids = [];
    for (const url of urls) ids.push(await window.oblako.createTab(url));
    await window.oblako.activateTab(ids[0]);
    await window.oblako.enterSplit(ids[1]);
    await window.oblako.replaceSplitPanel(ids[1], ids[2]);
    await window.oblako.showSplitStack('right', { x: 800, y: 130, width: 24, height: 24 });
    return ids;
  })()`);

  const target = await ctx.findTarget((t) => t.url?.includes('splitstack.html'));
  assert.ok(target, 'нативный поповер стопки не открылся');
  const popup = connectCdp(target);
  await popup.ready;
  try {
    let titles = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      titles = await popup.evaluate(`Array.from(document.querySelectorAll('.stack-text strong')).map(e => e.textContent)`);
      if (titles.length === 2) break;
      await wait(100);
    }
    assert.equal(titles.length, 2, `ждали текущую и вытесненную вкладку: ${titles}`);
    await popup.evaluate(`document.querySelectorAll('.stack-open')[1].click()`);
    const selected = await ctx.chrome.evaluate(`window.oblako.getSyncState().then(s => s.tabs.find(t => t.id === ${JSON.stringify(ids[1])})?.splitSide)`);
    assert.equal(selected, 'right', 'выбранная из стопки вкладка не заняла половину');
    await ctx.chrome.evaluate(`window.oblako.showSplitStack('right', { x: 800, y: 130, width: 24, height: 24 })`);
    await wait(100);
    await popup.evaluate(`document.querySelectorAll('.stack-remove')[1].click()`);
    await wait(150);
    const remaining = await popup.evaluate(`document.querySelectorAll('.stack-row').length`);
    assert.equal(remaining, 1, 'крестик не убрал вкладку из стопки');
    const stillOpen = await ctx.chrome.evaluate(`window.oblako.getSyncState().then(s => s.tabs.some(t => t.id === ${JSON.stringify(ids[2])}))`);
    assert.equal(stillOpen, true, 'крестик закрыл вкладку вместо удаления из стопки');
    await popup.evaluate(`document.querySelector('.stack-remove').click()`);
    const afterCurrentRemove = await ctx.chrome.evaluate(`window.oblako.getSyncState().then(s => ({ tabs: s.tabs.map(t => t.id), pairs: JSON.stringify(s.nodes).includes('split-pair') }))`);
    assert.equal(afterCurrentRemove.pairs, false, 'удаление последней вкладки из половины не разобрало пару');
    assert.ok(ids.every((id) => afterCurrentRemove.tabs.includes(id)), 'после разбора пары пропала вкладка');
    console.log('ok split stack: поповер, удаление связи и разбор пары без закрытия вкладок');
  } finally {
    popup.close();
  }
});
