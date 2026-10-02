// Контракт выдачи и повторных обращений проверяется без модели и без профиля пользователя.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

function load(name, mocks) {
  const filename = path.resolve(`dist-electron/electron/${name}.js`);
  const native = createRequire(filename), module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename,'utf8')}\n})`,{filename})(
    id => Object.hasOwn(mocks,id) ? mocks[id] : native(id), module, module.exports);
  return module.exports;
}
let mode = 'ranked', reranks = 0, lastCandidates, resolveRank, releaseRead;
let delayedRead = false;
const service = {
  isModelWarm: () => mode !== 'cold',
  rerankHistoryCandidates: async (_q, candidates) => {
    reranks++; lastCandidates = candidates;
    if (mode === 'failed') throw Error('synthetic failure');
    if (mode === 'pending') return new Promise(resolve => { resolveRank = resolve; });
    return mode === 'ranked' ? [1,0] : [];
  },
};
const search = load('HistorySearch', {
  './HistoryManager': { TEXT_EXTRACTION_VERSION:'test' }, './TranslationService':service,
  './HistoryReader': { readHistory: async (h,r) => {
    if (delayedRead) await new Promise(resolve => { releaseRead=resolve; });
    return {chunks:h.searchContentChunksFts(r.query,r.version,r.ftsLimit),lexical:h.search(r.query,r.lexicalLimit)};
  } },
});
const related = load('RelatedHistory', { './HistorySearch':search,'./TranslationService':service });
const entries = Array.from({length:20},(_,i)=>({id:i+1,url:`https://bench.test/article/${i}`,title:`Квантовые вычисления ${i}`,lastVisit:1000-i,visitCount:1}));
const chunks = [...Array.from({length:8},(_,i)=>({historyId:1,chunkIndex:i,url:entries[0].url,title:entries[0].title,text:'Квантовые вычисления',lastVisit:1000,visitCount:1})),
  {historyId:50,chunkIndex:0,url:'https://bench.test/content/50',title:'Обзор алгоритмов',text:'Квантовые вычисления',lastVisit:900,visitCount:1}];
let lexicalCalls = 0, ftsCalls = 0, requestedLimit;
const history = {
  search: (_q,limit=500) => { lexicalCalls++; requestedLimit=limit; return entries.slice(0,limit); },
  searchContentChunksFts: () => { ftsCalls++; return chunks; },
};
const reset = () => { lexicalCalls=0; ftsCalls=0; reranks=0; };
reset();
const collected = search.collectHistoryCandidateSet(history,'квантовые вычисления');
assert.equal(collected.candidates.length,9); // восемь лексических и одна новая контентная страница
assert.equal(collected.lexicalKeys.size,8);
assert.equal(collected.candidates[0].snippet,'Квантовые вычисления');
assert.equal(requestedLimit,8);
assert.deepEqual([lexicalCalls,ftsCalls],[1,1]);
for (const next of ['ranked','empty','failed']) {
  mode=next; reset();
  const response=await search.searchHistorySmart(history,'квантовые вычисления');
  assert.deepEqual([lexicalCalls,ftsCalls,reranks],[1,1,1]);
  assert.deepEqual(response.results.map(r=>r.id),next==='ranked'?[2,1]:entries.slice(0,8).map(r=>r.id));
  assert.equal(response.degraded,next!=='ranked');
  assert.equal(response.fallbackReason,next==='failed'?'unavailable':next==='empty'?'no-semantic-match':undefined);
  assert.equal(lastCandidates.length,9);
}
mode='empty'; reset();
const fallback=await search.rerankCollectedHistoryCandidates('квантовые вычисления',collected,8,{related:true});
assert.equal(fallback.degraded,true);
assert.equal(fallback.fallbackReason,'no-semantic-match');
assert.deepEqual([lexicalCalls,ftsCalls],[0,0]);
// Отказ модели без точного совпадения не превращается в ложноположительную выдачу FTS.
const rejected=await search.rerankCollectedHistoryCandidates('квантовые вычисления',{
  candidates:collected.candidates,lexicalKeys:new Set(),
});
assert.deepEqual(rejected,{results:[],degraded:false});
mode='cold'; reset();
const cold=await related.findRelatedPages(history,entries[0].url,'Квантовые вычисления');
assert.equal(cold.pending,false); assert.ok(cold.results.every(r=>r.id!==1));
assert.deepEqual([lexicalCalls,ftsCalls,reranks],[1,1,0]);
mode='pending'; reset();
const first=await related.findRelatedPages(history,entries[0].url,'Квантовые вычисления');
assert.equal(first.pending,true);
const second=related.findRelatedPages(history,entries[0].url,'Квантовые вычисления');
resolveRank([1,0]);
const done=await second;
assert.equal(done.pending,false); assert.deepEqual(done.results.map(r=>r.id),[2]);
assert.deepEqual([lexicalCalls,ftsCalls,reranks],[1,1,1]);
// Второй клик ещё во время SQL ждёт итог реранка и не запускает второй сбор кандидатов.
delayedRead=true; reset();
const loading=related.findRelatedPages(history,entries[0].url,'Квантовые вычисления');
const loadingAgain=related.findRelatedPages(history,entries[0].url,'Квантовые вычисления');
releaseRead();
assert.equal((await loading).pending,true);
resolveRank([1,0]);
assert.deepEqual((await loadingAgain).results.map(r=>r.id),[2]);
assert.deepEqual([lexicalCalls,ftsCalls,reranks],[1,1,1]);
delayedRead=false;
reset();
assert.deepEqual(await search.searchHistorySmart(history,'   '),{results:[],degraded:false});
assert.deepEqual([lexicalCalls,ftsCalls,reranks],[0,0,0]);
const empty={search:()=>[],searchContentChunksFts:()=>[]};
assert.deepEqual(await search.searchHistorySmart(empty,'ничего'),{results:[],degraded:false});
assert.equal(reranks,0);
console.log('ok умный поиск: дедуп, лимиты, успешный/пустой/ошибочный реранк, related, повторный клик и пустая выдача');
