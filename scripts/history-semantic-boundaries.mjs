// Граничные проверки без инференса: настоящий SQLite/worker, ограниченный бюджет кандидатов.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';
let report;
await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  report=await ctx.main.evaluate(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule),{HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')});
    const {buildTextChunks}=req(${p('HistoryIndexer')}),search=req(${p('HistorySearch')}),service=req(${p('TranslationService')});
    const history=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'boundaries.sqlite'))});await history.initialize();
    const add=(key,title,text,index=true)=>{const url='https://boundary.test/article/'+key;history.recordVisit(url,title);const id=history.getIdByUrl(url);
      if(index&&!history.saveContentChunks(id,buildTextChunks(text).map((text,chunkIndex)=>({chunkIndex,url,title,text,vector:new Float32Array(0),dims:0})),version))throw Error('Save failed');return id;};
    const query='уличный гул гарнитура';
    // Лексические страницы без чанков: посещение записано, извлечение пока не состоялось.
    for(let i=0;i<8;i++)add('lexical-'+i,query+' — обсуждение '+i,'',false);
    for(let i=0;i<12;i++)add('fts-'+i,'Измерения городской акустики '+i,'Уличный гул гарнитура. Замеры акустики на улице.');
    const target=add('target','Заметки о звуке','Активное шумоподавление компенсирует внешний звук противофазой.');
    const base=await search.collectHistoryCandidateSetAsync(history,query),extra=await search.collectHistoryCandidateSetAsync(history,'активное шумоподавление');
    const merged=new Map(base.candidates.map(c=>[c.url,c]));for(const c of extra.candidates)if(!merged.has(c.url))merged.set(c.url,c);
    const bounded=[...merged.values()].slice(0,20);
    const tailMarker='квазикристаллическая телеметрия',source='Обычные наблюдения за погодой и условиями путешествия. '.repeat(300)+tailMarker;
    const chunks=buildTextChunks(source);add('tail','Большой справочник путешественника',source);
    const tailCandidates=await search.collectHistoryCandidateSetAsync(history,tailMarker);
    const refusedQuery='ресурс аккумулятора Honda Civic';add('lexical-refused',refusedQuery,'Материал обсуждает Toyota Prius. Сведений о ресурсе Honda Civic здесь нет.');
    const collected=await search.collectHistoryCandidateSetAsync(history,refusedQuery),saved=service.rerankHistoryCandidates;
    // Подмена только в временном процессе изолирует политику fallback от качества модели.
    let fallback;try{service.rerankHistoryCandidates=async()=>[];fallback=await search.rerankCollectedHistoryCandidates(refusedQuery,collected);}finally{service.rerankHistoryCandidates=saved;}
    return {measuredAt:new Date().toISOString(),crowding:{baseCount:base.candidates.length,extraContainsTarget:extra.candidates.some(c=>c.id===target),mergedCount:merged.size,boundedCount:bounded.length,boundedContainsTarget:bounded.some(c=>c.id===target)},
      tail:{sourceChars:source.length,markerOffset:source.indexOf(tailMarker),chunks:chunks.length,storedContainsMarker:chunks.some(c=>c.includes(tailMarker)),candidateCount:tailCandidates.candidates.length},
      emptyRerankFallback:{stubbed:true,candidates:collected.candidates.length,chosen:fallback.results.map(c=>c.url),degraded:fallback.degraded}};
  })()`,30000);
},{main:true});
assert.equal(report.crowding.baseCount,20);assert.equal(report.crowding.extraContainsTarget,true);assert.equal(report.crowding.boundedContainsTarget,false);
assert.equal(report.tail.storedContainsMarker,false);assert.equal(report.tail.candidateCount,0);
assert.ok(report.emptyRerankFallback.chosen.some(url=>url.endsWith('/lexical-refused')));assert.equal(report.emptyRerankFallback.degraded,false);
fs.writeFileSync('scripts/reports/history-semantic-boundaries.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
