// Настоящие окна и перезапуск на пустом профиле: закрепления, группы, приватность и выход.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  const load = async () => {
    await wait(900);
    await ctx.evalMain(`globalThis.sessionStand = {
      registry: Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith('/WindowRegistry.js')).exports,
      electron: process.mainModule.require('electron'),
      main: Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith('/main.js')).exports,
    }; undefined`);
  };
  const inWindow = (id, code) => ctx.evalMain(`sessionStand.registry.allContexts().find(c => c.sessionId === ${JSON.stringify(id)}).chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  const states = () => ctx.evalMain(`sessionStand.registry.allContexts().map(c => ({ id: c.sessionId, tabs: c.tabs.snapshot(), nodes: c.tabs.sidebarNodesSnapshot(), bounds: c.win.getNormalBounds() }))`);
  const readSession = async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      try { return JSON.parse(await fs.readFile(path.join(ctx.profile, 'session.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await wait(100); }
    }
    throw Error('Сессия не записана: ' + ctx.appLog.join('').slice(-3000));
  };
  const duplicatesUrl = ctx.echoUrl('/duplicate');
  const pinUrl = ctx.echoUrl('/pin-b');
  const privateUrl = ctx.echoUrl('/private-never-save');
  await load();
  const aId = (await states())[0].id;
  await inWindow(aId, `window.oblako.createTab(${JSON.stringify(duplicatesUrl)})`);
  // IPC подавляет случайный двойной жест с тем же адресом в коротком интервале.
  await wait(450);
  const second = await inWindow(aId, `window.oblako.createTab(${JSON.stringify(duplicatesUrl)})`);
  await inWindow(aId, 'window.oblako.openWindow()');
  await wait(700);
  const bId = (await states()).find(w => w.id !== aId).id;
  const bTabs = [];
  for (const url of [pinUrl, ctx.echoUrl('/group-1'), ctx.echoUrl('/group-2')]) bTabs.push(await inWindow(bId, `window.oblako.createTab(${JSON.stringify(url)})`));
  await inWindow(bId, `window.oblako.togglePinTab(${JSON.stringify(bTabs[0])})`);
  await inWindow(bId, `window.oblako.createGroup(${JSON.stringify(bTabs[1])})`);
  const groupId = (await inWindow(bId, 'window.oblako.getSidebarNodes()')).find(n => n.type === 'group').id;
  await inWindow(bId, `window.oblako.addTabToGroup(${JSON.stringify(groupId)}, ${JSON.stringify(bTabs[2])})`);
  const privatePin = await inWindow(bId, `window.oblako.createIncognitoTab(${JSON.stringify(privateUrl)})`);
  await inWindow(bId, `window.oblako.togglePinTab(${JSON.stringify(privatePin)})`);
  await inWindow(aId, `window.oblako.activateTab(${JSON.stringify(second)})`);
  await ctx.evalMain(`sessionStand.registry.allContexts().find(c => c.sessionId === ${JSON.stringify(aId)}).win.setBounds({ x: 45, y: 55, width: 1030, height: 730 })`);
  await wait(2100);
  const initial = await readSession();
  assert.equal(initial.version, 6);
  assert.equal(initial.windows.length, 2);
  assert.equal(initial.windows.find(w => w.id === aId).snapshot.activeRef.key, second);
  assert.ok(!JSON.stringify(initial).includes(privateUrl));

  // Приватное окно без обычных страниц не должно вернуться после закрытия.
  await inWindow(aId, 'window.oblako.openWindow()');
  await wait(500);
  const privateWindowId = (await states()).find(w => ![aId, bId].includes(w.id)).id;
  await inWindow(privateWindowId, `window.oblako.createIncognitoTab(${JSON.stringify(privateUrl)})`);
  await ctx.evalMain(`sessionStand.registry.allContexts().find(c => c.sessionId === ${JSON.stringify(privateWindowId)}).win.close()`);
  await wait(200);
  assert.ok(!(await readSession()).closedWindows.some(w => w.id === privateWindowId));
  await ctx.evalMain(`sessionStand.registry.allContexts().find(c => c.sessionId === ${JSON.stringify(bId)}).win.close()`);
  await wait(300);
  const afterB = await readSession();
  assert.deepEqual(afterB.windows.map(w => w.id), [aId]);
  assert.equal(afterB.closedWindows.find(w => w.id === bId).snapshot.pinnedTabs.length, 1);
  await ctx.restart(0);
  await load();
  await wait(1000);
  const restored = await states();
  assert.deepEqual(restored.map(w => w.id).sort(), [aId, bId].sort());
  assert.equal(restored.find(w => w.id === bId).tabs.filter(t => !t.isHub).length, 3);
  assert.equal(restored.find(w => w.id === bId).nodes.find(n => n.type === 'group').children.length, 2);
  const aDuplicates = restored.find(w => w.id === aId).tabs.filter(t => t.url === duplicatesUrl);
  assert.equal(aDuplicates.length, 2); assert.equal(aDuplicates[1].isActive, true);
  assert.equal(restored.find(w => w.id === aId).bounds.width, 1030);
  assert.equal(restored.find(w => w.id === aId).bounds.height, 730);
  await wait(1800);
  assert.equal((await readSession()).closedWindows.length, 0);
  for (const filename of ['session.json', 'session.json.bak']) assert.ok(!(await fs.readFile(path.join(ctx.profile, filename), 'utf8')).includes(privateUrl));

  await inWindow(aId, 'window.oblako.openWindow()');
  await wait(600);
  const manualId = (await states()).find(w => ![aId, bId].includes(w.id)).id;
  await inWindow(manualId, `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/manual-restore'))})`);
  await wait(500);
  await ctx.evalMain(`sessionStand.registry.allContexts().find(c => c.sessionId === ${JSON.stringify(manualId)}).win.close()`);
  await wait(300);
  await ctx.evalMain('sessionStand.manualMenu = sessionStand.main.makeIpcDeps().closedWindowMenu(); undefined');
  assert.equal(await ctx.evalMain('sessionStand.manualMenu.length'), 1);
  await ctx.evalMain('sessionStand.manualMenu[0].click()');
  assert.ok((await states()).some(w => w.id === manualId));
  await ctx.evalMain('sessionStand.manualMenu[0].click()');
  assert.equal((await states()).length, 3, 'устаревшее меню восстановило окно второй раз');
  assert.equal((await readSession()).closedWindows.length, 0);
  await ctx.evalMain(`sessionStand.registry.allContexts().find(c => c.sessionId === ${JSON.stringify(manualId)}).win.close()`);
  await wait(300);

  // Явный выход сохраняет одновременно открытые окна, а не последнее из закрывшихся.
  await ctx.evalMain('setTimeout(() => sessionStand.electron.app.quit(), 100); undefined');
  ctx.main.close();
  await wait(600);
  assert.equal((await readSession()).windows.length, 2);
  await ctx.restart(0);
  await load();
  assert.deepEqual((await states()).map(w => w.id).sort(), [aId, bId].sort());

  // Настоящий запуск на v5: файл должен уцелеть побайтово до первой записи v6.
  const legacy = JSON.stringify({ version: 5, savedAt: 'date', pinnedTabs: [{ url: pinUrl }], nodes: [{ type: 'single', url: duplicatesUrl }], activeRef: { type: 'url', url: duplicatesUrl } });
  await fs.writeFile(path.join(ctx.profile, 'session.json'), legacy);
  await ctx.restart(0);
  await load();
  await wait(1800);
  assert.equal((await states()).length, 1);
  assert.equal((await readSession()).version, 6);
  const copies = (await fs.readdir(ctx.profile)).filter(n => n.includes('.pre-v6.'));
  assert.ok(copies.length > 0);
  assert.equal(await fs.readFile(path.join(ctx.profile, copies.at(-1)), 'utf8'), legacy);
  console.log('OK: два окна, закрытый закреп, ручное восстановление без дублей, группы, одинаковые URL, геометрия, приватность основного/backup, явный выход, миграция v5.');
}, { main: true });
