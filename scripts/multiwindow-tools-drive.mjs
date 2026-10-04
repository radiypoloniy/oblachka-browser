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
  await sync(`globalThis.toolsStand = { registry: ${load('/WindowRegistry.js')}, service: ${load('/TranslationService.js')}, engines: ${load('/TranslationEngineRegistry.js')}, state: ${load('/pageTranslationState.js')}, translate: ${load('/PageTranslateManager.js')}, deps: ${load('/main.js')}.makeIpcDeps(), gates: [] }; true`);
  await ctx.chrome.evaluate('window.oblako.openWindow()'); await wait(650);
  await sync('toolsStand.a = toolsStand.registry.allContexts()[0]; toolsStand.b = toolsStand.registry.allContexts()[1]; true');
  const inWindow = (w, code) => ctx.evalMain(`toolsStand.${w}.chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  const a = await inWindow('a', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/translate-a'))})`);
  const b = await inWindow('b', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/translate-b'))})`);
  await wait(250);
  const page = (w, id, code) => ctx.evalMain(`toolsStand.${w}.tabs.getWebContentsForTab(${JSON.stringify(id)}).executeJavaScript(${JSON.stringify(code)})`);
  for (const [w, id] of [['a', a], ['b', b]]) await page(w, id, 'document.body.innerHTML="<main><p>Original document for translation.</p></main>"');
  await sync(`toolsStand.service.resolveDirection = async () => ({ src: 'en', tgt: 'ru' }); toolsStand.engines.ensureActiveEngineWarm = async () => {}; toolsStand.engines.getActiveEngine = () => ({ translateBatch(items, src, tgt, signal, progress) { return new Promise(resolve => toolsStand.gates.push({items, signal, progress, finish: resolve})); } }); toolsStand.service.runTabOrganizePrompt = async () => ({ ok: true, out: '', stopReason: 'eos' }); true`);
  await inWindow('a', 'window.oblako.togglePageTranslate()');
  await inWindow('b', 'window.oblako.togglePageTranslate()'); await wait(150);
  assert.equal(await sync('toolsStand.gates.length'), 2);
  assert.equal(await inWindow('a', 'window.oblako.getPageTranslateState()'), 'translating');
  assert.equal(await inWindow('b', 'window.oblako.getPageTranslateState()'), 'translating');
  await sync(`toolsStand.gates[0].finish(toolsStand.gates[0].items.map(i => ({ id:i.id, text:'A translated' }))); true`); await wait(150);
  assert.equal(await page('a', a, 'document.querySelector("p").textContent'), 'A translated');
  assert.equal(await page('b', b, 'document.querySelector("p").textContent'), 'Original document for translation.');
  assert.equal(await inWindow('b', 'window.oblako.getPageTranslateState()'), 'translating');
  // Перенос сохраняет выполняющийся перевод и адресата его состояния.
  await inWindow('b', 'window.oblako.createTab("about:blank")');
  await sync(`toolsStand.deps.moveTabToExistingWindow(toolsStand.b.tabs, ${JSON.stringify(b)}, toolsStand.a.win.id); true`);
  await sync(`toolsStand.gates[1].finish(toolsStand.gates[1].items.map(i => ({ id:i.id, text:'B translated' }))); true`); await wait(150);
  assert.equal(await page('a', b, 'document.querySelector("p").textContent'), 'B translated');
  await inWindow('a', 'window.oblako.togglePageTranslate()'); await wait(100);
  assert.equal(await page('a', b, 'document.querySelector("p").textContent'), 'Original document for translation.');
  await inWindow('a', 'window.oblako.togglePageTranslate()'); await wait(100);
  await inWindow('a', `window.oblako.activateTab(${JSON.stringify(a)})`);
  await ctx.evalMain(`toolsStand.a.tabs.getWebContentsForTab(${JSON.stringify(b)}).loadURL(${JSON.stringify(ctx.echoUrl('/new-document'))})`);
  assert.equal(await sync('toolsStand.gates[2].signal.aborted'), true);
  await sync(`toolsStand.gates[2].finish(toolsStand.gates[2].items.map(i => ({ id:i.id, text:'STALE' }))); true`); await wait(100);
  assert.equal(await page('a', b, 'document.body.textContent.includes("STALE")'), false);
  // Группировка читает дерево отправителя, включая окно, созданное после первого.
  const b1 = await inWindow('b', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/organize-one'))})`);
  const b2 = await inWindow('b', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/organize-two'))})`);
  const proposal = await inWindow('b', 'window.oblako.suggestGroups()');
  assert.equal(proposal.ok, true);
  assert.deepEqual(new Set(proposal.clusters.flatMap(c => c.nodeIds)), new Set([b1, b2]));
  await sync('toolsStand.a.win.close(); true'); await wait(150);
  const still = await inWindow('b', 'window.oblako.suggestGroups()');
  assert.equal(still.ok, true);
  assert.deepEqual(new Set(still.clusters.flatMap(c => c.nodeIds)), new Set([b1, b2]));
  console.log('OK: перевод двух окон, оригинал, перенос, отмена фоновой навигацией; группировка своего дерева после закрытия первого окна.');
}, { main: true });
