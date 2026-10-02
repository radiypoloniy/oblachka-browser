// Изолируем распределение мест от ошибок генерации: дополнительный термин здесь задан явно.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';
import {mergeChainCandidates} from './history-semantic-chain-policy.mjs';
let report;
await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  report=await ctx.main.evaluate(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule),{HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')});
    const {buildTextChunks}=req(${p('HistoryIndexer')}),search=req(${p('HistorySearch')});
    const {normalizeForOmnibox:normalize}=req(${JSON.stringify(path.resolve('dist-electron/shared/frecency.js'))});
    const history=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'allocation.sqlite'))});await history.initialize();
    const add=(key,title,text,index=true)=>{const url='https://allocation.test/article/'+key;history.recordVisit(url,title);const id=history.getIdByUrl(url);
      if(index&&!history.saveContentChunks(id,buildTextChunks(text).map((text,chunkIndex)=>({chunkIndex,url,title,text,vector:new Float32Array(0),dims:0})),version))throw Error('Save failed');return id;};
    for(let i=0;i<8;i++)add('lexical-'+i,'уличный гул гарнитура — обсуждение '+i,'',false);
    for(let i=0;i<12;i++)add('noise-'+i,'Измерения городской акустики '+i,'Уличный гул гарнитура. Замеры акустики на улице.');
    const target=add('target','Заметки о звуке','Активное шумоподавление компенсирует внешний звук противофазой.');
    const base=await search.collectHistoryCandidateSetAsync(history,'уличный гул гарнитура'),extra=await search.collectHistoryCandidateSetAsync(history,'активное шумоподавление');
    const append=new Map(base.candidates.map(c=>[normalize(c.url),c]));for(const c of extra.candidates)if(!append.has(normalize(c.url)))append.set(normalize(c.url),c);
    const merge=${mergeChainCandidates.toString()},balanced=merge(base,[extra],normalize);
    return {measuredAt:new Date().toISOString(),fixedAdditionalQuery:true,baseCount:base.candidates.length,extraContainsTarget:extra.candidates.some(c=>c.id===target),
      appendedContainsTarget:[...append.values()].slice(0,20).some(c=>c.id===target),balancedContainsTarget:balanced.some(c=>c.id===target),balancedCount:balanced.length,
      preservedLexical:[...base.lexicalKeys].filter(key=>balanced.some(c=>normalize(c.url)===key)).length,lexicalCount:base.lexicalKeys.size};
  })()`,30000);
},{main:true});
assert.equal(report.baseCount,20);assert.equal(report.extraContainsTarget,true);assert.equal(report.appendedContainsTarget,false);
assert.equal(report.balancedContainsTarget,true);assert.equal(report.balancedCount,20);assert.equal(report.preservedLexical,report.lexicalCount);
fs.writeFileSync('scripts/reports/history-semantic-chain-allocation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
