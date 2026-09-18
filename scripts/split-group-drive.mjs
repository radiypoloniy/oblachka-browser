// Группа в половине split: вкладки сохраняются, внутренние пары разбираются, стопка переживает рестарт.
import assert from 'node:assert/strict';
import { withStand, connectCdp, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const urls = ['group-first', 'group-second', 'group-third', 'anchor', 'evicted']
    .map((name) => ctx.echoUrl(`/split-group-${name}`));
  const ids = [];
  for (const url of urls) ids.push(await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`));
  await wait(700);
  await ctx.chrome.evaluate(`window.oblako.createGroup(${JSON.stringify(ids[0])})`);
  const groupId = (await ctx.chrome.evaluate('window.oblako.getSidebarNodes()'))
    .find((node) => node.type === 'group')?.id;
  assert.ok(groupId, 'группа не создалась');
  for (const id of ids.slice(1, 3)) {
    await ctx.chrome.evaluate(`window.oblako.addTabToGroup(${JSON.stringify(groupId)}, ${JSON.stringify(id)})`);
  }
  await ctx.chrome.evaluate(`window.oblako.activateTab(${JSON.stringify(ids[0])})`);
  await ctx.chrome.evaluate(`window.oblako.enterSplit(${JSON.stringify(ids[1])})`);
  await ctx.chrome.evaluate(`window.oblako.activateTab(${JSON.stringify(ids[3])})`);
  await ctx.chrome.evaluate(`window.oblako.enterSplit(${JSON.stringify(ids[4])})`);
  await ctx.chrome.evaluate(`window.oblako.replaceSplitPanelWithGroup(${JSON.stringify(ids[4])}, ${JSON.stringify(groupId)})`);

  const inspect = async () => {
    const tabs = await ctx.chrome.evaluate('window.oblako.getAllTabs()');
    const nodes = await ctx.chrome.evaluate('window.oblako.getSidebarNodes()');
    const group = nodes.find((node) => node.type === 'group' && node.id === groupId);
    return { tabs, nodes, group };
  };
  const before = await inspect();
  assert.equal(before.tabs.filter((tab) => urls.includes(tab.url)).length, 5, 'вкладка исчезла');
  assert.equal(before.tabs.find((tab) => tab.id === ids[0])?.splitSide, 'right');
  assert.deepEqual(before.group?.children.map((node) => node.type), ['single', 'single']);
  assert.equal(before.nodes.filter((node) => node.type === 'split-pair').length, 1, 'внутренний split остался');

  await ctx.chrome.evaluate("window.oblako.showSplitStack('right', { x: 800, y: 130, width: 24, height: 24 })");
  const firstTarget = await ctx.findTarget((tab) => tab.url?.includes('splitstack.html'));
  assert.ok(firstTarget, 'меню стопки не открылось');
  const firstPopup = connectCdp(firstTarget);
  await firstPopup.ready;
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await firstPopup.evaluate("document.querySelectorAll('.stack-row').length") === 4) break;
      await wait(100);
    }
    await firstPopup.evaluate("document.querySelectorAll('.stack-open')[2].click()");
  } finally {
    firstPopup.close();
  }
  await wait(400);
  const switched = await inspect();
  assert.deepEqual(switched.group?.children.map((node) => node.tabId), [ids[0], ids[2]],
    'предыдущая вкладка не вернулась в группу после выбора другой');

  await wait(3500);
  await ctx.restart();
  await wait(800);
  const after = await ctx.chrome.evaluate('window.oblako.getAllTabs()');
  assert.equal(after.filter((tab) => urls.includes(tab.url)).length, 5, 'после рестарта потерялись вкладки');
  const current = after.find((tab) => tab.url === urls[1]);
  assert.equal(current?.splitSide, 'right');
  await ctx.chrome.evaluate(`window.oblako.activateTab(${JSON.stringify(current.id)})`);
  await ctx.chrome.evaluate(`window.oblako.showSplitStack('right', { x: 800, y: 130, width: 24, height: 24 })`);
  const target = await ctx.findTarget((tab) => tab.url?.includes('splitstack.html'));
  assert.ok(target, 'меню стопки не открылось');
  const popup = connectCdp(target);
  await popup.ready;
  try {
    let count = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      count = await popup.evaluate("document.querySelectorAll('.stack-row').length");
      if (count === 4) break;
      await wait(100);
    }
    assert.equal(count, 4, 'в стопке должны быть текущая, выселенная и две оставшиеся вкладки группы');
    await popup.evaluate("document.querySelectorAll('.stack-open')[2].click()");
  } finally {
    popup.close();
  }
  await wait(400);
  const returned = await ctx.chrome.evaluate('window.oblako.getSidebarNodes()');
  const returnedGroup = returned.find((node) => node.type === 'group' && node.id === groupId);
  assert.equal(returnedGroup?.children.length, 3, 'после рестарта предыдущая вкладка снова вышла из группы');
  console.log('ok split group: переключение сохраняет состав группы до и после перезапуска');
});
