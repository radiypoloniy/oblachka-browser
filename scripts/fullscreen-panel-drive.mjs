// Настоящий DOM-fullscreen: чат и отдельные нативные веб-слоты не остаются над видео.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  const url = ctx.echoUrl('/links');
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`);
  await wait(600);
  const probe = expression => ctx.evalMain(`(async () => {
    const req = process.mainModule.require, root = req('electron').app.getAppPath();
    const mod = name => req(req('path').join(root, 'dist-electron/electron', name));
    const { mainContext } = mod('WindowRegistry.js');
    const panel = mod('aipanel/instances.js');
    const apps = mod('WebAppManager.js');
    const ctx = mainContext(), win = ctx.win;
    const wc = ctx.tabs.getActiveWebContents();
    ${expression}
  })()`);
  for (const mode of ['chat', 'apps']) {
    await ctx.chrome.evaluate('window.oblako.toggleAiPanel()');
    await wait(400);
    if (mode === 'apps') await probe(`apps.openWebApp(win, 'fullscreen-test', ${JSON.stringify(url)});
      apps.setWebAppBounds(win, 'fullscreen-test', { x: 900, y: 100, width: 240, height: 240 }); return true;`);
    assert.equal(await probe('return panel.existingPanel(win)?.open;'), true);
    await probe(`wc.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
      wc.focus(); await wc.executeJavaScript("document.getElementById('fs')?.remove(); document.body.insertAdjacentHTML('afterbegin', '<button id=fs style=position:fixed;top:10px;left:10px;z-index:99999;width:100px;height:40px>Fullscreen</button>'); document.getElementById('fs').onclick = () => document.body.requestFullscreen(); true");
      wc.sendInputEvent({ type: 'mouseDown', x: 40, y: 30, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: 40, y: 30, button: 'left', clickCount: 1 }); return true;`);
    await wait(800);
    const state = await probe(`return { fullscreen: win.isFullScreen(), open: panel.existingPanel(win)?.open,
      overlays: win.contentView.children.filter(v => v.webContents?.getURL().includes('/aipanel.html') || v.webContents?.getURL() === ${JSON.stringify(url)}).length };`);
    assert.equal(state.fullscreen, true);
    assert.equal(state.open, false);
    assert.equal(state.overlays, 1, 'В окне остался только слой страницы, без панели и веб-слота');
    await probe(`void wc.executeJavaScript('document.exitFullscreen(); true'); return true;`);
    await wait(600);
    assert.equal(await probe('return win.isFullScreen();'), false);
    assert.equal(await probe('return panel.existingPanel(win)?.open;'), false);
    console.log(`ok Fullscreen: ${mode}, панель и веб-слоты скрыты, выход работает`);
  }
  await ctx.chrome.evaluate('window.oblako.toggleAiPanel()');
  assert.equal(await probe('return panel.existingPanel(win)?.open;'), true);
  console.log('ok Панель можно повторно открыть после выхода из fullscreen');
}, { main: true });
