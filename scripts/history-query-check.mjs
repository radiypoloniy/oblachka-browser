// Проверяем пропуск устаревшего ввода и независимость потребителей, без реального профиля.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/components/library/LatestHistoryQuery.ts', 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const module = {exports:{}};
vm.runInThisContext(`(function(exports){${compiled}\n})`)(module.exports);
const {LatestHistoryQuery} = module.exports;
const fixture = () => {
  const calls = [], gates = [];
  let generation = 0;
  const queue = new LatestHistoryQuery(query => {
    calls.push(query);
    return new Promise((resolve,reject) => gates.push({resolve,reject}));
  });
  return {calls,gates,queue,
    run(query) { const seq=++generation; return queue.run(query,()=>generation===seq); },
    invalidate() { generation++; },
  };
};

const burst = fixture();
const jobs = ['a','ab','abc','abcd','abcde','abcdef'].map(q=>burst.run(q));
assert.deepEqual(burst.calls,['a']);
assert.deepEqual(await Promise.all(jobs.slice(1,-1)),[undefined,undefined,undefined,undefined]);
burst.gates[0].resolve([{id:1}]);
assert.equal(await jobs[0],undefined);
assert.deepEqual(burst.calls,['a','abcdef']);
const finalEntries = [{id:6}];
burst.gates[1].resolve(finalEntries);
assert.equal(await jobs[5],finalEntries);
console.log('ok шесть запросов: читаются первый и последний, устаревшие Promise завершаются');

for (const reason of ['размонтирование','смена профиля','запуск AI']) {
  const f=fixture(), first=f.run('first'), pending=f.run('pending');
  f.invalidate();
  f.gates[0].resolve([{id:1}]);
  assert.equal(await first,undefined);
  assert.equal(await pending,undefined);
  assert.deepEqual(f.calls,['first']);
  console.log(`ok ${reason}: ожидающий запрос не доходит до чтения`);
}

const cleared=fixture(), old=cleared.run('query'), recent=cleared.run('');
cleared.gates[0].resolve([{id:1}]); await old;
assert.deepEqual(cleared.calls,['query','']);
cleared.gates[1].resolve([]);
assert.deepEqual(await recent,[]);
console.log('ok очистка поля запускает recent; пустой результат отличается от отмены');

const a=fixture(), b=fixture();
const aFirst=a.run('a'), aLast=a.run('a2'), bFirst=b.run('b');
a.gates[0].resolve([]); b.gates[0].resolve([{id:2}]);
await aFirst; assert.deepEqual(await bFirst,[{id:2}]);
a.gates[1].resolve([{id:3}]); assert.deepEqual(await aLast,[{id:3}]);
assert.deepEqual(b.calls,['b']);
console.log('ok очереди разных разделов/профилей независимы');

const failed=fixture(), bad=failed.run('bad');
const next=failed.run('next');
// Ошибка уже устарела: не должна мешать последнему запросу.
failed.gates[0].reject(Error('stale failure'));
assert.equal(await bad,undefined);
failed.gates[1].reject(Error('read failure'));
await assert.rejects(next,/read failure/);
const recovered=failed.run('recovered'); failed.gates[2].resolve([]);
assert.deepEqual(await recovered,[]);
console.log('ok ошибка устаревшего чтения пропускается; актуальная видна; очередь восстанавливается');

const syncFailure=new LatestHistoryQuery(()=>{throw Error('sync failure');});
await assert.rejects(syncFailure.run('q',()=>true),/sync failure/);
const invalid=new LatestHistoryQuery(()=>{throw Error('must not read');});
assert.equal(await invalid.run('q',()=>false),undefined);
console.log('ok синхронная ошибка и инвалидированный запрос не оставляют очередь зависшей');
