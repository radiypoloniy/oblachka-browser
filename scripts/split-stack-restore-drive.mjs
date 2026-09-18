// Проверяет сохранение стопки через настоящий session.json в отдельном пустом профиле.
import assert from 'node:assert/strict';
import { withStand, connectCdp, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const urls = ['left', 'previous', 'current'].map((name) => ctx.echoUrl(`/stack-restore-${name}`));
  await ctx.chrome.evaluate(`(async () => {
    const urls = ${JSON.stringify(urls)};
    const ids = [];
    for (const url of urls) ids.push(await window.oblako.createTab(url));
    await window.oblako.activateTab(ids[0]);
    await window.oblako.enterSplit(ids[1]);
    await window.oblako.replaceSplitPanel(ids[1], ids[2]);
  })()`);
  await wait(3500);
  await ctx.restart();
  await wait(800);

  const state = await ctx.chrome.evaluate('window.oblako.getSyncState()');
  const tabs = state.tabs.filter((t) => urls.includes(t.url));
  assert.equal(tabs.length, 3, 'после перезапуска потерялись вкладки');
  const current = tabs.find((t) => t.url === urls[2]);
  assert.equal(current?.splitSide, 'right', 'текущая вкладка не вернулась в split');
  await ctx.chrome.evaluate(`window.oblako.activateTab(${JSON.stringify(current.id)})`);
  await ctx.chrome.evaluate(`window.oblako.showSplitStack('right', { x: 800, y: 130, width: 24, height: 24 })`);
  const target = await ctx.findTarget((t) => t.url?.includes('splitstack.html'));
  assert.ok(target, 'поповер стопки не открылся');
  const popup = connectCdp(target);
  await popup.ready;
  try {
    let count = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      count = await popup.evaluate("document.querySelectorAll('.stack-row').length");
      if (count === 2) break;
      await wait(100);
    }
    assert.equal(count, 2, 'вытесненная вкладка не вернулась в стопку');
    console.log('ok split stack restore: три вкладки и связь в стопке пережили перезапуск');
  } finally {
    popup.close();
  }
});
