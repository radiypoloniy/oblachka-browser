import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';
import {qualityPages} from './fixtures/history-search-quality.mjs';
import {intentCases} from './fixtures/history-query-intent.mjs';
const after=process.argv.includes('--after'),check=process.argv.includes('--check');
const report={measuredAt:new Date().toISOString(),cases:[]};
await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  const result=await ctx.evalMain(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule);
    const {HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')});
    const {buildTextChunks}=req(${p('HistoryIndexer')});
    const search=req(${p('HistorySearch')}),reader=req(${p('HistoryReader')}),queries=req(${p('HistoryReadQueries')});
    const service=req(${p('TranslationService')});
    const history=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'intent.sqlite'))});await history.initialize();
    const ids=new Map();
    for(const page of ${JSON.stringify(qualityPages)}){
      const url=page.url || 'https://quality.test/article/'+page.key;history.recordVisit(url,page.title);
      const id=history.getIdByUrl(url);ids.set(page.key,id);
      history.saveContentChunks(id,buildTextChunks(page.text).map((text,chunkIndex)=>({chunkIndex,url,title:page.title,text,vector:new Float32Array(0),dims:0})),version);
    }
    const cases=[];let calls=0,lastQuery,reads=0;
    const originalRead=reader.readHistory;
    reader.readHistory=async(h,r)=>{if(h===history && r.kind==='candidates')reads++;return originalRead(h,r);};
    service.rerankHistoryCandidates=async(q,rows)=>{calls++;lastQuery=q;return rows.map((_,i)=>i);};
    for(const test of ${JSON.stringify(intentCases)}){
      calls=0;lastQuery=null;reads=0;
      const start=performance.now(), collected=await search.collectHistoryCandidateSetAsync(history,test.query);
      const preparationMs=performance.now()-start;
      req('node:assert/strict').deepEqual(collected,search.collectHistoryCandidateSet(history,test.query));
      await search.rerankCollectedHistoryCandidates(test.query,collected);
      const candidateReads=reads;
      const target=collected.candidates.find(c=>c.id===ids.get(test.target));
      const rows=await reader.readHistory(history,{kind:'candidates',query:test.query,version,lexicalLimit:8,ftsLimit:96});
      cases.push({key:test.key,query:test.query,target:test.target,retrieved:!!target,visibleEvidence:!!test.evidence && !!target?.snippet?.slice(0,240).includes(test.evidence),
        candidates:collected.candidates.map(c=>({id:c.id,url:c.url})),candidateReads,modelCalls:calls,modelQuery:lastQuery,preparationMs,workerChunks:rows.chunks.length,originalMatch:queries.buildFtsQuery(test.query)});
    }
    let topicPreparation;
    if(${after || check}){
      const {historySearchTopic}=req(${p('HistorySearchTopic')});
      const times=[];
      for(let i=0;i<1200;i++){const t=performance.now();historySearchTopic(${JSON.stringify(intentCases[0].query)});if(i>=200)times.push(performance.now()-t);}
      times.sort((a,b)=>a-b);topicPreparation={medianMs:times[500],p95Ms:times[949]};
    }
    return {cases,topicPreparation};
  })()`);
  Object.assign(report,result);
},{main:true});
if(after || check){
  for(const test of intentCases){
    const c=report.cases.find(c=>c.key===test.key);
    assert.equal(c.retrieved,test.target!==null,test.key);
    if(test.evidence)assert.equal(c.visibleEvidence,true,test.key);
    if(test.target===null)assert.equal(c.candidates.length,0);
    assert.ok(c.modelCalls<=1);
    assert.equal(c.candidateReads,1);
    if(c.modelCalls)assert.equal(c.modelQuery,test.query);
    assert.ok(c.workerChunks<=12);
  }
}
report.summary={queries:report.cases.length,positive:report.cases.filter(c=>c.target).length,retrieved:report.cases.filter(c=>c.target && c.retrieved).length,visibleEvidence:report.cases.filter(c=>c.target && c.visibleEvidence).length};
if(!check)fs.writeFileSync(`scripts/reports/history-query-intent-${after?'after':'before'}.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary:report.summary,topicPreparation:report.topicPreparation}));
