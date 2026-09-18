// Перенос группы на страницу без split создаёт пару и сохраняет остальные вкладки в стопке.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withStand, connectCdp, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const urls = ['anchor', 'first', 'second', 'third'].map((name) => ctx.echoUrl(`/split-enter-${name}`));
  const ids = [];
  for (const url of urls) ids.push(await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`));
  await wait(700);
  await ctx.chrome.evaluate(`window.oblako.createGroup(${JSON.stringify(ids[1])})`);
  const groupId = (await ctx.chrome.evaluate('window.oblako.getSidebarNodes()'))
    .find((node) => node.type === 'group')?.id;
  assert.ok(groupId, 'группа не создалась');
  for (const id of ids.slice(2)) {
    await ctx.chrome.evaluate(`window.oblako.addTabToGroup(${JSON.stringify(groupId)}, ${JSON.stringify(id)})`);
    await wait(250);
  }
  await ctx.chrome.evaluate(`window.oblako.activateTab(${JSON.stringify(ids[1])})`);
  await ctx.chrome.evaluate(`window.oblako.enterSplit(${JSON.stringify(ids[2])})`);
  await ctx.chrome.evaluate(`window.oblako.activateTab(${JSON.stringify(ids[0])})`);
  await ctx.chrome.evaluate(`window.oblako.enterSplitWithGroup(${JSON.stringify(groupId)}, 'left')`);

  const tabs = await ctx.chrome.evaluate('window.oblako.getAllTabs()');
  const nodes = await ctx.chrome.evaluate('window.oblako.getSidebarNodes()');
  assert.equal(tabs.filter((tab) => urls.includes(tab.url)).length, 4,
    `до рестарта изменился состав вкладок: ${JSON.stringify(tabs.map((tab) => tab.url))}`);
  assert.equal(tabs.find((tab) => tab.id === ids[1])?.splitSide, 'left');
  assert.equal(tabs.find((tab) => tab.id === ids[0])?.splitSide, 'right');
  assert.equal(nodes.filter((node) => node.type === 'split-pair').length, 1, 'внутренний split не разобран');
  assert.equal(nodes.find((node) => node.type === 'group')?.children.length, 2, 'остальные вкладки ушли из группы');

  await wait(3500);
  const session = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'session.json'), 'utf8'));
  const savedUrls = [];
  const visit = (items) => { for (const node of items) {
    if (node.type === 'single') savedUrls.push(node.url);
    else if (node.type === 'split-pair') savedUrls.push(node.leftUrl, node.rightUrl);
    else if (node.type === 'group') visit(node.children);
  } };
  visit(session.nodes);
  assert.equal(savedUrls.length, 4, `сессия содержит лишнюю вкладку: ${JSON.stringify(savedUrls)}`);
  await ctx.restart();
  await wait(800);
  const restored = await ctx.chrome.evaluate('window.oblako.getAllTabs()');
  assert.equal(restored.filter((tab) => urls.includes(tab.url)).length, 4,
    `после рестарта изменился состав вкладок: ${JSON.stringify(restored.map((tab) => tab.url))}`);
  const current = restored.find((tab) => tab.url === urls[1]);
  assert.equal(current?.splitSide, 'left');
  await ctx.chrome.evaluate(`window.oblako.activateTab(${JSON.stringify(current.id)})`);
  await ctx.chrome.evaluate("window.oblako.showSplitStack('left', { x: 800, y: 130, width: 24, height: 24 })");
  const target = await ctx.findTarget((tab) => tab.url?.includes('splitstack.html'));
  assert.ok(target, 'меню стопки не открылось');
  const popup = connectCdp(target);
  await popup.ready;
  try {
    let count = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      count = await popup.evaluate("document.querySelectorAll('.stack-row').length");
      if (count === 3) break;
      await wait(100);
    }
    assert.equal(count, 3, 'стопка должна содержать все три вкладки группы');
    await popup.evaluate("document.querySelectorAll('.stack-open')[1].click()");
    await wait(350);
    const updated = await ctx.chrome.evaluate('window.oblako.getSidebarNodes()');
    const updatedGroup = updated.find((node) => node.type === 'group' && node.id === groupId);
    assert.equal(updatedGroup?.children.length, 2, 'переключение после рестарта изменило размер группы');
    console.log('ok split group enter: группа создала split и пережила перезапуск');
  } finally {
    popup.close();
  }
});

await withStand(async (ctx) => {
  const urls = ['first', 'second', 'third'].map((name) => ctx.echoUrl(`/split-from-hub-${name}`));
  const ids = [];
  for (const url of urls) ids.push(await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`));
  await wait(700);
  await ctx.chrome.evaluate(`window.oblako.createGroup(${JSON.stringify(ids[0])})`);
  const groupId = (await ctx.chrome.evaluate('window.oblako.getSidebarNodes()'))
    .find((node) => node.type === 'group')?.id;
  assert.ok(groupId);
  for (const id of ids.slice(1)) {
    await ctx.chrome.evaluate(`window.oblako.addTabToGroup(${JSON.stringify(groupId)}, ${JSON.stringify(id)})`);
    await wait(250);
  }
  const beforeHubDrop = await ctx.chrome.evaluate('window.oblako.getSidebarNodes()');
  assert.equal(new Set(ids).size, 3, 'createTab вернул повторный id');
  await ctx.chrome.evaluate("window.oblako.activateTab('hub')");
  await ctx.chrome.evaluate(`window.oblako.enterSplitWithGroup(${JSON.stringify(groupId)}, 'right')`);
  const tabs = await ctx.chrome.evaluate('window.oblako.getAllTabs()');
  assert.equal(tabs.find((tab) => tab.id === ids[0])?.splitSide, 'right', 'первая вкладка не попала в выбранный слот');
  assert.equal(tabs.find((tab) => tab.id === ids[1])?.splitSide, 'left', 'вторая вкладка не стала якорем');
  assert.equal(tabs.filter((tab) => urls.includes(tab.url)).length, 3,
    `перенос с хаба изменил состав вкладок: ${JSON.stringify({ beforeHubDrop, after: await ctx.chrome.evaluate('window.oblako.getSidebarNodes()'), tabs: tabs.map((tab) => [tab.id, tab.url]) })}`);
  console.log('ok split group enter: перенос с хаба создал пару из двух вкладок группы');
});
