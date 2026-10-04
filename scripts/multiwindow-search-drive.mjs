// Реальный поиск в двух окнах; боевой профиль не используется.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  await wait(900);
  // Синхронные команды main не создают Promise: awaitPromise в Inspector иногда теряет
  // внутренний Promise при сборке мусора Electron во время открытия нового окна.
  const mainSync = async (expression) => {
    const r = await ctx.main.send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r));
    return r.result?.result?.value;
  };
  const load = (suffix) => `Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith(${JSON.stringify(suffix)})).exports`;
  await mainSync(`globalThis.searchStand = {
    registry: ${load('/WindowRegistry.js')}, search: ${load('/SearchPopoverManager.js')},
    electron: process.mainModule.require('electron'),
  }; true`);
  await ctx.chrome.evaluate('window.oblako.openWindow()');
  await wait(800);
  await mainSync('searchStand.a = searchStand.registry.allContexts()[0]; searchStand.b = searchStand.registry.allContexts()[1]; true');
  const inWindow = (which, code) => ctx.evalMain(`searchStand.${which}.chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  const aId = await inWindow('a', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/search-window-a'))})`);
  const bId = await inWindow('b', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/search-window-b'))})`);
  await wait(500);
  const open = async (which) => {
    // Событие хрома проходит через штатный before-input-event и зарегистрированный хоткей.
    await mainSync(`searchStand.${which}.chromeView.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', code: 'KeyE', control: true, shift: false, alt: false }); true`);
    await wait(900);
    assert.equal(await mainSync(`searchStand.${which}.win.contentView.children.some(v => v.webContents?.getURL().endsWith('/searchpopover.html'))`), true);
    await mainSync(`searchStand.view = searchStand.${which}.win.contentView.children.find(v => v.webContents?.getURL().endsWith('/searchpopover.html')); true`);
  };
  const query = (text) => ctx.evalMain(`searchStand.view.webContents.executeJavaScript(${JSON.stringify(`window.searchPopover.query(${JSON.stringify(text)})`)})`);
  const emit = (channel, payload) => mainSync(`searchStand.electron.ipcMain.emit(${JSON.stringify(channel)}, { sender: searchStand.view.webContents }, ${JSON.stringify(payload)}); true`);
  await open('b');
  const hitsB = await query('search-window');
  assert.ok(hitsB.hits.some(h => h.kind === 'tab' && h.tabId === bId));
  assert.ok(!hitsB.hits.some(h => h.kind === 'tab' && h.tabId === aId));
  const geometry = await mainSync('searchStand.view.getBounds()');
  await mainSync('searchStand.search.syncSearchPopoverBounds(searchStand.a.win, { x: 0, y: 0, width: 0, height: 0 }); true');
  assert.deepEqual(await mainSync('searchStand.view.getBounds()'), geometry);
  await inWindow('a', 'window.oblako.createTab("about:blank")');
  assert.equal(await mainSync('searchStand.b.win.contentView.children.includes(searchStand.view)'), true);
  // Веб-страница не может выполнять команды доверенного поискового поповера.
  const countB = await inWindow('b', 'window.oblako.getAllTabs().then(t => t.length)');
  await mainSync(`searchStand.electron.ipcMain.emit('searchpopover:open', { sender: searchStand.b.tabs.getWebContentsForTab(${JSON.stringify(bId)}) }, { kind: 'history', url: ${JSON.stringify(ctx.echoUrl('/forged'))}, title: 'forged' }); true`);
  assert.equal(await inWindow('b', 'window.oblako.getAllTabs().then(t => t.length)'), countB);
  // Отложенная команда старой вью не должна открыться в следующем владельце.
  await mainSync('searchStand.oldContents = searchStand.view.webContents; true');
  await open('a');
  assert.equal(await mainSync('searchStand.oldContents.isDestroyed()'), true);
  const countA = await inWindow('a', 'window.oblako.getAllTabs().then(t => t.length)');
  await mainSync(`searchStand.electron.ipcMain.emit('searchpopover:open', { sender: searchStand.oldContents }, { kind: 'history', url: ${JSON.stringify(ctx.echoUrl('/late'))}, title: 'late' }); true`);
  assert.equal(await inWindow('a', 'window.oblako.getAllTabs().then(t => t.length)'), countA);
  await emit('searchpopover:open', { kind: 'history', url: ctx.echoUrl('/opened-a'), title: 'opened' });
  await wait(300);
  assert.ok((await inWindow('a', 'window.oblako.getAllTabs()')).some(t => t.url === ctx.echoUrl('/opened-a')));
  assert.ok(!(await inWindow('b', 'window.oblako.getAllTabs()')).some(t => t.url === ctx.echoUrl('/opened-a')));
  await open('b');
  await emit('searchpopover:run', { query: 'local query', target: { id: 'stand', name: 'stand', kind: 'bang', template: ctx.echoUrl('/results?q={query}') }, sameTab: true });
  await wait(200);
  assert.equal((await inWindow('b', 'window.oblako.getAllTabs()')).find(t => t.id === bId)?.url, ctx.echoUrl('/results?q=local%20query'));
  await open('b');
  await emit('searchpopover:close');
  assert.equal(await mainSync('searchStand.b.win.contentView.children.includes(searchStand.view)'), false);
  // Даже скрытая вью принадлежит окну и должна уничтожиться вместе с ним.
  await mainSync('searchStand.closedContents = searchStand.view.webContents; true');
  await mainSync('searchStand.b.win.close(); true');
  await wait(300);
  assert.equal(await mainSync('searchStand.closedContents.isDestroyed()'), true);
  await open('a');
  assert.ok((await query('search-window-a')).hits.some(h => h.kind === 'tab' && h.tabId === aId));
  await inWindow('a', 'window.oblako.openWindow()');
  await wait(800);
  await mainSync('searchStand.b = searchStand.registry.allContexts()[1]; true');
  const survivingId = await inWindow('b', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/surviving-window'))})`);
  await wait(300);
  await mainSync('searchStand.a.win.close(); true');
  await wait(300);
  await open('b');
  assert.ok((await query('surviving-window')).hits.some(h => h.kind === 'tab' && h.tabId === survivingId));
  console.log('OK: Ctrl+E в обоих окнах, свои вкладки, адресное открытие и навигация, чужие bounds/переключения, неизвестный sender, поздние команды, закрытие владельца.');
}, { main: true });
