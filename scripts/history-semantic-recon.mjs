// Разведка, не новая ветка продукта: один фиксированный промпт, реальная Qwen, временный профиль.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';
import {reconPages,reconCases} from './fixtures/history-semantic-recon.mjs';
const modelPath=path.join(process.env.APPDATA ?? '','oblako-browser/models/gguf/Qwen3.5-4B-Q4_K_M.gguf');
if(!fs.existsSync(modelPath))throw Error('Installed reconnaissance model missing');
const report={measuredAt:new Date().toISOString(),model:'Qwen3.5 4B Q4_K_M',pages:reconPages.length,queries:reconCases.length,repeats:2};
function addConstraintMetrics(report){
  for(const run of report.runs){
    const test=reconCases.find(test=>test.key===run.key);
    run.baselineConstraintViolations=run.baselineChosen.filter(key=>test.forbidden?.includes(key));
    run.constraintViolations=run.chosen.filter(key=>test.forbidden?.includes(key));
  }
  report.summary.baselineConstraintViolationRuns=report.runs.filter(run=>run.baselineConstraintViolations.length).length;
  report.summary.expandedConstraintViolationRuns=report.runs.filter(run=>run.constraintViolations.length).length;
}
if(process.argv.includes('--summarize')){
  const saved=JSON.parse(fs.readFileSync('scripts/reports/history-semantic-recon.json','utf8'));
  addConstraintMetrics(saved);
  fs.writeFileSync('scripts/reports/history-semantic-recon.json',JSON.stringify(saved,null,2)+'\n');
  console.log(JSON.stringify(saved.summary));process.exit(0);
}
await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  Object.assign(report,await ctx.main.evaluate(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule), registry=req(${p('ModelRegistry')}),service=req(${p('TranslationService')});
    registry.add({id:'recon-qwen4b',label:'Qwen3.5 4B',filePath:${JSON.stringify(modelPath)},sizeBytes:${fs.statSync(modelPath).size},source:'legacy'});
    registry.setDefault('recon-qwen4b');
    const {HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')});
    const {buildTextChunks}=req(${p('HistoryIndexer')}),search=req(${p('HistorySearch')});
    const history=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'semantic-recon.sqlite'))});await history.initialize();
    const ids=new Map(),keys=new Map();
    for(const page of ${JSON.stringify(reconPages)}){
      const url=page.url || 'https://quality.test/article/'+page.key;history.recordVisit(url,page.title);
      const id=history.getIdByUrl(url);ids.set(page.key,id);keys.set(id,page.key);
      if(!history.saveContentChunks(id,buildTextChunks(page.text).map((text,chunkIndex)=>({chunkIndex,url,title:page.title,text,vector:new Float32Array(0),dims:0})),version))throw Error('Save failed');
    }
    const rssBeforeLoad=process.memoryUsage().rss,started=performance.now();await service.ensureLoaded();const loadMs=performance.now()-started;
    const runs=[],schema={type:'object',properties:{first:{type:'string'},second:{type:'string'}}};
    const prompt=q=>'Ты формулируешь поисковые запросы к уже прочитанным статьям. Не отвечай на вопрос и не придумывай страницы. '+
      'Верни JSON с first и second: две короткие поисковые формулировки по 2-4 значимых слова, максимум 80 символов каждая. '+
      'Первая — общепринятый термин для описанного явления, вторая — другая формулировка того же смысла. '+
      'Для явно английского материала используй английские термины. Сохрани номера, имена, бренды и ограничения; не расширяй до соседней темы. '+
      'Если смысл неясен, верни пустые строки. Пользователь ищет: '+JSON.stringify(q);
    try{
      for(let repeat=0;repeat<2;repeat++)for(const test of ${JSON.stringify(reconCases)}){
        const base=await search.collectHistoryCandidateSetAsync(history,test.query);
        const beforeStart=performance.now(),before=await search.rerankCollectedHistoryCandidates(test.query,base);
        const baselineMs=performance.now()-beforeStart,t=performance.now();
        const expanded=await service.runTabOrganizePrompt(prompt(test.query),{role:'search',schema,maxTokens:96});
        const expansionMs=performance.now()-t;
        let variants=[],parseError=null;
        try{
          if(!expanded.ok)throw Error(expanded.error);
          if(expanded.stopReason==='maxTokens')throw Error('Truncated output');
          const parsed=JSON.parse(expanded.out);
          variants=[parsed.first,parsed.second];
          if(variants.some(v=>typeof v!=='string' || v.length>80))throw Error('Invalid variant');
          variants=[...new Set(variants.map(v=>v.trim()).filter(Boolean))].slice(0,2);
        }catch(e){parseError=String(e);variants=[];}
        const merge=new Map(base.candidates.map(c=>[c.url,c]));
        const retrievalStart=performance.now();
        for(const variant of variants){
          const extra=await search.collectHistoryCandidateSetAsync(history,variant);
          for(const c of extra.candidates)if(!merge.has(c.url))merge.set(c.url,c);
        }
        const collected={candidates:[...merge.values()].slice(0,20),lexicalKeys:base.lexicalKeys};
        const extraRetrievalMs=performance.now()-retrievalStart,rankStart=performance.now();
        const after=await search.rerankCollectedHistoryCandidates(test.query,collected);
        const rerankMs=performance.now()-rankStart,chosen=after.results.map(c=>keys.get(c.id));
        const target=ids.get(test.target);
        runs.push({repeat,key:test.key,query:test.query,target:test.target,control:!!test.control,variants,parseError,
          baselineCandidates:base.candidates.map(c=>keys.get(c.id)),baselineChosen:before.results.map(c=>keys.get(c.id)),baselineDegraded:before.degraded,baselineMs,
          expandedCandidates:collected.candidates.map(c=>keys.get(c.id)),chosen,degraded:after.degraded,
          retrieved:target!=null && collected.candidates.some(c=>c.id===target),selected:test.target!=null && chosen.includes(test.target),
          expansionMs,extraRetrievalMs,rerankMs,additionalCandidateReads:variants.length,rawExpansion:expanded});
      }
    }finally{await service.unloadModel();}
    return {loadMs,rssBeforeLoad,runs};
  })()`,180000));
  report.diagnostic=ctx.appLog.join('').slice(-8000);
},{main:true});
assert.equal(report.runs.length,reconCases.length*2);
const positive=report.runs.filter(r=>r.target),negative=report.runs.filter(r=>!r.target);
const stats=xs=>{xs.sort((a,b)=>a-b);return {medianMs:xs[Math.floor(xs.length/2)],p95Ms:xs[Math.ceil(xs.length*.95)-1]};};
report.summary={positiveRuns:positive.length,baselineRetrieved:positive.filter(r=>r.baselineCandidates.includes(r.target)).length,
  expandedRetrieved:positive.filter(r=>r.retrieved).length,baselineSelected:positive.filter(r=>r.baselineChosen.includes(r.target)).length,
  expandedSelected:positive.filter(r=>r.selected).length,negativeRuns:negative.length,
  baselineNegativeFalseHits:negative.filter(r=>r.baselineChosen.length).length,expandedNegativeFalseHits:negative.filter(r=>r.chosen.length).length,
  invalidExpansions:report.runs.filter(r=>r.parseError).length,degradedReranks:report.runs.filter(r=>r.degraded).length,
  expansion:stats(report.runs.map(r=>r.expansionMs)),extraRetrieval:stats(report.runs.map(r=>r.extraRetrievalMs))};
addConstraintMetrics(report);
fs.writeFileSync('scripts/reports/history-semantic-recon.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({loadMs:report.loadMs,summary:report.summary}));
