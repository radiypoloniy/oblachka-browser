// Сквозной опыт на временном профиле: контроль, расширение, квоты и структурированный реранк.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';
import {deepPages,deepCases} from './fixtures/history-semantic-deep.mjs';
import {mergeChainCandidates,chainExpansionPrompt,chainRerankPrompt,parseChainIndices} from './history-semantic-chain-policy.mjs';
const modes=['current','append-current','balanced-current','chain'];
if(process.argv.includes('--policy-check')){
  const candidates=Array.from({length:20},(_,id)=>({id,url:'https://policy.test/'+id}));
  const base={candidates,lexicalKeys:new Set(candidates.slice(0,8).map(c=>c.url))},extra={candidates:[{id:20,url:'https://policy.test/20'}]};
  const merged=mergeChainCandidates(base,[extra]);assert.equal(merged.length,20);assert.ok(merged.some(c=>c.id===20));
  assert.ok(candidates.slice(0,8).every(c=>merged.some(m=>m.id===c.id)));
  assert.equal(mergeChainCandidates({candidates:[],lexicalKeys:new Set()},[]).length,0);
  assert.equal(mergeChainCandidates({candidates:[candidates[0]],lexicalKeys:new Set()},[{candidates:[{...candidates[0],snippet:'Evidence'}]}])[0].snippet,'Evidence');
  assert.deepEqual(parseChainIndices('{"indices":[]}',0),[]);assert.deepEqual(parseChainIndices('{"indices":[1,0]}',2),[1,0]);
  for(const raw of ['{"indices":[2]}','{"indices":[-1]}','{"indices":[0,0]}','{"indices":[0.5]}','{"indices":["0"]}','{"indices":[],"extra":1}','Нет'])assert.throws(()=>parseChainIndices(raw,2));
  console.log('Chain policy checks passed');process.exit(0);
}
const tests=[...deepCases.map(test=>test.key==='battery'?{...test,acceptable:['battery','density','russian-short','english','english-short']}:test.key==='backup'?{...test,acceptable:['backup','version-good']}:test),
  {key:'heldout-windows',group:'heldout',query:'нужна инструкция по установке сетевого клиента для Windows',target:'windows',forbidden:['linux']},
  {key:'heldout-macos',group:'heldout-negative',query:'установка сетевого клиента только в macOS',target:null},
  {key:'heldout-french',group:'heldout-negative',query:'найди французскую заметку об уменьшении износа литиевого аккумулятора при зарядке',target:null},
  {key:'crowding',group:'boundary',query:'уличный гул гарнитура',target:'crowding-target',forbidden:[],special:'crowding'},
  {key:'lexical-refusal',group:'boundary-negative',query:'ресурс аккумулятора Honda Civic',target:null,special:'lexical'},
];
const output='scripts/reports/history-semantic-chain.json',summarize=process.argv.includes('--summarize');
const report=summarize?JSON.parse(fs.readFileSync(output,'utf8')):{measuredAt:new Date().toISOString(),model:'Qwen3.5 4B Q4_K_M',pages:deepPages.length,repeats:2,runs:[],expansions:[]};
if(!summarize)await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  const modelPath=path.join(process.env.APPDATA??'','oblako-browser/models/gguf/Qwen3.5-4B-Q4_K_M.gguf');assert.ok(fs.existsSync(modelPath));
  report.loadMs=await ctx.main.evaluate(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule),service=req(${p('TranslationService')}),registry=req(${p('ModelRegistry')});
    registry.add({id:'chain-qwen4b',label:'Qwen3.5 4B',filePath:${JSON.stringify(modelPath)},sizeBytes:${fs.statSync(modelPath).size},source:'legacy'});registry.setDefault('chain-qwen4b');
    const {HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')}),{buildTextChunks}=req(${p('HistoryIndexer')}),search=req(${p('HistorySearch')});
    const {normalizeForOmnibox:normalize}=req(${JSON.stringify(path.resolve('dist-electron/shared/frecency.js'))});
    const keys=new Map(),makeHistory=async name=>{const h=new HistoryManager(${JSON.stringify(ctx.profile)}+'/'+name+'.sqlite');await h.initialize();keys.set(h,new Map());return h;};
    const add=(history,key,title,text,index=true)=>{const url='https://chain.test/article/'+key;history.recordVisit(url,title);const id=history.getIdByUrl(url);keys.get(history).set(id,key);
      if(index&&!history.saveContentChunks(id,buildTextChunks(text).map((text,chunkIndex)=>({chunkIndex,url,title,text,vector:new Float32Array(0),dims:0})),version))throw Error('Save failed');};
    const history=await makeHistory('chain');for(const page of ${JSON.stringify(deepPages)}){
      // Сохраняем исходный шумовой URL, чтобы контроль совпадал с прежним корпусом.
      const url=page.url||'https://chain.test/article/'+page.key;history.recordVisit(url,page.title);const id=history.getIdByUrl(url);keys.get(history).set(id,page.key);
      if(!history.saveContentChunks(id,buildTextChunks(page.text).map((text,chunkIndex)=>({chunkIndex,url,title:page.title,text,vector:new Float32Array(0),dims:0})),version))throw Error('Save failed');
    }
    const crowded=await makeHistory('crowded');for(let i=0;i<8;i++)add(crowded,'lexical-'+i,'уличный гул гарнитура — обсуждение '+i,'',false);
    for(let i=0;i<12;i++)add(crowded,'noise-'+i,'Измерения городской акустики '+i,'Уличный гул гарнитура. Замеры акустики на улице.');
    add(crowded,'crowding-target','Заметки о звуке','Активное шумоподавление компенсирует внешний звук противофазой.');
    const lexical=await makeHistory('lexical');add(lexical,'lexical-refused','ресурс аккумулятора Honda Civic','Это каталог ссылок. Статья описывает Toyota Prius, но не ресурс аккумулятора Honda Civic. Данных для ответа о Honda Civic здесь нет.');
    globalThis.__chain={history,crowded,lexical,service,search,keys,normalize,
      merge:${mergeChainCandidates.toString()},expandPrompt:${chainExpansionPrompt.toString()},rankPrompt:${chainRerankPrompt.toString()},parse:${parseChainIndices.toString()}};
    const t=performance.now();await service.ensureLoaded();return performance.now()-t;
  })()`,60000);
  console.log('Model loaded: '+Math.round(report.loadMs)+' ms');
  try{
    for(let repeat=0;repeat<2;repeat++)for(const test of tests){
      const result=await ctx.main.evaluate(`(async()=>{
        const s=globalThis.__chain,test=${JSON.stringify(test)},repeat=${repeat},h=test.special==='crowding'?s.crowded:test.special==='lexical'?s.lexical:s.history,keys=s.keys.get(h);
        const t=performance.now(),base=await s.search.collectHistoryCandidateSetAsync(h,test.query),baseReadMs=performance.now()-t;
        const e=performance.now(),raw=await s.service.runTabOrganizePrompt(s.expandPrompt(test.query),{role:'search',schema:{type:'object',properties:{first:{type:'string'},second:{type:'string'}}},maxTokens:96});
        const expansionMs=performance.now()-e;let variants=[],expansionError=null;
        try{if(!raw.ok||raw.stopReason==='maxTokens')throw Error(raw.error??'Truncated expansion');const obj=JSON.parse(raw.out);variants=[obj.first,obj.second];
          if(variants.some(v=>typeof v!=='string'||v.length>80))throw Error('Invalid expansion');variants=[...new Set(variants.map(v=>v.trim()).filter(Boolean))];}
        catch(error){expansionError=String(error);variants=[];}
        const r=performance.now(),extras=[];for(const variant of variants)extras.push(await s.search.collectHistoryCandidateSetAsync(h,variant));const extraReadMs=performance.now()-r;
        const appended=new Map(base.candidates.map(c=>[s.normalize(c.url),c]));for(const extra of extras)for(const c of extra.candidates)if(!appended.has(s.normalize(c.url)))appended.set(s.normalize(c.url),c);
        const balanced=s.merge(base,extras,s.normalize),sets={current:base.candidates,'append-current':[...appended.values()].slice(0,20),'balanced-current':balanced,chain:balanced},runs=[];
        for(const mode of (repeat%2?${JSON.stringify([...modes].reverse())}:${JSON.stringify(modes)})){
          const candidates=sets[mode],started=performance.now();let chosen=[],error=null,degraded=false,rankRaw=null,fallback=false;
          try{
            if(mode==='chain'){
              if(candidates.length){rankRaw=await s.service.runTabOrganizePrompt(s.rankPrompt(test.query,candidates),{role:'search',schema:{type:'object',properties:{indices:{type:'array',items:{type:'integer'}}}},maxTokens:96});
                if(!rankRaw.ok||rankRaw.stopReason==='maxTokens')throw Error(rankRaw.error??'Truncated rerank');chosen=s.parse(rankRaw.out,candidates.length).map(i=>keys.get(candidates[i].id));}
            }else{const ranked=await s.search.rerankCollectedHistoryCandidates(test.query,{candidates,lexicalKeys:base.lexicalKeys});chosen=ranked.results.map(c=>keys.get(c.id));degraded=ranked.degraded;}
          }catch(e){error=String(e);fallback=true;const original=await s.search.rerankCollectedHistoryCandidates(test.query,base);chosen=original.results.map(c=>keys.get(c.id));degraded=true;}
          const rerankMs=performance.now()-started;
          runs.push({key:test.key,group:test.group,repeat,mode,target:test.target,acceptable:test.acceptable??(test.target?[test.target]:[]),forbidden:test.forbidden??[],
            candidates:candidates.map(c=>keys.get(c.id)),chosen,degraded,error,fallback,rankRaw,baseReadMs,expansionMs:mode==='current'?0:expansionMs,extraReadMs:mode==='current'?0:extraReadMs,rerankMs,
            totalMs:baseReadMs+(mode==='current'?0:expansionMs+extraReadMs)+rerankMs,evidence:candidates.map(c=>({key:keys.get(c.id),title:c.title,url:c.url,snippet:c.snippet}))});
        }
        return {runs,expansion:{key:test.key,repeat,variants,error:expansionError,raw,ms:expansionMs,extraReadMs,baseCount:base.candidates.length,extraKeys:extras.map(set=>set.candidates.map(c=>keys.get(c.id)))}};
      })()`,60000);
      report.runs.push(...result.runs);report.expansions.push(result.expansion);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
      console.log('repeat '+(repeat+1)+': '+test.key+' | '+result.runs.map(r=>r.mode+': '+(r.chosen.join(',')||'empty')+(r.error?' ERROR':'')).join(' | '));
    }
  }finally{await ctx.main.evaluate('globalThis.__chain.service.unloadModel()',30000);}
},{main:true});
assert.equal(report.runs.length,tests.length*2*modes.length);assert.equal(report.expansions.length,tests.length*2);
assert.ok(report.runs.every(r=>r.candidates.length<=20));
// Все варианты оцениваются по одинаковой разметке, включая несколько действительно подходящих страниц.
for(const run of report.runs){const test=tests.find(t=>t.key===run.key);run.acceptable=test.acceptable??(test.target?[test.target]:[]);}
const stats=xs=>{xs.sort((a,b)=>a-b);return {medianMs:xs[Math.floor(xs.length/2)],p95Ms:xs[Math.ceil(xs.length*.95)-1]};};
report.summary={};
for(const mode of modes){const runs=report.runs.filter(r=>r.mode===mode);report.summary[mode]={runs:runs.length,positiveRuns:runs.filter(r=>r.target).length,
  retrieved:runs.filter(r=>r.target&&r.candidates.some(k=>r.acceptable.includes(k))).length,selected:runs.filter(r=>r.target&&r.chosen.some(k=>r.acceptable.includes(k))).length,
  namedTargetSelected:runs.filter(r=>r.target&&r.chosen.includes(r.target)).length,
  violationRuns:runs.filter(r=>r.chosen.some(k=>r.forbidden.includes(k))).length,negativeRuns:runs.filter(r=>!r.target).length,negativeFalseHits:runs.filter(r=>!r.target&&r.chosen.length).length,
  invalidReranks:runs.filter(r=>r.error).length,degraded:runs.filter(r=>r.degraded).length,total:stats(runs.map(r=>r.totalMs)),rerank:stats(runs.map(r=>r.rerankMs))};}
report.expansionStats={invalid:report.expansions.filter(r=>r.error).length,timing:stats(report.expansions.map(r=>r.ms))};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
