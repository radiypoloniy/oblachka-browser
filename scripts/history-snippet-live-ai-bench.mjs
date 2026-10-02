// Настоящая установленная Qwen читает GGUF; все данные/настройки стенда — в одноразовом профиле.
import fs from 'node:fs';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';
import {qualityPages,qualityQueries} from './fixtures/history-search-quality.mjs';
const modelPath=path.join(process.env.APPDATA ?? '','oblako-browser/models/gguf/Qwen3.5-4B-Q4_K_M.gguf');
if(!fs.existsSync(modelPath))throw Error('Installed benchmark model missing');
const report={measuredAt:new Date().toISOString(),model:'Qwen3.5 4B Q4_K_M',runs:[]};
await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  const tests=qualityQueries.filter(c=>['battery-phrase','dns-phrase','camera-phrase'].includes(c.key));
  const result=await ctx.main.evaluate(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule),registry=req(${p('ModelRegistry')}),service=req(${p('TranslationService')});
    registry.add({id:'quality-qwen4b',label:'Qwen3.5 4B',filePath:${JSON.stringify(modelPath)},sizeBytes:${fs.statSync(modelPath).size},source:'legacy'});
    registry.setDefault('quality-qwen4b');
    const {HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')});
    const {buildTextChunks}=req(${p('HistoryIndexer')}),search=req(${p('HistorySearch')});
    const history=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'live-quality.sqlite'))});await history.initialize();
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
        const collected=await search.collectHistoryCandidateSetAsync(history,test.query);
        const raw=history.searchContentChunksFts(test.query,version,96);
        for(const variant of index%2?['after','before']:['before','after']){
          const candidates=collected.candidates.map(c=>{
            if(variant==='after' || !c.snippet)return c;
            const text=raw.find(chunk=>chunk.historyId===c.id)?.text;
            const compact=text?.replace(/\\s+/g,' ').trim();
            return compact?{...c,snippet:compact.length<=360?compact:compact.slice(0,360).trim()+'...'}:c;
          });
          const started=performance.now();
          try{
            const order=await service.rerankHistoryCandidates(test.query,candidates);
            const chosen=order.map(i=>candidates[i].id),position=chosen.indexOf(ids.get(test.target));
            runs.push({key:test.key,variant,ms:performance.now()-started,chosen,targetRank:position<0?null:position+1,valid:true});
          }catch(error){runs.push({key:test.key,variant,ms:performance.now()-started,valid:false,error:String(error.message)});}
        }
      }
    }finally{await service.unloadModel();}
    return {loadMs,runs};
  })()`,180000);
  Object.assign(report,result);
  report.diagnostic=ctx.appLog.join('').slice(-4500);
},{main:true});
fs.writeFileSync('scripts/reports/history-snippet-live-ai.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({loadMs:report.loadMs,runs:report.runs}));
