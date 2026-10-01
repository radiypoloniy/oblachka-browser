import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { comparisonRows } from '../shared/tabCompare.ts';
import { compareArchiveEntry } from '../shared/compareArchive.ts';
const { parseCompareSnapshot, parseCompareArchiveEntry } = createRequire(import.meta.url)('../dist-electron/shared/compareArchiveValidation.js');
const products = ['A','B'].map((title,i)=>({tabId:title,url:'https://shop.test/'+title,title,category:'Ноутбуки',capturedAt:10,method:'page',note:'',facts:[{id:1,label:'ОЗУ',value:i?'8 ГБ':'16 ГБ',quote:i?'8 ГБ':'16 ГБ'}]}));
const refs = [{product:0,fact:1},{product:1,fact:1}];
const advice = {headline:'Больше памяти',summary:'В A указано 16 ГБ памяти, в B — 8 ГБ.',refs,cards:[{scenario:'Нужен запас памяти',product:0,reason:'У A указано вдвое больше памяти.',limitation:'Нет сведений о процессоре.',refs}],caveats:[]};
const snapshot = {version:1,id:'test',createdAt:10,updatedAt:20,products,rows:comparisonRows(products),advice,via:'Тестовая модель',connectionId:'test-model'};
assert.deepEqual(parseCompareSnapshot(JSON.parse(JSON.stringify(snapshot))),snapshot);
const entry = compareArchiveEntry(snapshot);
assert.deepEqual(parseCompareArchiveEntry(entry),entry);
assert.equal(entry.hasAdvice,true);assert.equal(entry.products.length,2);
assert.equal(compareArchiveEntry({...snapshot,advice:null,via:null}).hasAdvice,false);
for (const patch of [{version:2},{products:[]},{createdAt:NaN},{advice:{...advice,refs:[{product:1,fact:999}]}},
  {rows:[{label:'ОЗУ',cells:[{...products[0].facts[0],value:'Выдуманное'},null]}]},
  {products:[{...products[0],url:'javascript:alert(1)'},products[1]]}]) assert.throws(()=>parseCompareSnapshot({...snapshot,...patch}));
assert.throws(()=>parseCompareArchiveEntry({...entry,products:[{title:'A',url:'broken'},entry.products[1]]}));
assert.throws(()=>parseCompareArchiveEntry({...entry,updatedAt:Infinity}));
console.log('ok Снимок и карточка проходят круговой разбор; неизвестный формат, повреждённые факты, ссылки и даты отклоняются');
