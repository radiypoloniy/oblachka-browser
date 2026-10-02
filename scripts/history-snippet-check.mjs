import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createHistorySnippet,prepareHistoryCandidateChunks}=require('../dist-electron/electron/HistorySearchSnippet.js');
const {buildFtsQuery}=require('../dist-electron/electron/HistoryReadQueries.js');
const {stemQuery}=require('../dist-electron/electron/textStemming.js');
const intro='Условия наблюдения подробно описаны в справочнике. '.repeat(16);
const evidence='Компенсация экспозиции сохраняет детали снега в кадре.';
for(const query of ['экспозицию','КОМПЕНСАЦИЯ ЭКСПОЗИЦИИ','компенсация-экспозиции']){
  const snippet=createHistorySnippet(query)(intro+evidence+intro);
  assert.ok(snippet.includes(evidence));assert.ok(snippet.length<=240);
  console.log(`ok фрагмент вокруг совпадения: ${query}`);
}
const density=createHistorySnippet('охлаждение батарей')('Батареи. '+intro+'Охлаждение батарей снижает нагрев. '+intro);
assert.ok(density.includes('Охлаждение батарей снижает нагрев.'));
console.log('ok несколько слов запроса важнее первого общего слова');
const repeated=createHistorySnippet('батареи охлаждение')('Батареи батареи батареи. '+intro+'Охлаждение батарей снижает нагрев.');
assert.ok(repeated.includes('Охлаждение батарей снижает нагрев.'));
console.log('ok повторы одного слова не вытесняют содержательное совпадение');
const short='Полярное сияние возникает в атмосфере.';
assert.equal(createHistorySnippet('сияние')(short),short);
const text=intro+'Видеопамять хранит текстуры.';
assert.equal(createHistorySnippet('вид')(text),text.slice(0,360).trim()+'...');
assert.equal(createHistorySnippet('нет совпадений')(text),text.slice(0,360).trim()+'...');
console.log('ok короткий текст сохраняется целиком, подстроки не считаются словами, fallback сохранён');
const empty=createHistorySnippet('  ')(text);
assert.equal(empty,text.slice(0,360).trim()+'...');
const tail=createHistorySnippet('маркер')('Вступление. '.repeat(80)+'Маркер в конце.');
assert.ok(tail.includes('Маркер в конце.'));assert.ok(tail.length<=240);
console.log('ok пустой запрос и совпадение в конце текста');
for(const query of ['DNS-over-HTTPS','3-2-1','"машины"','процент_%','раз два три четыре пять шесть семь восемь девять','']){
  const previous=stemQuery(query).toLowerCase().split(/[\s\-_/|·•,.:;!?()[\]{}'"«»—–]+/).map(x=>x.trim()).filter(x=>x.length>=2).slice(0,8).map(x=>`"${x.replace(/"/g,'""')}"`).join(' OR ');
  assert.equal(buildFtsQuery(query),previous);
}
console.log('ok правила MATCH, пунктуация, числовой запрос и лимит восьми частей сохранены');
const chunks=Array.from({length:13},(_,i)=>({historyId:i,url:`https://quality.test/${i}`,title:'Полезная статья',text:intro+evidence}));
const noisy={...chunks[0],url:'https://quality.test/login',title:'Вход'};
const prepared=prepareHistoryCandidateChunks([noisy,...chunks.flatMap(c=>Array.from({length:8},()=>c))],'экспозиция');
assert.equal(prepared.length,12);assert.equal(new Set(prepared.map(c=>c.historyId)).size,12);
assert.deepEqual(prepared.map(c=>c.historyId),chunks.slice(0,12).map(c=>c.historyId));
assert.ok(prepared.every(c=>c.snippet.includes(evidence) && c.snippet.length<=240));
assert.deepEqual(prepareHistoryCandidateChunks(prepared,'экспозиция'),prepared);
assert.ok(prepared.every(c=>c.text===intro+evidence));
console.log('ok фильтр шума, дедуп 8 чанков, 12 страниц, исходный текст и готовые фрагменты сохранены');
