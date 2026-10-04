// Закрытие первого/последнего окна и отмена app.quit — на временном профиле без VPN-ключей.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  await wait(1000);
  const load = suffix => `Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith(${JSON.stringify(suffix)})).exports`;
  await ctx.evalMainSync(`globalThis.lifecycleStand = {
    registry: ${load('/WindowRegistry.js')}, main: ${load('/main.js')},
    vpn: ${load('/VpnProcess.js')}, inference: ${load('/inference/InferenceHost.js')},
    electron: process.mainModule.require('electron'), stops: 0, inferenceStops: 0,
  };
  (() => {
    const st = lifecycleStand;
    const stop = st.vpn.stop; const shutdown = st.inference.shutdownInference;
    st.vpn.stop = async () => { st.stops++; console.log('[lifecycle-stand] stop-vpn'); await stop(); };
    st.inference.shutdownInference = () => { st.inferenceStops++; console.log('[lifecycle-stand] stop-inference'); shutdown(); };
  })()`);
  const savedUrl = ctx.echoUrl('/saved-main');
  const mainTab = await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(savedUrl)})`);
  await ctx.chrome.evaluate(`window.oblako.togglePinTab(${JSON.stringify(mainTab)})`);
  await ctx.chrome.evaluate('window.oblako.openWindow()');
  await wait(800);
  await ctx.evalMain(`lifecycleStand.a = lifecycleStand.registry.allContexts()[0]; lifecycleStand.b = lifecycleStand.registry.allContexts()[1]; undefined`);
  const inB = code => ctx.evalMain(`lifecycleStand.b.chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  await inB(`window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/survivor'))})`);

  // Отказ окна закрыться при попытке выхода — сервисы остаются живы.
  await ctx.evalMain('lifecycleStand.a.win.once("close", e => e.preventDefault()); lifecycleStand.b.win.once("close", e => e.preventDefault()); lifecycleStand.electron.app.quit()');
  await wait(250);
  assert.deepEqual(await ctx.evalMain(`({ windows: lifecycleStand.registry.allContexts().length, stopping: lifecycleStand.main.makeWindowDeps().isShuttingDown(), stops: lifecycleStand.stops, inferenceStops: lifecycleStand.inferenceStops })`), {
    windows: 2, stopping: false, stops: 0, inferenceStops: 0,
  });

  await ctx.evalMain('lifecycleStand.electron.ipcMain._invokeHandlers.get("window:close")({ sender: lifecycleStand.a.chromeView.webContents })');
  await wait(300);
  assert.deepEqual(await ctx.evalMain(`({ windows: lifecycleStand.registry.allContexts().length, stopping: lifecycleStand.main.makeWindowDeps().isShuttingDown(), stops: lifecycleStand.stops, inferenceStops: lifecycleStand.inferenceStops })`), {
    windows: 1, stopping: false, stops: 0, inferenceStops: 0,
  });
  const saved = JSON.parse(await fs.readFile(path.join(ctx.profile, 'session.json'), 'utf8'));
  assert.equal(saved.version, 6);
  assert.ok(saved.closedWindows.some(w => w.snapshot.pinnedTabs.some(t => t.url === savedUrl)));
  const added = await inB(`window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/after-main-close'))})`);
  assert.ok((await inB('window.oblako.getAllTabs()')).some(t => t.id === added));

  await ctx.evalMain('lifecycleStand.b.win.once("close", e => e.preventDefault()); lifecycleStand.electron.app.quit()');
  await wait(250);
  assert.equal(await ctx.evalMain('lifecycleStand.main.makeWindowDeps().isShuttingDown()'), false);
  assert.equal(await ctx.evalMain('lifecycleStand.stops + lifecycleStand.inferenceStops'), 0);
  // Служебное окно не должно удерживать приложение после закрытия последнего браузерного.
  await ctx.evalMain('lifecycleStand.helper = new lifecycleStand.electron.BrowserWindow({ show: false }); setTimeout(() => lifecycleStand.b.win.close(), 100); undefined');
  ctx.main.close();
  for (let i = 0; i < 60 && !ctx.appLog.join('').includes('[lifecycle-stand] stop-vpn'); i++) await wait(100);
  const log = ctx.appLog.join('');
  assert.equal(log.split('[lifecycle-stand] stop-vpn').length - 1, 1);
  assert.equal(log.split('[lifecycle-stand] stop-inference').length - 1, 1);
  let target = true;
  for (let i = 0; i < 30 && target; i++) { await wait(100); target = await ctx.findTarget(t => t.type === 'page', 1); }
  assert.equal(target, null);
  console.log('OK: отмена выхода, закрытие главного, работа второго, сохранение закреплений, финальная остановка сервисов один раз, выход при служебном окне.');
}, { main: true });
