// Проверяем реальные IPC двух окон и владельцев вью на изолированном профиле.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  await wait(1000);
  const load = (suffix) => `Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith(${JSON.stringify(suffix)})).exports`;
  await ctx.evalMain(`globalThis.routingStand = {
    registry: ${load('/WindowRegistry.js')},
    routing: ${load('/window/ipcRouting.js')},
    electron: process.mainModule.require('electron'),
  }`);
  await ctx.chrome.evaluate('window.oblako.openWindow()');
  await wait(1000);
  assert.equal(await ctx.evalMain('routingStand.registry.allContexts().length'), 2);
  await ctx.evalMain(`routingStand.a = routingStand.registry.allContexts()[0]; routingStand.b = routingStand.registry.allContexts()[1];`);
  const inWindow = (which, code) => ctx.evalMain(`routingStand.${which}.chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  const urlA = ctx.echoUrl('/routing-a');
  const urlB = ctx.echoUrl('/routing-b');
  const aId = await inWindow('a', `window.oblako.createTab(${JSON.stringify(urlA)})`);
  const bId = await inWindow('b', `window.oblako.createTab(${JSON.stringify(urlB)})`);
  const tabsA = await inWindow('a', 'window.oblako.getAllTabs()');
  const tabsB = await inWindow('b', 'window.oblako.getAllTabs()');
  assert.ok(tabsA.some(t => t.id === aId));
  assert.ok(!tabsA.some(t => t.id === bId));
  assert.ok(tabsB.some(t => t.id === bId));
  assert.ok(!tabsB.some(t => t.id === aId));
  await inWindow('b', `window.oblako.activateTab(${JSON.stringify(aId)})`);
  assert.equal((await inWindow('a', 'window.oblako.getAllTabs()')).find(t => t.isActive)?.id, aId);
  assert.equal((await inWindow('b', 'window.oblako.getAllTabs()')).find(t => t.isActive)?.id, bId);

  const ownership = await ctx.evalMain(`(() => {
    const { registry, routing, a, b, electron } = routingStand;
    const page = b.tabs.getWebContentsForTab(${JSON.stringify(bId)});
    const overlay = new electron.WebContentsView();
    routingStand.overlay = overlay;
    routingStand.overlayContents = overlay.webContents;
    routingStand.closedOwnerView = new electron.WebContentsView();
    registry.registerWindowContents(b.win, routingStand.closedOwnerView.webContents);
    const sender = { sender: overlay.webContents };
    const unknown = routing.tabsOf(sender) === null && routing.winOf(sender) === null && routing.chromeOf(sender) === null;
    registry.registerWindowContents(b.win, overlay.webContents);
    const bound = registry.contextFromSender(overlay.webContents) === b && routing.tabsOf(sender) === b.tabs;
    registry.registerWindowContents(a.win, overlay.webContents);
    const rebound = registry.contextFromSender(overlay.webContents) === a;
    const webApp = new electron.WebContentsView();
    routingStand.webApp = webApp;
    registry.registerPageContents(b.win, webApp.webContents);
    const webAppOwner = registry.contextForPageWebContents(webApp.webContents.id) === b;
    const webAppCannotCommandChrome = routing.tabsOf({ sender: webApp.webContents }) === null;
    registry.registerPageContents(a.win, webApp.webContents);
    const webAppRebound = registry.contextForPageWebContents(webApp.webContents.id) === a;
    return {
      unknown, bound, rebound, webAppOwner, webAppCannotCommandChrome, webAppRebound,
      pageOwner: registry.contextForPageWebContents(page.id) === b,
      pageCannotCommandChrome: routing.tabsOf({ sender: page }) === null,
    };
  })()`);
  assert.deepEqual(ownership, { unknown: true, bound: true, rebound: true, webAppOwner: true, webAppCannotCommandChrome: true, webAppRebound: true, pageOwner: true, pageCannotCommandChrome: true });
  await ctx.evalMain('routingStand.b.win.focus()');
  await wait(150);
  assert.equal(await ctx.evalMain('routingStand.registry.preferredContext() === routingStand.b'), true);
  await ctx.evalMain('routingStand.a.win.focus()');
  await wait(150);
  assert.equal(await ctx.evalMain('routingStand.registry.preferredContext() === routingStand.a'), true);

  // Закрываем второе окно: поведение закрытия первого будет отдельным этапом lifecycle.
  await inWindow('b', 'window.oblako.closeWindow()');
  await wait(300);
  assert.equal(await ctx.evalMain('routingStand.registry.allContexts().length'), 1);
  assert.equal(await ctx.evalMain('routingStand.registry.contextFromSender(routingStand.closedOwnerView.webContents) === null'), true);
  assert.equal(await ctx.evalMain('routingStand.registry.preferredContext() === routingStand.a'), true);
  await ctx.evalMain(`routingStand.electron.ipcMain._invokeHandlers.get('tab:create')({ sender: routingStand.overlay.webContents }, ${JSON.stringify(ctx.echoUrl('/bound'))})`);
  assert.equal((await inWindow('a', 'window.oblako.getAllTabs()')).length, tabsA.length + 1);
  await ctx.evalMain('routingStand.overlayContents.close(); routingStand.routing.sendTo(routingStand.overlayContents, "stand:late-answer")');
  assert.equal(await ctx.evalMain('routingStand.registry.contextFromSender(routingStand.overlayContents) === null'), true);
  console.log('OK: два окна, адресный IPC, чужой tabId, неизвестная/закрытая вью, привязка и перенос overlay, изоляция страницы, фокус.');
}, { main: true });
