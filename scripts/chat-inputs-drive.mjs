// Скрепка → настоящий preload/IPC → модель → второй ход. Байты и документы только свои.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withStand, wait } from './isolated-stand.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const bodies = [];
const server = http.createServer((req, res) => {
  if (req.url === '/image.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from(png, 'base64')); return;
  }
  if (req.url === '/slow-image.png') {
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from(png, 'base64')); }, 600); return;
  }
  if (req.url === '/blob-page') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<img id="sample"><script>fetch('/image.png').then(r=>r.blob()).then(blob=>{document.querySelector('img').src=URL.createObjectURL(blob)})</script>`); return;
  }
  if (req.method === 'GET') { res.writeHead(404); res.end(); return; }
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw); bodies.push(body);
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Files received.' } }] })}\n\ndata: [DONE]\n\n`);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Files received.' } }],
        content: [{ type: 'text', text: 'Files received.' }], candidates: [{ content: { parts: [{ text: 'Files received.' }] } }] }));
    }
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  await withStand(async ctx => {
    const load = suffix => `Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith(${JSON.stringify(suffix)})).exports`;
    const compiled = file => new URL(`../dist-electron/electron/${file}.js`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
    const sync = expression => ctx.evalMainSync(expression);
    const result = async expression => {
      await sync(`inputsStand.promise = ${expression}; true`);
      return ctx.evalMain('inputsStand.promise');
    };
    const imagePath = path.join(ctx.profile, 'sample.png'), textPath = path.join(ctx.profile, 'terms.txt');
    await fs.writeFile(imagePath, Buffer.from(png, 'base64'));
    await fs.writeFile(textPath, 'Sample document: seven items, total USD 123.45.');
    await sync(`globalThis.inputsStand = { files: process.mainModule.require(${JSON.stringify(compiled('ai/InputFileStore'))}),
      registry: ${load('/ai/registry.js')}, windows: ${load('/WindowRegistry.js')}, manager: ${load('/AiPanelManager.js')},
      ownership: ${load('/aipanel/chatOwnership.js')}, instances: ${load('/aipanel/instances.js')},
      electron: process.mainModule.require('electron') }; true`);
    const connection = { id: 'input-echo', model: 'input-echo', label: 'Input echo', kind: 'openai-compatible',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, concurrency: 1 };
    await sync(`inputsStand.owner = inputsStand.windows.allContexts()[0]; true`);
    await result(`inputsStand.electron.ipcMain._invokeHandlers.get('ai:connection-save')({sender:inputsStand.owner.chromeView.webContents},${JSON.stringify(connection)},null)`);
    await result(`inputsStand.electron.ipcMain._invokeHandlers.get('ai:set-route')({sender:inputsStand.owner.chromeView.webContents},'chat','input-echo')`);
    await sync(`inputsStand.manager.toggleAiPanel(inputsStand.owner.win); true`);
    await wait(1000);
    await sync(`inputsStand.panel = inputsStand.instances.existingPanel(inputsStand.owner.win);
      inputsStand.ownership.setPanelSource(inputsStand.panel, {kind:'none'});
      inputsStand.selected = inputsStand.ownership.selectionFor(inputsStand.panel.view.webContents);
      inputsStand.electron.dialog.showOpenDialog = async () => ({canceled:false,filePaths:${JSON.stringify([imagePath, textPath])}}); true`);
    await wait(300);
    const panel = code => result(`inputsStand.panel.view.webContents.executeJavaScript(${JSON.stringify(code)})`);
    const until = async predicate => {
      for (let i = 0; i < 50; i++) { if (await predicate()) return; await wait(100); }
      throw new Error('Не дождались состояния панели');
    };
    await panel(`document.querySelector('button[title^="Прикрепить"]').click(); true`);
    await until(() => panel(`document.body.textContent.includes('terms.txt')`));
    assert.equal(await panel(`document.querySelectorAll('img[alt="sample.png"]').length`), 1);
    // Закрытие/открытие той же панели не равно очистке беседы: черновик должен остаться.
    await sync('inputsStand.manager.toggleAiPanel(inputsStand.owner.win); true'); await wait(100);
    await sync('inputsStand.manager.toggleAiPanel(inputsStand.owner.win); true'); await wait(150);
    assert.equal(await panel(`document.body.textContent.includes('terms.txt')`), true);
    if (process.argv.includes('--screenshot')) {
      const output = process.argv[process.argv.indexOf('--screenshot') + 1];
      const encoded = await result('inputsStand.panel.view.webContents.capturePage().then(image=>image.toPNG().toString("base64"))');
      await fs.writeFile(output, Buffer.from(encoded, 'base64'));
    }
    await panel(`document.querySelector('button[title="Отправить"]').click(); true`);
    await until(() => sync('inputsStand.ownership.tabContexts.get(inputsStand.selected.key).messages.length === 2'));
    const history = await sync('inputsStand.ownership.tabContexts.get(inputsStand.selected.key).history');
    assert.equal(history[0].inputIds.length, 2);
    assert.ok(!JSON.stringify(history).includes('data:image'));
    assert.ok(!JSON.stringify(history).includes('Current order:'));
    assert.ok(bodies[0].messages.at(-1).content.some(part => part.type === 'image_url'));
    assert.ok(JSON.stringify(bodies[0]).includes('seven items'));
    await sync(`inputsStand.electron.ipcMain.emit('ai-panel:chat-send',{sender:inputsStand.panel.view.webContents},'What was the total?',false,inputsStand.selected.id); true`);
    await until(() => sync('inputsStand.ownership.tabContexts.get(inputsStand.selected.key).messages.length === 4'));
    assert.ok(bodies[1].messages[1].content.some(part => part.type === 'image_url'));
    // Ссылки переходят в оба других облачных формата без потери первого изображения.
    for (const [kind, module, factory] of [['anthropic', 'anthropic', 'createAnthropicProvider'], ['gemini', 'gemini', 'createGeminiProvider']]) {
      await sync(`inputsStand.adapter = process.mainModule.require(${JSON.stringify(compiled(`ai/providers/${module}`))}).${factory}({connection:${JSON.stringify({ ...connection, kind })},getKey:()=> 'fake-key'}); true`);
      const response = await result(`inputsStand.adapter.chat('Follow up', ${JSON.stringify(history)}, 'Support role', {inputs:inputsStand.files.requestInputs(inputsStand.selected.key,[])})`);
      assert.equal(response.history[0].inputIds.length, 2);
      assert.ok(!JSON.stringify(response.history).includes('base64'));
      const sent = JSON.stringify(bodies.at(-1));
      assert.ok(sent.includes(kind === 'anthropic' ? '"type":"image"' : 'inlineData'));
    }
    const id = history[0].inputIds[0];
    assert.equal(await sync(`inputsStand.files.preview('foreign-owner',${JSON.stringify(id)})`), null);
    await panel(`window.aiPanel.removeInput('free:none',${JSON.stringify(id)})`);
    assert.ok(await sync(`inputsStand.files.preview(inputsStand.selected.key,${JSON.stringify(id)})`));
    await panel('window.aiPanel.clearChat(); true'); await wait(100);
    const textDrop = await panel(`(() => { const data=new DataTransfer(); data.setData('text/plain','Some ordinary text');
      const event=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data});
      document.querySelector('textarea').dispatchEvent(event); return event.defaultPrevented; })()`);
    assert.equal(textDrop, false);
    await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(`http://127.0.0.1:${server.address().port}/blob-page`)})`);
    await until(() => result(`inputsStand.owner.tabs.getActiveWebContents()?.executeJavaScript("!!document.images[0]?.complete && !!document.images[0]?.naturalWidth")`));
    const blobUrl = await result(`inputsStand.owner.tabs.getActiveWebContents().executeJavaScript('document.images[0].src')`);
    const blobInput = await panel(`window.aiPanel.dropInputs('free:none',[{url:${JSON.stringify(blobUrl)}}])`);
    assert.equal(blobInput.ok, true, JSON.stringify(blobInput));
    assert.equal(blobInput.files[0].kind, 'image');
    await panel(`window.aiPanel.removeInput('free:none',${JSON.stringify(blobInput.files[0].id)})`);
    await panel(`window.slowDrop=window.aiPanel.dropInputs('free:none',[{url:${JSON.stringify(`http://127.0.0.1:${server.address().port}/slow-image.png`)}}]); true`);
    await wait(100); await panel('window.aiPanel.clearChat(); true');
    const stale = await panel('window.slowDrop');
    assert.equal(stale.ok, false);
    assert.match(stale.error, /Беседа изменилась/);
    assert.equal(await sync(`inputsStand.files.preview(inputsStand.selected.key,${JSON.stringify(id)})`), null);
    assert.equal(await panel(`document.body.textContent.includes('terms.txt')`), false);
    // Изображение сайта бросается в ленту, а не textarea. Отправка без текста остаётся явной.
    const imageUrl = `http://127.0.0.1:${server.address().port}/image.png`;
    await panel(`(() => { const data = new DataTransfer(); data.setData('text/html', '<img src="${imageUrl}">');
      document.querySelector('.ai-chat-drop-zone').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data})); return true; })()`);
    await until(() => panel(`!!document.querySelector('img[alt="image.png"]')`));
    assert.equal(await panel(`document.querySelector('button[title="Отправить"]').disabled`), false);
    await panel(`document.querySelector('button[title="Отправить"]').click(); true`);
    await until(() => sync('inputsStand.ownership.tabContexts.get(inputsStand.selected.key).messages.length === 2'));
    assert.equal(await sync('inputsStand.ownership.tabContexts.get(inputsStand.selected.key).messages[0].text'), '');
    assert.ok(bodies.at(-1).messages.at(-1).content.some(part => part.type === 'image_url'));
    const forbidden = await panel(`window.aiPanel.dropInputs('free:none',[{url:'file:///C:/Windows/win.ini'}])`);
    assert.equal(forbidden.ok, false);
    await panel('window.aiPanel.clearChat(); true'); await wait(100);
    // Файл с диска передаётся байтами, произвольный путь не получает права чтения main.
    await panel(`(() => { const data = new DataTransfer(), bytes=Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0));
      data.items.add(new File([bytes],'dropped.png',{type:'image/png'}));
      document.querySelector('.ai-chat-drop-zone').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data})); return true; })()`);
    await until(() => panel(`!!document.querySelector('img[alt="dropped.png"]')`));
    assert.equal(await panel(`document.querySelectorAll('img[alt="dropped.png"]').length`), 1);
    await panel('window.aiPanel.clearChat(); true'); await wait(100);
    // У локальной изображения отклоняются до загрузки модели и сетевого запроса.
    await sync(`inputsStand.registry.setRoutingTable({}); inputsStand.electron.clipboard.readImage=()=>inputsStand.electron.nativeImage.createFromBuffer(Buffer.from(${JSON.stringify(png)},'base64')); true`);
    const pasted = await panel(`window.aiPanel.pasteInput('free:none')`);
    assert.equal(pasted.ok, false);
    assert.match(pasted.error, /не читает изображения/);
    console.log('Итого: 31 прошло, 0 не прошло');
  }, { main: true });
} finally { server.close(); }
