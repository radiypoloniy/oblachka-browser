import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {historyFtsTerms,historyNumericPattern,stemQuery}=require('../dist-electron/electron/textStemming.js');
const {buildFtsQuery}=require('../dist-electron/electron/HistoryReadQueries.js');
const {createHistorySnippet}=require('../dist-electron/electron/HistorySearchSnippet.js');
for(const query of ['3-2-1','"3-2-1"','3-2-1.'])assert.equal(buildFtsQuery(query),'"3 2 1"');
assert.equal(buildFtsQuery('версия 1.2.3'),'"1 2 3" AND ("верс")');
assert.equal(buildFtsQuery('3-2-1 1.2.3'),'"3 2 1" AND "1 2 3"');
for(const text of ['1.2.3.4','9.1.2.3','11.2.3','1.2.30'])assert.equal(historyNumericPattern('1 2 3').test(text),false,text);
console.log('ok числовые последовательности — обязательные фразы, не OR отдельных цифр');
for(const query of ['2026','RTX 5090','DNS-over-HTTPS','процент_%','"машины"','3','a','',
  'раз два три четыре пять шесть семь восемь девять','3--2--1','1.2.3beta']){
  const old=stemQuery(query).toLowerCase().split(/[\s\-_/|·•,.:;!?()[\]{}\'"«»—–]+/).filter(x=>x.length>=2).slice(0,8);
  assert.deepEqual(historyFtsTerms(query),old,query);
}
console.log('ok слова, год, модель, одиночные цифры и некорректные последовательности сохраняют прежнее поведение');
assert.deepEqual(historyFtsTerms('1-2-3-4-5-6-7-8-9'),[]);
assert.deepEqual(historyFtsTerms('1-2-3-4-5-6-7-8 2026'),['1 2 3 4 5 6 7 8']);
assert.deepEqual(historyFtsTerms('раз два три четыре пять шесть 3-2-1'),['раз','два','три','четыр','пят','шест']);
console.log('ok бюджет восемь токенов, числовая фраза не обрезается до чужого номера');
const intro='Условия наблюдения подробно описаны в справочнике. '.repeat(16);
const evidence='Правило 3-2-1 сохраняет резервные копии.';
const snippet=createHistorySnippet('3-2-1')('3 документа, 2 носителя, 1 архив. '+intro+evidence+intro);
assert.ok(snippet.includes(evidence));assert.ok(snippet.length<=240);
const version=createHistorySnippet('версия 1.2.3')('Версия 1.2.4. '+intro+'Версия 1.2.3 исправляет документы.'+intro);
assert.ok(version.includes('Версия 1.2.3 исправляет документы.'));
assert.ok(createHistorySnippet('система 3-2-1')('Система описана здесь. '+intro+evidence+intro).includes(evidence));
assert.ok(createHistorySnippet('3-2-1')('Правило 3-2-1-4. '+intro+evidence+intro).includes(evidence));
console.log('ok контекст вокруг целого номера, разрозненные цифры и другие версии его не вытесняют');
process.argv.push('--check');
await import('./history-numeric-bench.mjs');
console.log('ok настоящий FTS/воркер: 15 запросов, ложные совпадения, исходный вопрос и прежние лимиты');
