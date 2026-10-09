// Настоящая панель, два бесплатных API на одном эхо-сервере, только временный профиль.
import assert from 'node:assert/strict';
import http from 'node:http';
import { withStand, wait } from './isolated-stand.mjs';

const bodies = [];
const server = http.createServer((req, res) => {
  let text = '';
  req.on('data', chunk => { text += chunk; });
  req.on('end', () => {
    const body = JSON.parse(text); bodies.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: body.model } }] })}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  await withStand(async ctx => {
    const load = suffix => `Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith(${JSON.stringify(suffix)})).exports`;
    const sync = expression => ctx.evalMainSync(expression);
    await sync(`globalThis.presetStand = { service: ${load('/TranslationService.js')}, registry: ${load('/ai/registry.js')},
      ownership: ${load('/aipanel/chatOwnership.js')}, contexts: ${load('/AiContextStore.js')},
      windows: ${load('/WindowRegistry.js')}, manager: ${load('/AiPanelManager.js')}, instances: ${load('/aipanel/instances.js')} }; true`);
    const connections = ['general', 'support'].map(id => ({ id, model: id, label: id, kind: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, concurrency: 1 }));
    await sync(`presetStand.registry.setConnections(${JSON.stringify(connections)}); presetStand.registry.setRoutingTable({chat:'general'}); true`);
    const preset = await ctx.chrome.evaluate(`window.oblako.saveAiContext({title:'Support',text:'Reply in English.',materials:'Reference only.',connectionId:'support'})`);
    const id = preset.presets[0].id;
    await sync(`presetStand.owner = presetStand.windows.allContexts()[0]; presetStand.manager.toggleAiPanel(presetStand.owner.win); true`);
    await wait(700);
    await sync(`presetStand.panel = presetStand.instances.existingPanel(presetStand.owner.win);
      presetStand.ownership.setPanelSource(presetStand.panel, {kind:'preset',id:${JSON.stringify(id)}});
      presetStand.selected = presetStand.ownership.selectionFor(presetStand.panel.view.webContents); true`);
    const send = text => sync(`process.mainModule.require('electron').ipcMain.emit('ai-panel:chat-send', {sender:presetStand.panel.view.webContents}, ${JSON.stringify(text)}, false, presetStand.selected.id); true`);
    await send('How many items?');
    for (let retry = 0; retry < 40; retry++) {
      if (await ctx.evalMainSync('presetStand.ownership.tabContexts.get(presetStand.selected.key)?.pending === null')) break;
      await wait(100);
    }
    assert.equal(bodies.at(-1).model, 'support');
    assert.ok(bodies.at(-1).messages[0].content.startsWith('Reply in English.'));
    assert.equal(await ctx.evalMainSync('presetStand.registry.routeFor("chat").connectionId'), 'general');
    assert.equal(await ctx.evalMainSync('presetStand.ownership.tabContexts.get(presetStand.selected.key).messages.at(-1).text'), 'support');
    await sync(`presetStand.registry.setConnections(${JSON.stringify([...connections, { ...connections[0], id: 'no-key', baseUrl: 'https://example.invalid/v1' }])}); true`);
    assert.equal(await sync(`(() => { try { presetStand.registry.pinnedProvider('no-key'); return null; } catch (error) { return error.code; } })()`), 'no-key');
    // Удалённая модель набора не уходит ни в общий маршрут, ни во встроенную Qwen.
    await sync(`presetStand.registry.setConnections(${JSON.stringify(connections.slice(0, 1))}); true`);
    const before = bodies.length;
    await send('Again');
    for (let retry = 0; retry < 40; retry++) {
      if (await ctx.evalMainSync('presetStand.ownership.tabContexts.get(presetStand.selected.key).error')) break;
      await wait(100);
    }
    assert.equal(bodies.length, before);
    assert.match(await ctx.evalMainSync('presetStand.ownership.tabContexts.get(presetStand.selected.key).error'), /Модель набора недоступна/);
    // Смена закреплённой модели очищает историю старого адаптера.
    await ctx.chrome.evaluate(`window.oblako.saveAiContext({id:${JSON.stringify(id)},title:'Support',text:'Reply in English.',connectionId:'general'})`);
    assert.deepEqual(await ctx.evalMainSync('presetStand.ownership.tabContexts.get(presetStand.selected.key).history'), []);
    assert.deepEqual(await ctx.evalMainSync('presetStand.ownership.tabContexts.get(presetStand.selected.key).messages'), []);
    await ctx.restart(1000);
    const storePath = new URL('../dist-electron/electron/AiContextStore.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
    assert.equal((await ctx.evalMainSync(`process.mainModule.require(${JSON.stringify(storePath)}).getState()`)).presets[0].connectionId, 'general');
    console.log('Итого: 10 прошло, 0 не прошло');
  }, { main: true });
} finally { server.close(); }
