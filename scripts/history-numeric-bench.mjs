// Настоящие FTS и читающий воркер, только временная база; модель подменена для проверки контекста.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';
import {numericPages,numericCases} from './fixtures/history-numeric.mjs';
const after=process.argv.includes('--after'),check=process.argv.includes('--check');
const report={measuredAt:new Date().toISOString()};
await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  Object.assign(report,await ctx.evalMain(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule), assert=req('node:assert/strict');
    const {HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')});
    const {buildTextChunks}=req(${p('HistoryIndexer')});
    const search=req(${p('HistorySearch')}), reader=req(${p('HistoryReader')}), service=req(${p('TranslationService')});
    const {buildFtsQuery}=req(${p('HistoryReadQueries')});
    const history=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'numeric.sqlite'))});await history.initialize();
    const keys=new Map();
    for(const page of ${JSON.stringify(numericPages)}){
      const url='https://numeric.test/article/'+page.key,title='Контрольный справочник '+page.key;
      history.recordVisit(url,title);const id=history.getIdByUrl(url);keys.set(id,page.key);
      assert.ok(history.saveContentChunks(id,buildTextChunks(page.text).map((text,chunkIndex)=>({chunkIndex,url,title,text,vector:new Float32Array(0),dims:0})),version));
    }
    const originalRead=reader.readHistory;let reads=0,calls=0,modelQuery=null,input=[];
    reader.readHistory=async(h,r)=>{if(h===history && r.kind==='candidates')reads++;return originalRead(h,r);};
    service.rerankHistoryCandidates=async(q,rows)=>{calls++;modelQuery=q;input=rows;return rows.map((_,i)=>i);};
    const cases=[];
    for(const test of ${JSON.stringify(numericCases)}){
      reads=0;calls=0;modelQuery=null;input=[];
      const collected=await search.collectHistoryCandidateSetAsync(history,test.query);
      assert.deepEqual(collected,search.collectHistoryCandidateSet(history,test.query));
      await search.rerankCollectedHistoryCandidates(test.query,collected);
      const page=${JSON.stringify(numericPages)}.find(p=>p.key===test.evidence);
      const snippet=input.find(c=>keys.get(c.id)===test.evidence)?.snippet || '';
      cases.push({key:test.key,query:test.query,match:buildFtsQuery(test.query),keys:collected.candidates.map(c=>keys.get(c.id)),
        visibleEvidence:!!page?.evidence && snippet.includes(page.evidence),snippet,reads,calls,modelQuery});
      assert.equal(reads,1);assert.ok(calls<=1);if(calls)assert.equal(modelQuery,test.query);
      assert.ok(collected.candidates.length<=20);
    }
    return {cases};
  })()`));
},{main:true});
if(after || check){
  const before=JSON.parse(fs.readFileSync('scripts/reports/history-numeric-before.json','utf8'));
  for(const test of numericCases){
    const actual=report.cases.find(c=>c.key===test.key);
    assert.deepEqual([...actual.keys].sort(),[...test.expected].sort(),test.key);
    if(test.evidence)assert.equal(actual.visibleEvidence,true,test.key);
    if(test.unchanged)assert.deepEqual(actual.keys,before.cases.find(c=>c.key===test.key).keys,test.key);
  }
}
report.summary={queries:report.cases.length,exactCandidateSets:report.cases.filter(c=>{
  const test=numericCases.find(t=>t.key===c.key);return JSON.stringify([...c.keys].sort())===JSON.stringify([...test.expected].sort());
}).length};
if(!check)fs.writeFileSync(`scripts/reports/history-numeric-${after?'after':'before'}.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));
