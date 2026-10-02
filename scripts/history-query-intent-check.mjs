import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {intentCases} from './fixtures/history-query-intent.mjs';
const require=createRequire(import.meta.url);
const {historySearchTopic}=require('../dist-electron/electron/HistorySearchTopic.js');
for(const test of intentCases)assert.equal(historySearchTopic(test.query),test.topic,test.key);
console.log('ok тема восьми естественных вопросов выделяется дословно');
for(const query of ['DNS over HTTPS','Настройка маршрутизатора','почему в гарнитуре исчезает уличный гул',
  'разрушение аккумулятора','как работает экспозиция','3-2-1','find article','найди статью про ',
  'найди статью про ...','найди не статью про батареи',
  'find an article not about batteries','"найди статью про батареи"',
  'найди «статью» про батареи','find article https://example.test/about/batteries',
  'найди '+ 'ту '.repeat(80)+'статью про батареи']){
  assert.equal(historySearchTopic(query),query.trim(),query);
}
console.log('ok короткие/точные запросы, объяснение, отрицание, кавычки, URL и длинный префикс сохранены');
assert.equal(historySearchTopic('НАЙДИ СТАТЬЮ ПРО литиевые батареи без графитового анода'),'литиевые батареи без графитового анода');
assert.equal(historySearchTopic('Как найти прочитанную статью об экспозиции'),'экспозиции');
assert.equal(historySearchTopic('найди статью про 3-2-1'),'3-2-1');
assert.equal(historySearchTopic('Where did I read the article about "DNS over HTTPS"'),'"DNS over HTTPS"');
console.log('ok регистр, ограничения темы и кавычки внутри темы сохранены');
process.argv.push('--check');
await import('./history-query-intent-bench.mjs');
console.log('ok настоящий FTS/воркер: семь целевых страниц, пустой запрос без ответа, полный вопрос и один реранк');
