// Настоящие React/IPC/AbortSignal, но управляемая генерация без GGUF.
import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async ctx => {
  const p = name => JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  await ctx.evalMain(`(()=>{const req=process.mainModule.require.bind(process.mainModule),h=req(${p('ProfileData')}).activeHistory();
    h.recordVisit('https://cancel.test/alpha','alpha');h.recordVisit('https://cancel.test/beta','beta');
    globalThis.__cancelSearch={started:0,cancelled:0};const service=req(${p('TranslationService')});service.expandHistorySearchQuery=async()=>[];
    service.rerankHistoryCandidates=async(_q,_c,opts)=>new Promise((resolve,reject)=>{const s=globalThis.__cancelSearch;s.started++;s.finish=()=>resolve([0]);
      opts.abort.addEventListener('abort',()=>{s.cancelled++;reject(Error('cancelled'));},{once:true});});})()`);
  await ctx.chrome.evaluate("window.oblako.createSpecialTab('history')");
  const until = predicate => ctx.chrome.evaluate(`(async()=>{for(let i=0;i<200;i++){if(${predicate})return;await new Promise(r=>setTimeout(r,25));}throw Error('cancel UI timeout');})()`);
  await until("[...document.querySelectorAll('input')].some(e=>/истории|history/i.test(e.placeholder))");
  const type = value => ctx.chrome.evaluate(`(()=>{const e=[...document.querySelectorAll('input')].find(e=>/истории|history/i.test(e.placeholder));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const start = async () => {
    await until("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('Найти по смыслу')&&!e.disabled)");
    await ctx.chrome.evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Найти по смыслу')).click()");
    await until("document.body.textContent.includes('Оцениваем совпадения…')");
  };
  await type('alpha');await start();await type('beta');await start();
  assert.equal(await ctx.evalMain('globalThis.__cancelSearch.cancelled'),1);
  await ctx.evalMain('globalThis.__cancelSearch.finish()');
  await until("document.body.textContent.includes('По смыслу')");
  assert.ok(await ctx.chrome.evaluate("!!document.querySelector('[title=\"https://cancel.test/beta\"]')"));
  assert.equal(await ctx.chrome.evaluate("!!document.querySelector('[title=\"https://cancel.test/alpha\"]')"),false);
  await type('alpha');await start();await ctx.chrome.evaluate("window.oblako.createSpecialTab('settings')");
  await ctx.evalMain('(async()=>{for(let i=0;i<100&&globalThis.__cancelSearch.cancelled<2;i++)await new Promise(r=>setTimeout(r,25));})()');
  assert.equal(await ctx.evalMain('globalThis.__cancelSearch.cancelled'),2);
  console.log('ok UI/IPC: смена запроса и закрытие панели отменяют генерацию; новый ответ не перезаписывается старым');
}, { main: true });
