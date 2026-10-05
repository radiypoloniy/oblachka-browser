// Ctrl+Shift+T через реальные chrome/page webContents и сохранение окон на пустом профиле.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  await wait(900);
  const load = suffix => `Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith(${JSON.stringify(suffix)})).exports`;
  await ctx.evalMainSync(`globalThis.reopenStand = {
    registry: ${load('/WindowRegistry.js')}, deps: ${load('/main.js')}.makeIpcDeps(),
    session: ${load('/window/windowSession.js')}, electron: process.mainModule.require('electron'),
  }; reopenStand.a = reopenStand.registry.allContexts()[0]; undefined`);
  const run = code => ctx.evalMainSync(code);
  const inWindow = (which, code) => ctx.evalMain(`reopenStand.${which}.chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  const key = async (which, page = false) => {
    assert.equal(await run(`(() => {
      let prevented = false;
      const wc = ${page ? `reopenStand.${which}.tabs.getActiveWebContents()` : `reopenStand.${which}.chromeView.webContents`};
      wc.emit('before-input-event', { preventDefault() { prevented = true; } }, { type: 'keyDown', control: true, shift: true, alt: false, code: 'KeyT', key: 'T' });
      return prevented;
    })()`), true);
    await wait(500);
  };
  const closedTabUrl = ctx.echoUrl('/older-closed-tab');
  const tab = await inWindow('a', `window.oblako.createTab(${JSON.stringify(closedTabUrl)})`);
  await wait(250);
  await run(`reopenStand.a.tabs.closeTab(${JSON.stringify(tab)}); undefined`);
  await inWindow('a', 'window.oblako.openWindow()');
  await wait(500);
  await run('reopenStand.b = reopenStand.registry.allContexts()[1]; undefined');
  const bId = await run('reopenStand.b.sessionId');
  const bTabs = [];
  for (const name of ['pin', 'group-1', 'group-2']) bTabs.push(await inWindow('b', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/' + name))})`));
  await inWindow('b', `window.oblako.togglePinTab(${JSON.stringify(bTabs[0])})`);
  await inWindow('b', `window.oblako.createGroup(${JSON.stringify(bTabs[1])})`);
  const groupId = (await inWindow('b', 'window.oblako.getSidebarNodes()')).find(n => n.type === 'group').id;
  await inWindow('b', `window.oblako.addTabToGroup(${JSON.stringify(groupId)}, ${JSON.stringify(bTabs[2])})`);
  await wait(500);
  await run('reopenStand.b.win.setBounds({ x: 50, y: 60, width: 1010, height: 710 }); reopenStand.b.win.close(); undefined');
  await wait(300);
  assert.equal(await run('reopenStand.deps.closedWindowMenu().length'), 1);
  assert.equal(await run('reopenStand.deps.canReopenClosed(reopenStand.a.tabs)'), true);
  await key('a');
  await run(`reopenStand.b = reopenStand.registry.allContexts().find(c => c.sessionId === ${JSON.stringify(bId)}); undefined`);
  assert.equal(await run('reopenStand.b.tabs.snapshot().filter(t => !t.isHub).length'), 3);
  assert.equal(await run('reopenStand.b.tabs.sidebarNodesSnapshot().find(n => n.type === "group").children.length'), 2);
  assert.equal(await run('reopenStand.b.win.getNormalBounds().width'), 1010);
  assert.equal(await run('reopenStand.a.tabs.hasClosedTabs()'), true);
  assert.equal(await run('reopenStand.deps.closedWindowMenu().length'), 0);
  await key('a');
  assert.equal(await run(`reopenStand.a.tabs.snapshot().some(t => t.url === ${JSON.stringify(closedTabUrl)})`), true);
  await key('a', true);
  assert.equal(await run('reopenStand.registry.allContexts().length'), 2);
  assert.equal(await run('reopenStand.deps.canReopenClosed(reopenStand.a.tabs)'), false);

  // Более новая вкладка выигрывает у закрытого окна и при фокусе на странице.
  await run('reopenStand.b.win.close(); undefined');
  await wait(300);
  const newerUrl = ctx.echoUrl('/newer-closed-tab');
  const newer = await inWindow('a', `window.oblako.createTab(${JSON.stringify(newerUrl)})`);
  await wait(250);
  await run(`reopenStand.a.tabs.closeTab(${JSON.stringify(newer)}); undefined`);
  await key('a', true);
  assert.equal(await run('reopenStand.registry.allContexts().length'), 1);
  assert.equal(await run(`reopenStand.a.tabs.snapshot().some(t => t.url === ${JSON.stringify(newerUrl)})`), true);
  await key('a', true);
  assert.equal(await run('reopenStand.registry.allContexts().length'), 2);

  // Перенос последней вкладки не добавляет пустое исходное окно в историю.
  await inWindow('a', 'window.oblako.openWindow()');
  await wait(500);
  await run('reopenStand.source = reopenStand.registry.allContexts().at(-1); undefined');
  const moved = await inWindow('source', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/moved-last'))})`);
  await wait(250);
  await run(`reopenStand.deps.moveTabToNewWindow(reopenStand.source.tabs, ${JSON.stringify(moved)}); undefined`);
  await wait(500);
  assert.equal(await run('reopenStand.source.win.isDestroyed()'), true);
  assert.equal(await run('reopenStand.deps.closedWindowMenu().length'), 0);

  // Отмена технического close не должна подавлять будущее ручное закрытие окна.
  await inWindow('a', 'window.oblako.openWindow()');
  await wait(500);
  await run('reopenStand.cancelled = reopenStand.registry.allContexts().at(-1); reopenStand.cancelled.win.once("close", e => e.preventDefault()); reopenStand.session.closeWindowWithoutHistory(reopenStand.cancelled.win); undefined');
  await wait(100);
  assert.equal(await run('reopenStand.cancelled.win.isDestroyed()'), false);
  await inWindow('cancelled', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/manual-after-cancel'))})`);
  await wait(250);
  await run('reopenStand.cancelled.win.close(); undefined');
  await wait(300);
  assert.equal(await run('reopenStand.deps.closedWindowMenu().length'), 1);
  await key('a');
  assert.equal(await run('reopenStand.deps.closedWindowMenu().length'), 0);
  const saved = JSON.parse(await fs.readFile(path.join(ctx.profile, 'session-v6.json'), 'utf8'));
  assert.equal(saved.closedWindows.length, 0);
  assert.equal(saved.windows.length, await run('reopenStand.registry.allContexts().length'));
  console.log('OK: Ctrl+Shift+T из chrome/страницы, порядок окно/вкладка, группы/закреп/геометрия, без дублей, перенос без пустой истории, отмена close, автосейв.');
}, { main: true });
