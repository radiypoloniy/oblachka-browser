// Проверка доступности доказательства для AI, не оценка релевантности настоящей модели.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';
import {qualityPages,qualityQueries} from './fixtures/history-search-quality.mjs';

const check=process.argv.includes('--check');
const after=process.argv.includes('--after') || check;
const report={measuredAt:new Date().toISOString(),cases:[]};
await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  const result=await ctx.evalMain(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule);
    const {HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')});
    const {buildTextChunks}=req(${p('HistoryIndexer')});
    const search=req(${p('HistorySearch')});
    const service=req(${p('TranslationService')});
    const history=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'quality.sqlite'))});await history.initialize();
    const stored=new Map(), ids=new Map();
    for(const page of ${JSON.stringify(qualityPages)}){
      const url=page.url || 'https://quality.test/article/'+page.key;
      history.recordVisit(url,page.title); const id=history.getIdByUrl(url);
      const texts=buildTextChunks(page.text); stored.set(page.key,texts);ids.set(page.key,id);
      if(!history.saveContentChunks(id,texts.map((text,chunkIndex)=>({chunkIndex,url,title:page.title,text,vector:new Float32Array(0),dims:0})),version))throw Error('Save failed');
    }
    const cases=[];let modelInput;
    service.rerankHistoryCandidates=async(_q,candidates)=>{modelInput=candidates;return candidates.map((_,i)=>i);};
    for(const test of ${JSON.stringify(qualityQueries)}){
      const collected=await search.collectHistoryCandidateSetAsync(history,test.query);
      const sync=search.collectHistoryCandidateSet(history,test.query);
      req('node:assert/strict').deepEqual(collected,sync);
      await search.rerankCollectedHistoryCandidates(test.query,collected);
      const target=collected.candidates.find(c=>c.id===ids.get(test.target));
      // TranslationService ограничивает фрагмент 240 символами перед отправкой Qwen.
      const presented=modelInput?.find(c=>c.id===ids.get(test.target))?.snippet?.slice(0,240) || '';
      cases.push({key:test.key,query:test.query,target:test.target,indexedEvidence:!!test.evidence && stored.get(test.target)?.some(t=>t.includes(test.evidence)) || false,
        retrieved:!!target,visibleEvidence:!!test.evidence && presented.includes(test.evidence),presented,
        candidates:collected.candidates.map(({snippet,...rest})=>rest),lexicalKeys:[...collected.lexicalKeys]});
      modelInput=undefined;
    }
    // Изолируем подготовку фрагментов от SQL: самый тяжёлый штатный бюджет, 12 чанков.
    const fts=history.searchContentChunksFts('охлаждение батарей',version,96);
    const rows=Array.from({length:12},(_,i)=>({...fts.find(c=>c.historyId===ids.get('density')),historyId:100+i,url:'https://quality.test/load/'+i}));
    const synthetic={searchContentChunksFts:()=>rows,search:()=>[]};
    const samples=[];
    for(let i=0;i<120;i++){const t=performance.now();search.collectHistoryCandidateSet(synthetic,'охлаждение батарей');if(i>=20)samples.push(performance.now()-t);}
    let preparedMergeMs,wire;
    if(${after}){
      const {prepareHistoryCandidateChunks}=req(${p('HistorySearchSnippet')});
      const prepared=prepareHistoryCandidateChunks(rows,'охлаждение батарей');
      const mergeSamples=[];
      const ready={searchContentChunksFts:()=>prepared,search:()=>[]};
      for(let i=0;i<120;i++){const t=performance.now();search.collectHistoryCandidateSet(ready,'охлаждение батарей');if(i>=20)mergeSamples.push(performance.now()-t);}
      preparedMergeMs=mergeSamples;
      const repeated=rows.flatMap(c=>Array.from({length:8},()=>c));
      const compactRows=prepareHistoryCandidateChunks(repeated,'охлаждение батарей');
      wire={oldChunks:repeated.length,newChunks:compactRows.length,oldBytes:Buffer.byteLength(JSON.stringify(repeated)),newBytes:Buffer.byteLength(JSON.stringify(compactRows))};
    }
    return {cases,preparationMs:samples,preparedMergeMs,wire,versions:process.versions};
  })()`);
  Object.assign(report,result);
},{main:true});
for(const test of qualityQueries){
  const actual=report.cases.find(c=>c.key===test.key);
  assert.equal(actual.retrieved,test.retrieved,`${test.key}: retrieval changed`);
  if(test.target && test.retrieved && test.evidence)assert.equal(actual.indexedEvidence,true,`${test.key}: text missing from index`);
  if(test.target===null)assert.equal(actual.candidates.length,0);
}
if(after){
  const before=JSON.parse(fs.readFileSync('scripts/reports/history-search-quality-before.json','utf8'));
  for(const actual of report.cases){
    const old=before.cases.find(c=>c.key===actual.key);
    // Визиты создаются настоящим recordVisit: их время отличается между запусками стенда.
    const identity=rows=>rows.map(({lastVisit,...candidate})=>candidate);
    assert.deepEqual(identity(actual.candidates),identity(old.candidates),`${actual.key}: candidate set/order changed`);
    assert.deepEqual(actual.lexicalKeys,old.lexicalKeys);
    if(old.visibleEvidence)assert.equal(actual.visibleEvidence,true,`${actual.key}: evidence regressed`);
  }
}
const eligible=report.cases.filter(c=>c.target && c.retrieved && c.indexedEvidence);
report.summary={queries:report.cases.length,evidenceQueries:eligible.length,visibleEvidence:eligible.filter(c=>c.visibleEvidence).length};
if(after)assert.equal(report.summary.visibleEvidence,report.summary.evidenceQueries,'visible evidence missing');
const sorted=[...report.preparationMs].sort((a,b)=>a-b);
report.preparation={medianMs:sorted[50],p95Ms:sorted[94]};
if(report.preparedMergeMs){const a=[...report.preparedMergeMs].sort((x,y)=>x-y);report.mainMerge={medianMs:a[50],p95Ms:a[94]};}
if(!check)fs.writeFileSync(`scripts/reports/history-search-quality-${after?'after':'before'}.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary:report.summary,preparation:report.preparation,mainMerge:report.mainMerge,wire:report.wire}));
