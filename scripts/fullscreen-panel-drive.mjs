// Настоящий DOM-fullscreen: чат и отдельные нативные веб-слоты не остаются над видео.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  const url = ctx.echoUrl('/links');
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`);
  await wait(600);
  const probe = async expression => {
    const code = `globalThis.__fsProbe = (async () => {
    const req = process.mainModule.require, root = req('electron').app.getAppPath();
    const mod = name => req(req('path').join(root, 'dist-electron/electron', name));
    const { mainContext } = mod('WindowRegistry.js');
    const panel = mod('aipanel/instances.js');
    const apps = mod('WebAppManager.js');
    const ctx = mainContext(), win = ctx.win;
    const wc = ctx.tabs.getActiveWebContents();
    ${expression}
  })()`;
    const response = await ctx.main.send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true });
    if (response.error || response.result?.exceptionDetails) throw new Error(JSON.stringify(response));
    return response.result?.result?.value;
  };
  await probe(`globalThis.__fsTrace = [];
    const record = event => globalThis.__fsTrace.push({ event, at: performance.now(), panelOpen: panel.existingPanel(win)?.open });
    for (const event of ['oblako:prepare-html-fullscreen', 'enter-full-screen', 'leave-full-screen', 'resize']) win.on(event, () => record(event));
    for (const event of ['enter-html-full-screen', 'leave-html-full-screen']) wc.on(event, () => record(event));
    const original = win.setFullScreen.bind(win);
    win.setFullScreen = value => { record('setFullScreen:' + value); const start = performance.now(); original(value); record('setFullScreen:done:' + (performance.now() - start).toFixed(1)); };
    return true;`);
  for (const mode of ['chat', 'apps', 'pinned', 'woken']) {
    if (mode === 'pinned') await probe(`const id = ctx.tabs.createPinnedTab(${JSON.stringify(url)}); ctx.tabs.activate(id); return true;`);
    if (mode === 'woken') await probe(`const id = ctx.tabs.createTab(${JSON.stringify(url)});
      await ctx.tabs.sleepTabAsync(id); ctx.tabs.activate(id); return true;`);
    if (mode === 'pinned' || mode === 'woken') await wait(600);
    await ctx.chrome.evaluate('window.oblako.toggleAiPanel()');
    await wait(400);
    if (mode === 'apps') await probe(`apps.openWebApp(win, 'fullscreen-test', ${JSON.stringify(url)});
      apps.setWebAppBounds(win, 'fullscreen-test', { x: 900, y: 100, width: 240, height: 240 }); return true;`);
    assert.equal(await probe('return panel.existingPanel(win)?.open;'), true);
    await probe(`await wc.executeJavaScript("window.__fsFrames = []; window.__fsLast = performance.now(); window.__fsUntil = performance.now() + 700; function fsFrame(now) { window.__fsFrames.push(now - window.__fsLast); window.__fsLast = now; if (now < window.__fsUntil) requestAnimationFrame(fsFrame); } requestAnimationFrame(fsFrame); true");
      wc.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
      wc.focus(); await wc.executeJavaScript("document.getElementById('fs')?.remove(); document.body.insertAdjacentHTML('afterbegin', '<button id=fs style=position:fixed;top:10px;left:10px;z-index:99999;width:100px;height:40px>Fullscreen</button>'); document.getElementById('fs').onclick = () => document.body.requestFullscreen(); true");
      wc.sendInputEvent({ type: 'mouseDown', x: 40, y: 30, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: 40, y: 30, button: 'left', clickCount: 1 }); return true;`);
    await wait(800);
    const state = await probe(`return { fullscreen: win.isFullScreen(), open: panel.existingPanel(win)?.open,
      overlays: win.contentView.children.filter(v => v.getVisible() && (v.webContents?.getURL().includes('/aipanel.html') || v.webContents?.getURL() === ${JSON.stringify(url)})).length };`);
    assert.equal(state.fullscreen, true);
    assert.equal(state.open, false);
    assert.equal(state.overlays, 1, 'В окне остался только слой страницы, без панели и веб-слота');
    const frames = JSON.parse(await probe(`return await wc.executeJavaScript('JSON.stringify(window.__fsFrames)');`)).slice(1);
    console.log(`frames ${mode}: ${frames.length}, максимальный интервал ${Math.max(...frames).toFixed(1)} мс`);
    await probe(`void wc.executeJavaScript('document.exitFullscreen(); true'); return true;`);
    await wait(600);
    assert.equal(await probe('return win.isFullScreen();'), false);
    assert.equal(await probe('return panel.existingPanel(win)?.open;'), false);
    const restored = await probe(`const view = win.contentView.children.find(v => v.webContents === wc);
      return { actual: view.getBounds(), expected: ctx.tabs.contentBounds };`);
    assert.deepEqual(restored.actual, restored.expected, 'После выхода восстановлена область контента');
    console.log(`ok Fullscreen: ${mode}, панель и веб-слоты скрыты, выход работает`);
  }
  await ctx.chrome.evaluate('window.oblako.toggleAiPanel()');
  assert.equal(await probe('return panel.existingPanel(win)?.open;'), true);
  console.log('ok Панель можно повторно открыть после выхода из fullscreen');
  const trace = await probe('return globalThis.__fsTrace;');
  assert.equal(trace.filter(item => item.event === 'setFullScreen:true').length, 4);
  assert.equal(trace.filter(item => item.event === 'setFullScreen:false').length, 4);
  assert.equal(trace.filter(item => item.event === 'setFullScreen:true').every(item => item.panelOpen === false), true);
  console.log(JSON.stringify(trace.map((item, i) => ({ event: item.event, ms: Math.round(item.at - trace[0].at), gap: i ? Math.round(item.at - trace[i - 1].at) : 0 })), null, 2));
}, { main: true });
