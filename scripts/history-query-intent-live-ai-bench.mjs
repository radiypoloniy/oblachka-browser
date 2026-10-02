// Исходное и новое извлечение кандидатов; тот же реранкер и GGUF, временный профиль.
import fs from 'node:fs';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';
import {qualityPages} from './fixtures/history-search-quality.mjs';
import {intentCases} from './fixtures/history-query-intent.mjs';
const modelPath=path.join(process.env.APPDATA ?? '','oblako-browser/models/gguf/Qwen3.5-4B-Q4_K_M.gguf');
if(!fs.existsSync(modelPath))throw Error('Installed benchmark model missing');
const report={measuredAt:new Date().toISOString(),model:'Qwen3.5 4B Q4_K_M',runs:[]};
await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  const tests=intentCases.filter(c=>['battery','dns','backup','missing'].includes(c.key));
  const result=await ctx.main.evaluate(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule),registry=req(${p('ModelRegistry')}),service=req(${p('TranslationService')});
    registry.add({id:'intent-qwen4b',label:'Qwen3.5 4B',filePath:${JSON.stringify(modelPath)},sizeBytes:${fs.statSync(modelPath).size},source:'legacy'});
    registry.setDefault('intent-qwen4b');
    const {HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')});
    const {buildTextChunks}=req(${p('HistoryIndexer')}),search=req(${p('HistorySearch')});
    const topic=req(${p('HistorySearchTopic')}),originalTopic=topic.historySearchTopic;
    const history=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'live-intent.sqlite'))});await history.initialize();
    const ids=new Map();
    for(const page of ${JSON.stringify(qualityPages)}){
      const url=page.url || 'https://quality.test/article/'+page.key;history.recordVisit(url,page.title);
      const id=history.getIdByUrl(url);ids.set(page.key,id);
      history.saveContentChunks(id,buildTextChunks(page.text).map((text,chunkIndex)=>({chunkIndex,url,title:page.title,text,vector:new Float32Array(0),dims:0})),version);
    }
    const loadStart=performance.now();await service.ensureLoaded();const loadMs=performance.now()-loadStart;
    const runs=[];
    try{
      for(const [index,test] of ${JSON.stringify(tests)}.entries()){
        let before;
        // До правки FTS и фрагмент получали полный вопрос; это единственная отключаемая часть.
        try{topic.historySearchTopic=q=>q.trim();before=search.collectHistoryCandidateSet(history,test.query);}
        finally{topic.historySearchTopic=originalTopic;}
        const after=await search.collectHistoryCandidateSetAsync(history,test.query);
        for(const variant of index%2?['after','before']:['before','after']){
          const collected=variant==='before'?before:after,started=performance.now();
          const response=await search.rerankCollectedHistoryCandidates(test.query,collected);
          const chosen=response.results.map(c=>c.id),position=chosen.indexOf(ids.get(test.target));
          runs.push({key:test.key,variant,candidates:collected.candidates.map(c=>c.id),chosen,targetRank:position<0?null:position+1,degraded:response.degraded,ms:performance.now()-started});
        }
      }
    }finally{topic.historySearchTopic=originalTopic;await service.unloadModel();}
    return {loadMs,runs};
  })()`,180000);
  Object.assign(report,result);report.diagnostic=ctx.appLog.join('').slice(-4500);
},{main:true});
fs.writeFileSync('scripts/reports/history-query-intent-live-ai.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({loadMs:report.loadMs,runs:report.runs}));
