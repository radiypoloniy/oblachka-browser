import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  await wait(900);
  const sync = expression => ctx.evalMainSync(expression);
  const load = suffix => `Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith(${JSON.stringify(suffix)})).exports`;
  await sync(`globalThis.jobsStand={registry:${load('/WindowRegistry.js')}, service:${load('/TranslationService.js')}, queue:${load('/QwenQueue.js')}, activity:${load('/AiActivity.js')}, page:${load('/NotebookPage.js')}, graph:${load('/GraphEngine.js')}, deps:${load('/main.js')}.makeIpcDeps(), electron:process.mainModule.require('electron'), gates:[], results:{}, events:[]}; true`);
  await ctx.chrome.evaluate('window.oblako.openWindow()'); await wait(650);
  await sync(`jobsStand.a=jobsStand.registry.allContexts()[0]; jobsStand.b=jobsStand.registry.allContexts()[1]; jobsStand.service.runChatMessage=(text,history,chunk,signal)=>jobsStand.queue.withQwenQueue(()=>new Promise(resolve=>jobsStand.gates.push({text,signal,finish:resolve})),signal); true`);
  const inWindow = (w,code) => ctx.evalMain(`jobsStand.${w}.chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  const studio = async (w,kind='summary') => {
    await sync(`jobsStand.electron.ipcMain._invokeHandlers.get('notebook:studio-gen')({sender:jobsStand.${w}.chromeView.webContents},${JSON.stringify(kind)},'Sources for '+${JSON.stringify(w)}).then(r=>jobsStand.results[${JSON.stringify(w)}]=r); true`); await wait(100);
  };
  const finish = async (i,out) => { await sync(`jobsStand.gates[${i}].finish(${JSON.stringify({ok:true,out,history:[]})}); true`); await wait(100); };
  const close = async w => {
    await sync(`jobsStand.${w}.win.close(); true`);
    for(let n=0;n<40 && !(await sync(`jobsStand.${w}.win.isDestroyed()`));n++) await wait(100);
    assert.equal(await sync(`jobsStand.${w}.win.isDestroyed()`),true);
    await wait(100);
  };
  await studio('a'); await studio('b');
  assert.equal(await sync('jobsStand.activity.getActivity().count'),2);
  await close('a'); assert.equal(await sync('jobsStand.gates[0].signal.aborted'),true);
  assert.equal(await sync('jobsStand.activity.getActivity().count'),1);
  await finish(0,'Late A'); await finish(1,'B material');
  assert.equal(await sync('jobsStand.results.a.ok'),false);
  assert.equal(await sync('jobsStand.results.b.text'),'B material');
  assert.equal(await sync('jobsStand.activity.getActivity()'),null);
  await inWindow('b','window.oblako.openWindow()'); await wait(400);
  await sync(`jobsStand.c=jobsStand.registry.allContexts().find(c=>c!==jobsStand.b); jobsStand.store=jobsStand.deps.graphs;
    for(const name of ['old','other']) {const meta=jobsStand.store.create(name);jobsStand[name]=meta.id; jobsStand.store.saveStructure(meta.id,{nodes:[{id:'work',kind:'qwen.transform',x:0,y:0,w:200,h:100,title:name,config:{instruction:name}}],edges:[]});}
    jobsStand.store.setNodeResult(jobsStand.old,'work',{inputHash:'old-hash',output:'Previous result',outputTitle:null,error:null}); true`);
  const run = async (w,graph) => { await sync(`jobsStand.graph.runGraph(jobsStand.${w}.win,jobsStand.store,jobsStand.${graph},'work',p=>jobsStand.events.push({owner:${JSON.stringify(w)},p})); true`); await wait(100); };
  await run('c','old'); await run('b','other'); await run('b','old');
  assert.equal(await sync(`jobsStand.events.some(e=>e.owner==='b' && e.p.graphId===jobsStand.old && e.p.status==='error')`),true);
  await close('c'); assert.equal(await sync('jobsStand.gates[2].signal.aborted'),true);
  await finish(2,'Late graph');
  assert.equal(await sync(`jobsStand.store.get(jobsStand.old).nodes[0].output`),'Previous result');
  assert.equal(await sync(`jobsStand.store.listNodeHistory(jobsStand.old,'work').length`),0);
  await finish(3,'Other graph survives');
  assert.equal(await sync(`jobsStand.store.get(jobsStand.other).nodes[0].output`),'Other graph survives');
  await run('b','old'); await finish(4,'New result');
  assert.equal(await sync(`jobsStand.store.get(jobsStand.old).nodes[0].output`),'New result');
  assert.equal(await sync(`jobsStand.store.listNodeHistory(jobsStand.old,'work').length`),1);
  // Даже движок, вернувший поздний успех, не отдаёт документ закрытому заказчику.
  await inWindow('b','window.oblako.openWindow()'); await wait(400);
  await sync(`jobsStand.page.buildPage=(_context,_sources,act)=>new Promise(resolve=>{jobsStand.doc={act,finish:resolve};}); true`);
  await studio('b','page'); await close('b');
  assert.equal(await sync('jobsStand.doc.act.cancelled'),true);
  await sync(`jobsStand.doc.finish({ok:true,page:{title:'Late document'}}); true`); await wait(100);
  assert.equal(await sync('jobsStand.results.b.ok'),false);
  assert.equal(await sync('jobsStand.activity.getActivity()'),null);
  console.log('OK: отмена Студии/документа/графа своего окна, независимость соседней очереди, отказ одновременного прогона одного графа, сохранность прежнего SQL-результата и истории, повторный запуск.');
}, {main:true});
