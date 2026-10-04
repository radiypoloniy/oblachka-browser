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
  await sync(`globalThis.hubStand = { registry: ${load('/WindowRegistry.js')}, service: ${load('/TranslationService.js')}, queue: ${load('/QwenQueue.js')}, ownership: ${load('/hubChatOwnership.js')}, graph: ${load('/GraphWebAppManager.js')}, extract: ${load('/NotebookExtract.js')}, index: ${load('/HistoryIndexer.js')}, electron: process.mainModule.require('electron'), deps: ${load('/main.js')}.makeIpcDeps(), gates: [], events: [] }; true`);
  await ctx.chrome.evaluate('window.oblako.openWindow()'); await wait(650);
  await sync('hubStand.a = hubStand.registry.allContexts()[0]; hubStand.b = hubStand.registry.allContexts()[1]; true');
  const inWindow = (w, code) => ctx.evalMain(`hubStand.${w}.chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  await sync(`hubStand.service.runChatMessage = (text, history, chunk, signal) => hubStand.queue.withQwenQueue(() => new Promise(resolve => hubStand.gates.push({text, history, chunk, signal, finish: resolve})), signal); for (const name of ['a','b']) { const wc=hubStand[name].chromeView.webContents; const send=wc.send.bind(wc); wc.send=(channel,data)=>{hubStand.events.push({name,channel,data});send(channel,data);}; } true`);
  const send = async (w, text) => { await inWindow(w, `window.oblako.sendHubChatMessage('hub', ${JSON.stringify(text)}, false)`); await wait(100); };
  const finish = async (i, text) => { await sync(`hubStand.gates[${i}].finish(${JSON.stringify({ok:true,out:text,history:[{type:'user',text}]})}); true`); await wait(100); };
  await send('a', 'Question A'); await send('b', 'Question B');
  assert.equal(await sync('hubStand.gates.length'), 1);
  await finish(0, 'Answer A'); await finish(1, 'Answer B');
  const sessions = await inWindow('a', 'window.oblako.listHubChatSessions()');
  assert.equal(sessions.length, 2);
  assert.deepEqual(new Set(sessions.map(s => s.title)), new Set(['Question A','Question B']));
  await send('a', 'Continue A');
  assert.deepEqual(await sync('hubStand.gates[2].history'), [{type:'user',text:'Answer A'}]);
  await inWindow('a', 'window.oblako.newHubChatSession("hub")');
  assert.equal(await sync('hubStand.gates[2].signal.aborted'), true);
  await finish(2, 'Stale A');
  assert.equal(await inWindow('b', 'window.oblako.listHubChatSessions().then(s=>s.length)'), 2);
  await send('b', 'Continue B'); assert.deepEqual(await sync('hubStand.gates[3].history'), [{type:'user',text:'Answer B'}]); await finish(3, 'B continues');
  // Notebook извлекает открытую страницу своего окна, даже если адрес одинаковый.
  const url = ctx.echoUrl('/notebook-source');
  for (const w of ['a','b']) {
    const id = await inWindow(w, `window.oblako.createTab(${JSON.stringify(url)})`);
    await wait(100);
    await ctx.evalMain(`hubStand.${w}.tabs.getWebContentsForTab(${JSON.stringify(id)}).executeJavaScript(${JSON.stringify(`document.body.textContent='${w} source';`)})`);
  }
  await sync('hubStand.index.extractEnrichedText = wc => wc.executeJavaScript("document.body.textContent"); true');
  for (const w of ['a','b']) assert.equal((await ctx.evalMain(`hubStand.extract.extractUrlText(hubStand.${w}.win,${JSON.stringify(url)})`)).text, `${w} source`);
  // Один узел графа в двух окнах — две независимые страницы.
  await sync(`for(const w of ['a','b']) hubStand.graph.showGraphWebApp(hubStand[w].win, 7, 'same-node', ${JSON.stringify(ctx.echoUrl('/graph-app'))}, {x:200,y:200,width:500,height:300}); true`); await wait(300);
  await sync(`for(const w of ['a','b']) hubStand[w].graphWc=hubStand[w].win.contentView.children.find(v=>v.webContents?.getURL().endsWith('/graph-app')).webContents; true`);
  assert.notEqual(await sync('hubStand.a.graphWc.id'), await sync('hubStand.b.graphWc.id'));
  for (const w of ['a','b']) await ctx.evalMain(`hubStand.${w}.graphWc.executeJavaScript(${JSON.stringify(`document.body.textContent='${w} graph answer';const r=document.createRange();r.selectNodeContents(document.body);window.getSelection().removeAllRanges();window.getSelection().addRange(r);`)})`);
  for (const w of ['a','b']) assert.equal(await ctx.evalMain(`hubStand.graph.captureAnswer(hubStand.${w}.win,7,'same-node','selection')`), `${w} graph answer`);
  await send('a', 'Closing A'); await sync('hubStand.a.win.close(); true');
  for (let n=0;n<40 && !(await sync('hubStand.a.win.isDestroyed()'));n++) await wait(100);
  assert.equal(await sync('hubStand.a.win.isDestroyed()'), true);
  await wait(100);
  assert.equal(await sync('hubStand.gates[4].signal.aborted'), true); await finish(4, 'Late closed A');
  assert.equal(await sync('hubStand.a.graphWc.isDestroyed()'), true);
  assert.equal(await sync('hubStand.b.graphWc.isDestroyed()'), false);
  await send('b', 'Surviving B'); await finish(5, 'Surviving answer');
  assert.equal(await sync(`hubStand.events.some(e=>e.name==='b' && e.channel==='hub-chat:result' && e.data.outcome.out==='Late closed A')`), false);
  assert.equal(await ctx.evalMain(`hubStand.graph.captureAnswer(hubStand.b.win,7,'same-node','selection')`), 'b graph answer');
  console.log('OK: отдельные Hub-беседы и SQL-сессии, общая очередь, сброс/закрытие без поздних записей, независимые страницы одного узла графа.');
}, { main: true });
