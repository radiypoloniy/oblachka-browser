// Настоящий видеоплеер: отдельно меряем ожидание запроса, изменение окна и кадры страницы.
import fs from 'node:fs';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  const url = 'https://www.youtube.com/watch?v=ri8ZsfSZgRw';
  const id = await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`);
  const probe = async code => {
    const expression = `globalThis.__ytProbe = (async () => {
      const req = process.mainModule.require, root = req('electron').app.getAppPath();
      const mod = name => req(req('path').join(root, 'dist-electron/electron', name));
      const ctx = mod('WindowRegistry.js').mainContext(), win = globalThis.__ytReference ?? ctx.win;
      const wc = globalThis.__ytReference?.webContents ?? ctx.tabs.getWebContentsForTab(${JSON.stringify(id)});
      ${code}
    })()`;
    const r = await ctx.main.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r));
    return r.result?.result?.value;
  };
  if (process.env.OBLAKO_YT_REFERENCE === '1') await probe(`globalThis.__ytReference = new (req('electron').BrowserWindow)({width:1280,height:800,frame:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
    ctx.tabs.closeTab(${JSON.stringify(id)}); globalThis.__ytReference.loadURL(${JSON.stringify(url)}); return true;`);
  await probe('if (!win.isMaximized()) win.maximize(); return true;');
  await wait(600);
  let page;
  for (let i = 0; i < 30; i++) {
    page = await probe(`return await wc.executeJavaScript('({title:document.title,url:location.href,button:!!document.querySelector(".ytp-fullscreen-button"),video:!!document.querySelector("video"),text:document.body?.innerText.slice(0,500)})');`);
    if (page?.button) break;
    await wait(1000);
  }
  console.log('page', JSON.stringify(page));
  fs.mkdirSync('scripts/shots', { recursive: true });
  await probe(`const shot = await wc.capturePage(); req('fs').writeFileSync(req('path').join(root,'scripts/shots/youtube-before.png'),shot.toPNG()); return true;`);
  if (!page?.button) throw new Error('YouTube-плеер не загрузился на отдельном профиле');
  await probe(`await wc.executeJavaScript('document.querySelector("video").muted=true; document.querySelector("video").play().catch(()=>{}); true'); return true;`);
  await wait(10000);
  if (process.env.OBLAKO_YT_TRACE === '1') await probe(`await req('electron').contentTracing.startRecording({ included_categories: ['devtools.timeline','blink','cc','viz','gpu','toplevel'] }); return true;`);
  await probe(`wc.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
    globalThis.__ytTrace = []; const record = event => globalThis.__ytTrace.push({event,at:performance.now()});
    for (const event of ['resize','enter-full-screen','leave-full-screen']) win.on(event,()=>record(event));
    for (const event of ['enter-html-full-screen','leave-html-full-screen']) wc.on(event,()=>record(event));
    globalThis.__ytRecord = record; return true;`);
  if (process.env.OBLAKO_YT_REFERENCE !== '1') await probe(`const view = win.contentView.children.find(v=>v.webContents===wc), original = view.setBounds.bind(view);
    view.setBounds = bounds => { globalThis.__ytRecord('bounds:' + JSON.stringify(bounds)); original(bounds); }; return true;`);
  for (const mode of process.env.OBLAKO_YT_REFERENCE === '1' ? ['closed','closed','closed'] : ['closed', 'chat', 'apps']) {
    if (mode !== 'closed') { await ctx.chrome.evaluate('window.oblako.toggleAiPanel()'); await wait(400); }
    if (mode === 'apps') await probe(`mod('WebAppManager.js').openWebApp(win,'yt-test','https://translate.yandex.ru');
      mod('WebAppManager.js').setWebAppBounds(win,'yt-test',{x:920,y:100,width:250,height:480}); return true;`);
    await probe(`wc.focus(); await wc.executeJavaScript('window.__ytGaps=[]; window.__ytLast=performance.now(); window.__ytUntil=performance.now()+2500; function ytFrame(now){window.__ytGaps.push(now-window.__ytLast);window.__ytLast=now;if(now<window.__ytUntil)requestAnimationFrame(ytFrame);}requestAnimationFrame(ytFrame); document.querySelector("video").muted=true; document.querySelector("video").play().catch(()=>{}); true');
      globalThis.__ytRecord('click:' + ${JSON.stringify(mode)});
      await wc.executeJavaScript('document.querySelector(".ytp-fullscreen-button").click(); true',true); return true;`);
    await wait(2800);
    console.log(mode, await probe(`return {fullscreen:win.isFullScreen(),gaps:await wc.executeJavaScript('window.__ytGaps.filter(x=>x>35)'),video:await wc.executeJavaScript('(()=>{const v=document.querySelector("video");return {time:v.currentTime,ready:v.readyState,paused:v.paused}})()')};`));
    await probe(`const shot=await wc.capturePage(); req('fs').writeFileSync(req('path').join(root,'scripts/shots/youtube-' + ${JSON.stringify(mode)} + '.png'),shot.toPNG()); await wc.executeJavaScript('document.fullscreenElement ? document.exitFullscreen() : null'); return true;`);
    await wait(500);
  }
  const trace = await probe('return globalThis.__ytTrace;');
  if (process.env.OBLAKO_YT_TRACE === '1') await probe(`await req('electron').contentTracing.stopRecording(req('path').join(root,'scripts/shots/youtube-fullscreen-trace.json')); return true;`);
  console.log(JSON.stringify(trace.map((x,i)=>({...x,at:Math.round(x.at-trace[0].at),gap:i?Math.round(x.at-trace[i-1].at):0})),null,2));
}, { main: true });
