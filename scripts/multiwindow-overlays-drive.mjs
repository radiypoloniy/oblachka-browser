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
  await sync(`globalThis.overlayStand = { registry: ${load('/WindowRegistry.js')}, site: ${load('/SitePopoverManager.js')}, downloads: ${load('/DownloadsPopoverManager.js')}, translate: ${load('/TranslatePopoverManager.js')}, service: ${load('/TranslationService.js')}, electron: process.mainModule.require('electron'), gates: [], decisions: [] }; true`);
  await ctx.chrome.evaluate('window.oblako.openWindow()'); await wait(650);
  await sync('overlayStand.a = overlayStand.registry.allContexts()[0]; overlayStand.b = overlayStand.registry.allContexts()[1]; true');
  const inWindow = (w, code) => ctx.evalMain(`overlayStand.${w}.chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  for (const w of ['a','b']) await inWindow(w, `window.oblako.createTab(${JSON.stringify(ctx.echoUrl(`/overlay-${w}`))})`);
  await wait(250);
  const remember = async (w, kind) => sync(`overlayStand.${w}.${kind} = overlayStand.${w}.win.contentView.children.find(v => v.webContents?.getURL().includes('${kind}popover.html')); overlayStand.${w}.${kind}Wc = overlayStand.${w}.${kind}.webContents; true`);
  // Якорь другого окна не сдвигает карточку; IPC старой вью не закрывает новую.
  await sync('overlayStand.site.syncSitePopoverAnchorBounds(overlayStand.a.win,{x:200,y:60,width:30,height:25}); overlayStand.site.showSitePopover(overlayStand.a.win); true'); await wait(250); await remember('a','site');
  const bounds = await sync('overlayStand.a.site.getBounds()');
  await sync('overlayStand.site.syncSitePopoverAnchorBounds(overlayStand.b.win,{x:600,y:90,width:20,height:25}); true');
  assert.deepEqual(await sync('overlayStand.a.site.getBounds()'), bounds);
  assert.equal((await ctx.evalMain('overlayStand.a.siteWc.executeJavaScript("window.sitePopover.getActiveTab()")')).url, ctx.echoUrl('/overlay-a'));
  await sync('overlayStand.site.showSitePopover(overlayStand.b.win); true'); await wait(250); await remember('b','site');
  assert.equal(await sync('overlayStand.a.siteWc.isDestroyed()'), true);
  await sync(`overlayStand.electron.ipcMain.emit('site-popover:close',{sender:overlayStand.a.siteWc}); true`);
  assert.equal(await sync('overlayStand.site.isSitePopoverOpen(overlayStand.b.win)'), true);
  assert.equal((await ctx.evalMain('overlayStand.b.siteWc.executeJavaScript("window.sitePopover.getActiveTab()")')).url, ctx.echoUrl('/overlay-b'));
  await inWindow('a','window.oblako.activateTab("hub")');
  assert.equal(await sync('overlayStand.site.isSitePopoverOpen(overlayStand.b.win)'), true);
  // Дублирующая загрузка другого окна сначала завершает старый вопрос и сохраняет новый.
  await sync(`overlayStand.downloads.setDuplicateDecisionHandler((id,decision)=>overlayStand.decisions.push({id,decision})); overlayStand.downloads.setDuplicatePrompt({askId:'old'},overlayStand.a.win); overlayStand.downloads.showDownloadsPopover(overlayStand.a.win); true`); await wait(200); await remember('a','downloads');
  await sync(`overlayStand.downloads.setDuplicatePrompt({askId:'new'},overlayStand.b.win); overlayStand.downloads.showDownloadsPopover(overlayStand.b.win); true`); await wait(200); await remember('b','downloads');
  assert.deepEqual(await sync('overlayStand.decisions'), [{id:'old',decision:'cancel'}]);
  assert.equal(await sync('overlayStand.downloads.getDuplicatePrompt().askId'), 'new');
  await sync(`overlayStand.electron.ipcMain.emit('downloads-popover:close',{sender:overlayStand.a.downloadsWc}); overlayStand.downloads.closeDownloadsPopover(overlayStand.a.win); true`);
  assert.equal(await sync('overlayStand.downloads.getDuplicatePrompt().askId'), 'new');
  // Перевод выделения не закрывается переключением чужого окна и отменяется сменой владельца.
  await inWindow('a', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/selection-a'))})`); await wait(150);
  await sync(`overlayStand.service.runAiAction = (action,text,chunk,lang,signal) => new Promise(resolve=>overlayStand.gates.push({signal,finish:resolve})); overlayStand.translate.showTranslatePopover(overlayStand.b.win,'explain','text',{x:200,y:200,width:30,height:20},overlayStand.b.tabs.getActiveWebContents()); true`); await wait(200); await remember('b','translate');
  await inWindow('a','window.oblako.activateTab("hub")');
  assert.equal(await sync('overlayStand.gates[0].signal.aborted'), false);
  await inWindow('a', `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/selection-another'))})`); await wait(150);
  await sync(`overlayStand.translate.showTranslatePopover(overlayStand.a.win,'explain','text',{x:200,y:200,width:30,height:20},overlayStand.a.tabs.getActiveWebContents()); true`); await wait(200); await remember('a','translate');
  assert.equal(await sync('overlayStand.gates[0].signal.aborted'), true);
  await sync(`overlayStand.electron.ipcMain.emit('translate-popover:close',{sender:overlayStand.b.translateWc}); true`);
  assert.equal(await sync('overlayStand.gates[1].signal.aborted'), false);
  await sync('overlayStand.a.win.close(); true'); await wait(150);
  assert.equal(await sync('overlayStand.gates[1].signal.aborted'), true);
  assert.equal(await sync('overlayStand.site.isSitePopoverOpen(overlayStand.b.win)'), true);
  await sync(`overlayStand.gates[0].finish({ok:true,out:'old'}); overlayStand.gates[1].finish({ok:true,out:'closed'}); true`);
  console.log('OK: владельцы карточек сайта/загрузок/выделения, независимые якоря, поздний IPC, смена вкладки соседнего окна, дубли загрузок, закрытие первого окна.');
}, { main: true });
