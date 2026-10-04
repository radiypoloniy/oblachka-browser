// Контролируемые ответы через настоящую QwenQueue в реальном Electron; временный профиль.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  await wait(900);
  const sync = async expression => {
    const r = await ctx.main.send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r));
    return r.result?.result?.value;
  };
  const load = suffix => `Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith(${JSON.stringify(suffix)})).exports`;
  await sync(`globalThis.panelStand = {
    registry: ${load('/WindowRegistry.js')}, panel: ${load('/AiPanelManager.js')},
    instances: ${load('/aipanel/instances.js')}, chat: ${load('/aipanel/tabChat.js')},
    ownership: ${load('/aipanel/chatOwnership.js')}, service: ${load('/TranslationService.js')},
    queue: ${load('/QwenQueue.js')}, deps: ${load('/main.js')}.makeIpcDeps(),
    electron: process.mainModule.require('electron'), gates: [], events: [], running: 0, maxRunning: 0,
  }; true`);
  await ctx.chrome.evaluate('window.oblako.openWindow()'); await wait(650);
  await sync('panelStand.a = panelStand.registry.allContexts()[0]; panelStand.b = panelStand.registry.allContexts()[1]; true');
  const inWindow = (which, code) => ctx.evalMain(`panelStand.${which}.chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  await inWindow('a', 'window.oblako.createTab("about:blank")');
  const aId = await inWindow('a', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/ai-a'))})`);
  const bId = await inWindow('b', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/ai-b'))})`);
  await wait(250);
  await sync(`panelStand.panel.toggleAiPanel(panelStand.a.win); panelStand.panel.toggleAiPanel(panelStand.b.win); true`);
  await wait(800);
  await sync(`for (const name of ['a', 'b']) {
    const panel = panelStand.instances.existingPanel(panelStand[name].win);
    panelStand[name].sender = panel.view.webContents;
    const send = panel.view.webContents.send.bind(panel.view.webContents);
    panel.view.webContents.send = (channel, data) => { panelStand.events.push({ name, channel, data }); send(channel, data); };
  }
  panelStand.chat.wireTabChat({ extractPageText: async wc => ({ ok: true, text: wc?.getURL() ?? '', markdown: null }), buildFirstTurnPrompt: (_p, _t, text) => text });
  panelStand.service.runChatMessage = (text, history, chunk, signal) => panelStand.queue.withQwenQueue(() => new Promise(resolve => {
    panelStand.running++; panelStand.maxRunning = Math.max(panelStand.maxRunning, panelStand.running);
    panelStand.gates.push({ text, history, chunk, signal, finish(outcome) { panelStand.running--; resolve(outcome); } });
  }), signal); true`);
  const send = async (which, text, id) => {
    await sync(`panelStand.electron.ipcMain.emit('ai-panel:chat-send', { sender: panelStand.${which}.sender }, ${JSON.stringify(text)}, false, ${JSON.stringify(id)}); true`);
    await wait(120);
  };
  const finish = async (index, out, ok = true) => {
    await sync(`panelStand.gates[${index}].finish(${JSON.stringify(ok ? { ok: true, out, history: [{ type: 'user', text: out }] } : { ok: false, error: out })}); true`);
    await wait(120);
  };
  await send('a', 'A-first', aId); await send('b', 'B-first', bId);
  assert.equal(await sync('panelStand.gates.length'), 1);
  await sync(`panelStand.gates[0].chunk('A-only'); true`);
  assert.equal(await sync(`panelStand.events.some(e => e.name === 'b' && e.channel === 'ai-panel:chat-chunk' && e.data === 'A-only')`), false);
  await finish(0, 'A-answer'); assert.equal(await sync('panelStand.gates.length'), 2);
  await finish(1, 'B-answer');
  assert.equal(await sync('panelStand.maxRunning'), 1);
  const messages = id => sync(`panelStand.ownership.tabContexts.get(${JSON.stringify(id)}).messages.map(m => m.text)`);
  assert.deepEqual(await messages(aId), ['A-first', 'A-answer']);
  assert.deepEqual(await messages(bId), ['B-first', 'B-answer']);
  // Подделка чужого tabId и sender не создаёт запрос.
  await send('a', 'forged', bId);
  await sync(`panelStand.electron.ipcMain.emit('ai-panel:chat-send', { sender: panelStand.a.tabs.getWebContentsForTab(${JSON.stringify(aId)}) }, 'forged page', false, ${JSON.stringify(aId)}); true`);
  assert.equal(await sync('panelStand.gates.length'), 2);
  // Беседа и продолжение стрима следуют за переносом, а не прежним sender.
  await send('a', 'moving', aId);
  assert.equal(await sync(`panelStand.deps.moveTabToExistingWindow(panelStand.a.tabs, ${JSON.stringify(aId)}, panelStand.b.win.id)`), true);
  await sync(`panelStand.events = []; panelStand.gates[2].chunk('moved-chunk'); true`);
  assert.equal(await sync(`panelStand.events.filter(e => e.channel === 'ai-panel:chat-chunk').map(e => e.name).join(',')`), 'b');
  await finish(2, 'moved-answer'); assert.ok((await messages(aId)).includes('moved-answer'));
  // Навигация отменяет только её контекст; поздний ответ не возвращается в новую страницу.
  await send('b', 'old-document', aId);
  await ctx.evalMain(`panelStand.b.tabs.getWebContentsForTab(${JSON.stringify(aId)}).loadURL(${JSON.stringify(ctx.echoUrl('/ai-new-document'))})`);
  assert.equal(await sync('panelStand.gates[3].signal.aborted'), true);
  await finish(3, 'stale-document'); assert.deepEqual(await messages(aId), []);
  await send('b', 'to-clear', aId);
  await sync(`panelStand.electron.ipcMain.emit('ai-panel:clear-chat', { sender: panelStand.b.sender }); true`);
  assert.equal(await sync('panelStand.gates[4].signal.aborted'), true);
  await finish(4, 'late-after-clear'); assert.deepEqual(await messages(aId), []);
  // Ошибка A не блокирует следующий запрос B.
  await inWindow('a', 'window.oblako.activateTab("hub")');
  await send('a', 'hub-a', 'hub'); await send('b', 'after-error', aId);
  await finish(5, 'injected error', false); await finish(6, 'after-error-answer');
  assert.ok((await messages(aId)).includes('after-error-answer'));
  await inWindow('b', 'window.oblako.activateTab("hub")');
  const keyA = await sync('panelStand.ownership.selectionFor(panelStand.a.sender).key');
  const keyB = await sync('panelStand.ownership.selectionFor(panelStand.b.sender).key');
  assert.notEqual(keyA, keyB);
  await send('b', 'hub-b', 'hub'); await finish(7, 'hub-b-answer');
  assert.deepEqual(await messages(keyB), ['hub-b', 'hub-b-answer']);
  // Отмена ожидающего A не снимает работающий B и не занимает слот генерации.
  await send('b', 'blocking-b', 'hub'); await send('a', 'queued-a', 'hub');
  await sync(`panelStand.electron.ipcMain.emit('ai-panel:clear-chat', { sender: panelStand.a.sender }); true`);
  await finish(8, 'blocking-answer');
  assert.equal(await sync('panelStand.gates.length'), 9);
  assert.deepEqual(await messages(keyA), []);
  await send('a', 'closing-a', 'hub');
  // Закрытие первого окна освобождает его контекст и сохраняет беседы живого второго.
  await sync('panelStand.a.win.close(); true'); await wait(200);
  assert.equal(await sync('panelStand.gates[9].signal.aborted'), true);
  await finish(9, 'late-closed-window');
  assert.equal(await sync(`panelStand.ownership.tabContexts.has(${JSON.stringify(keyA)})`), false);
  assert.ok((await messages(aId)).includes('after-error-answer'));
  await send('b', 'surviving', 'hub'); await finish(10, 'surviving-answer');
  assert.ok((await messages(keyB)).includes('surviving-answer'));
  console.log('OK: две полные AI-панели, одна QwenQueue, отдельные беседы/hub, чужой sender/id, перенос стрима, навигация/сброс, ошибка очереди, закрытие первого окна.');
}, { main: true });
