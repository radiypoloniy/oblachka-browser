// Полная запись вкладки и отказ приёмника проверяются в Electron на временном профиле.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  await wait(900);
  const sync = async expression => {
    const r = await ctx.main.send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r));
    return r.result?.result?.value;
  };
  const load = suffix => `Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith(${JSON.stringify(suffix)})).exports`;
  await sync(`globalThis.transferStand = {
    registry: ${load('/WindowRegistry.js')}, deps: ${load('/main.js')}.makeIpcDeps(),
    profiles: ${load('/ProfileStore.js')}, move: ${load('/window/tabMove.js')},
    electron: process.mainModule.require('electron'),
  }; true`);
  await ctx.chrome.evaluate('window.oblako.openWindow()'); await wait(700);
  await sync('transferStand.a = transferStand.registry.allContexts()[0]; transferStand.b = transferStand.registry.allContexts()[1]; true');
  const inWindow = (which, code) => ctx.evalMain(`transferStand.${which}.chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  const keepB = await inWindow('b', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/keep-b'))})`);
  // Пустой источник теперь закрывается в любом окне; для проверки круговых переносов оставляем вкладку.
  await inWindow('a', 'window.oblako.createTab("about:blank")');
  const profile = await sync(`transferStand.profiles.createProfile('Transfer work', 'purple').profiles.at(-1).id`);
  const liveUrl = ctx.echoUrl('/transfer-live');
  const liveId = await sync(`transferStand.a.tabs.createTab(${JSON.stringify(ctx.echoUrl('/transfer-start'))}, false, false, false, undefined, ${JSON.stringify(profile)})`);
  await wait(300);
  await ctx.evalMain(`transferStand.a.tabs.getWebContentsForTab(${JSON.stringify(liveId)}).loadURL(${JSON.stringify(liveUrl)})`);
  await sync(`transferStand.wc = transferStand.a.tabs.getWebContentsForTab(${JSON.stringify(liveId)}); transferStand.a.tabs.togglePin(${JSON.stringify(liveId)}); transferStand.a.tabs.setTabMuted(${JSON.stringify(liveId)}, true); transferStand.a.tabs.setAiTitle(${JSON.stringify(liveId)}, 'Transfer title'); true`);
  await ctx.evalMain('transferStand.wc.executeJavaScript("document.body.innerHTML = \'<input id=form value=original>\'; document.querySelector(\'#form\').value = \'unsaved text\'; true")');
  const wcId = await sync('transferStand.wc.id');
  const move = (from, to, id) => sync(`transferStand.deps.moveTabToExistingWindow(transferStand.${from}.tabs, ${JSON.stringify(id)}, transferStand.${to}.win.id)`);
  await sync(`transferStand.b.tabs.applyOrganize([{ label: 'Before move', nodeIds: [${JSON.stringify(keepB)}], nodeTypes: ['single'] }]); true`);
  assert.equal(await sync('transferStand.b.tabs.hasOrganizeSnapshot()'), true);
  assert.equal(await move('a', 'b', liveId), true);
  assert.equal(await sync('transferStand.b.tabs.hasOrganizeSnapshot()'), false);
  await sync('transferStand.b.tabs.rollbackOrganize(); true');
  assert.equal(await sync(`transferStand.b.tabs.getWebContentsForTab(${JSON.stringify(liveId)}).id`), wcId);
  assert.equal(await sync(`transferStand.b.tabs.isTabPinned(${JSON.stringify(liveId)})`), true);
  assert.equal(await sync(`transferStand.b.tabs.profileOfWebContents(${wcId})`), profile);
  assert.equal(await sync('transferStand.wc.isAudioMuted()'), true);
  assert.equal(await ctx.evalMain('transferStand.wc.executeJavaScript("document.querySelector(\'#form\').value")'), 'unsaved text');
  assert.equal(await sync('transferStand.wc.navigationHistory.canGoBack()'), true);
  assert.equal(await sync(`transferStand.b.tabs.tabMap.get(${JSON.stringify(liveId)}).aiTitle`), 'Transfer title');
  await move('b', 'a', liveId);
  const listeners = await sync(`transferStand.wc.listenerCount('did-navigate')`);
  for (let i = 0; i < 3; i++) { await move('a', 'b', liveId); await move('b', 'a', liveId); }
  assert.equal(await sync(`transferStand.wc.listenerCount('did-navigate')`), listeners);
  const oldZoom = await sync('transferStand.wc.getZoomFactor()');
  await sync('transferStand.wc.emit("zoom-changed", { preventDefault() {} }, "in"); true');
  assert.ok(Math.abs((await sync('transferStand.wc.getZoomFactor()')) - oldZoom - 0.1) < 0.001);
  // Подменяем только показ native menu: проверяем, что прежний владелец не строит
  // второе меню и что уже построенный click не действует после переезда страницы.
  await sync(`transferStand.savedBuildMenu = transferStand.electron.Menu.buildFromTemplate;
    transferStand.menuCount = 0;
    transferStand.electron.Menu.buildFromTemplate = items => {
      transferStand.menuItems = items; return { popup() { transferStand.menuCount++; } };
    };
    transferStand.wc.emit('context-menu', {}, { linkURL: ${JSON.stringify(ctx.echoUrl('/menu-link'))},
      selectionText: '', mediaType: 'none', isEditable: false, x: 0, y: 0 }); true`);
  assert.equal(await sync('transferStand.menuCount'), 1);
  await sync('transferStand.oldMenuClick = transferStand.menuItems.find(i => i.click).click; true');
  await move('a', 'b', liveId);
  const beforeMenu = await sync('transferStand.a.tabs.tabMap.size + transferStand.b.tabs.tabMap.size');
  await sync('transferStand.oldMenuClick(); true');
  assert.equal(await sync('transferStand.a.tabs.tabMap.size + transferStand.b.tabs.tabMap.size'), beforeMenu);
  await sync(`transferStand.menuCount = 0;
    transferStand.wc.emit('context-menu', {}, { linkURL: ${JSON.stringify(ctx.echoUrl('/menu-link'))},
      selectionText: '', mediaType: 'none', isEditable: false, x: 0, y: 0 });
    transferStand.electron.Menu.buildFromTemplate = transferStand.savedBuildMenu; true`);
  assert.equal(await sync('transferStand.menuCount'), 1);
  await move('b', 'a', liveId);

  // Полный откат единственного ребёнка группы, включая порядок, active и живую вью.
  const rollbackId = await inWindow('a', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/rollback'))})`);
  await inWindow('a', `window.oblako.createGroup(${JSON.stringify(rollbackId)})`);
  await wait(250);
  const treeBefore = await inWindow('a', 'window.oblako.getSidebarNodes()');
  const bBefore = await inWindow('b', 'window.oblako.getSidebarNodes()');
  await sync('transferStand.b.tabs.organizeSnapshot = structuredClone(transferStand.b.tabs.nodes); true');
  await sync('transferStand.savedActivate = transferStand.b.tabs.activate; transferStand.b.tabs.activate = function(id) { if (id === ' + JSON.stringify(rollbackId) + ') throw Error("stand: reject activate"); return transferStand.savedActivate.call(this, id); }; true');
  assert.equal(await move('a', 'b', rollbackId), false);
  await sync('transferStand.b.tabs.activate = transferStand.savedActivate; true');
  assert.deepEqual(await inWindow('a', 'window.oblako.getSidebarNodes()'), treeBefore);
  assert.deepEqual(await inWindow('b', 'window.oblako.getSidebarNodes()'), bBefore);
  assert.equal(await sync('transferStand.b.tabs.hasOrganizeSnapshot()'), true);
  assert.equal(await sync('transferStand.a.tabs.getActiveId()'), rollbackId);
  assert.equal(await sync(`transferStand.a.tabs.getWebContentsForTab(${JSON.stringify(rollbackId)}).isDestroyed()`), false);
  assert.equal(await sync(`transferStand.move.moveTab(transferStand.a.tabs, ${JSON.stringify(rollbackId)}, () => { throw Error('stand: create failed'); }, () => {}, true)`), false);
  assert.deepEqual(await inWindow('a', 'window.oblako.getSidebarNodes()'), treeBefore);

  // Спящая вкладка просыпается с cookies своего профиля, а не defaultSession.
  await ctx.evalMain(`transferStand.electron.session.fromPartition('persist:oblako-profile-' + ${JSON.stringify(profile)}).cookies.set({ url: ${JSON.stringify(ctx.echoUrl('/'))}, name: 'transfer-profile', value: 'work' })`);
  await ctx.evalMain(`transferStand.electron.session.defaultSession.cookies.set({ url: ${JSON.stringify(ctx.echoUrl('/'))}, name: 'transfer-profile', value: 'default' })`);
  const sleepyUrl = ctx.echoUrl('/sleepy-pin');
  const sleepyId = await sync(`transferStand.a.tabs.createSleepingPinnedTab(${JSON.stringify(sleepyUrl)}, 'Sleepy', undefined, ${JSON.stringify(profile)})`);
  await sync(`transferStand.a.tabs.setTabMuted(${JSON.stringify(sleepyId)}, true); true`);
  assert.equal(await move('a', 'b', sleepyId), true); await wait(350);
  assert.equal(await sync(`transferStand.b.tabs.isTabPinned(${JSON.stringify(sleepyId)})`), true);
  assert.equal(await ctx.evalMain(`transferStand.b.tabs.getWebContentsForTab(${JSON.stringify(sleepyId)}).executeJavaScript('document.cookie')`), 'transfer-profile=work');
  assert.equal(await sync(`transferStand.b.tabs.getWebContentsForTab(${JSON.stringify(sleepyId)}).isAudioMuted()`), true);
  assert.equal(await move('b', 'a', keepB), true);
  assert.equal(await sync('transferStand.b.win.isDestroyed()'), false);

  const privateUrl = ctx.echoUrl('/private-transfer');
  const privateId = await inWindow('a', `window.oblako.createIncognitoTab(${JSON.stringify(privateUrl)})`);
  await inWindow('a', `window.oblako.togglePinTab(${JSON.stringify(privateId)})`);
  assert.equal(await move('a', 'b', privateId), true);
  assert.equal(await sync(`transferStand.b.tabs.isIncognito(${JSON.stringify(privateId)}) && transferStand.b.tabs.isTabPinned(${JSON.stringify(privateId)})`), true);
  const newId = await inWindow('a', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/new-window-pin'))})`);
  await inWindow('a', `window.oblako.togglePinTab(${JSON.stringify(newId)})`);
  assert.equal(await sync(`transferStand.deps.moveTabToNewWindow(transferStand.a.tabs, ${JSON.stringify(newId)})`), true);
  await wait(600);
  assert.equal(await sync(`transferStand.registry.allContexts().filter(c => c.tabs.isTabPinned(${JSON.stringify(newId)})).length`), 1);
  await sync(`transferStand.c = transferStand.registry.allContexts().find(c => c.tabs.isTabPinned(${JSON.stringify(newId)})); true`);
  assert.equal(await move('c', 'a', newId), true); await wait(250);
  assert.equal(await sync('transferStand.c.win.isDestroyed()'), true);
  await wait(2100);
  const saved = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'session-v6.json'), 'utf8'));
  assert.ok(!JSON.stringify(saved).includes(privateUrl));
  const backup = path.join(ctx.profile, 'session-v6.json.bak');
  if (fs.existsSync(backup)) assert.ok(!fs.readFileSync(backup, 'utf8').includes(privateUrl));
  const sleepySaved = saved.windows.flatMap(w => w.snapshot.pinnedTabs).find(t => t.url === sleepyUrl);
  assert.equal(sleepySaved.profileId, profile);
  await ctx.restart(0); await wait(500);
  const restored = await ctx.chrome.evaluate('window.oblako.getAllTabs()');
  await sync(`transferStand = { registry: ${load('/WindowRegistry.js')} }; true`);
  const savedPins = await sync('transferStand.registry.allContexts().flatMap(c => c.tabs.getSessionSnapshot().pinnedTabs).map(t => t.url)');
  assert.ok(savedPins.includes(sleepyUrl)); assert.ok(savedPins.includes(liveUrl));
  assert.ok(restored.length > 0);
  console.log('OK: живая вью/форма/история, id/закреп/profile/mute/title, повторные переезды, отказ activate/create, спящая профильная вкладка и cookies, приватность, новое окно, сохранение и перезапуск.');
}, { main: true });
