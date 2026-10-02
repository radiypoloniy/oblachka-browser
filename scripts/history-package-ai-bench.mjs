// Один небольшой парный прогон настоящей продуктовой цепочки на временном профиле.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';
import { deepPages, deepCases } from './fixtures/history-semantic-deep.mjs';

const tests=deepCases.filter(t=>['sound','battery','backup','plants','offline','number','missing','missing-brand'].includes(t.key));
const modelPath=path.join(process.env.APPDATA??'','oblako-browser/models/gguf/Qwen3.5-4B-Q4_K_M.gguf');
assert.ok(fs.existsSync(modelPath),'Нужна существующая модель; новая не скачивается');
const report={model:'Qwen3.5 4B Q4_K_M',pages:deepPages.length,queries:tests.length,runs:[]};
await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  report.loadMs=await ctx.evalMain(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule),service=req(${p('TranslationService')}),registry=req(${p('ModelRegistry')});
    registry.add({id:'package-qwen4b',label:'Qwen3.5 4B',filePath:${JSON.stringify(modelPath)},sizeBytes:${fs.statSync(modelPath).size},source:'legacy'});registry.setDefault('package-qwen4b');
    const {HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')}),{buildTextChunks}=req(${p('HistoryIndexer')});
    const history=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'ai-package.sqlite'))});await history.initialize();const keys=new Map();
    for(const page of ${JSON.stringify(deepPages)}){const url='https://package.test/article/'+page.key;history.recordVisit(url,page.title);const id=history.getIdByUrl(url);keys.set(id,page.key);
      history.saveContentChunks(id,buildTextChunks(page.text).map((text,chunkIndex)=>({chunkIndex,url,title:page.title,text,vector:new Float32Array(0),dims:0})),version);}
    const rank=service.rerankHistoryCandidates,expand=service.expandHistorySearchQuery;
    const state={history,keys,service,search:req(${p('HistorySearch')}),input:[],variants:[]};
    service.rerankHistoryCandidates=async(...args)=>{state.input=args[1];return rank(...args);};
    service.expandHistorySearchQuery=async(...args)=>{state.variants=await expand(...args);return state.variants;};globalThis.__packageAi=state;
    const t=performance.now();await service.ensureLoaded();return performance.now()-t;
  })()`,60000);
  console.log('Модель загружена: '+Math.round(report.loadMs)+' мс');
  for(const test of tests)for(const expand of [false,true]){
    const run=await ctx.evalMain(`(async()=>{const s=globalThis.__packageAi;s.input=[];s.variants=[];const t=performance.now();
      const response=await s.search.searchHistorySmart(s.history,${JSON.stringify(test.query)},8,{expand:${expand}});
      return {ms:performance.now()-t,variants:s.variants,candidates:s.input.map(c=>s.keys.get(c.id)),results:response.results.map(c=>s.keys.get(c.id)),degraded:response.degraded};})()`,60000);
    const acceptable=test.acceptable??(test.target?[test.target]:[]);
    Object.assign(run,{key:test.key,expand,target:test.target,candidateHit:acceptable.some(k=>run.candidates.includes(k)),hit:acceptable.some(k=>run.results.includes(k)),forbidden:run.results.filter(k=>(test.forbidden??[]).includes(k))});
    report.runs.push(run);console.log(`${test.key} ${expand?'расширение':'исходный'}: ${Math.round(run.ms)} мс, найдено=${run.hit}, кандидатов=${run.candidates.length}`);
  }
  await ctx.evalMain('globalThis.__packageAi.service.unloadModel()');
},{main:true});
report.summary=[false,true].map(expand=>{const runs=report.runs.filter(r=>r.expand===expand),positive=runs.filter(r=>r.target),times=runs.map(r=>r.ms).sort((a,b)=>a-b);
  return {expand,positive:positive.length,candidateHits:positive.filter(r=>r.candidateHit).length,hits:positive.filter(r=>r.hit).length,forbidden:runs.filter(r=>r.forbidden.length).length,negativeFalse:runs.filter(r=>!r.target&&r.results.length).length,medianMs:times[Math.floor(times.length/2)]};});
fs.writeFileSync('scripts/reports/history-package-ai.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));
