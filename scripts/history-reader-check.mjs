// SQLite/FTS читает отдельный поток; все базы находятся внутри временного профиля стенда.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createPackageWithOptions } from '@electron/asar';
import { withStand } from './isolated-stand.mjs';

await withStand(async ctx => {
  const result = await ctx.evalMain(`(async () => {
    const req = process.mainModule.require.bind(process.mainModule);
    const assert = req('node:assert/strict');
    const { HistoryManager, TEXT_EXTRACTION_VERSION: version } = req(${JSON.stringify(path.resolve('dist-electron/electron/HistoryManager.js'))});
    const { readHistory, closeHistoryReaders } = req(${JSON.stringify(path.resolve('dist-electron/electron/HistoryReader.js'))});
    const { collectHistoryCandidateSet, collectHistoryCandidateSetAsync } = req(${JSON.stringify(path.resolve('dist-electron/electron/HistorySearch.js'))});
    const a = new HistoryManager(${JSON.stringify(path.join(ctx.profile,'reader-a.sqlite'))});
    const b = new HistoryManager(${JSON.stringify(path.join(ctx.profile,'reader-b.sqlite'))});
    assert.deepEqual(await readHistory(a,{kind:'recent',limit:500}),[]);
    assert.deepEqual(await readHistory(a,{kind:'coverage'}),{withContent:0,noisy:0,missing:0,total:0});
    await a.initialize(); await b.initialize();
    const add = (h,url,title,text) => {
      h.recordVisit(url,title); const id = h.getIdByUrl(url);
      assert.equal(h.saveContentChunks(id,Array.from({length:8},(_,chunkIndex)=>({chunkIndex,url,title,text,vector:new Float32Array(0),dims:0})),version),true);
      return id;
    };
    const id = add(a,'https://bench.test/a','Машины и квантовые вычисления','Красивые машины исследуют квантовые вычисления.');
    add(a,'https://bench.test/a2','Обзор алгоритмов','Квантовые вычисления и кубиты.');
    add(b,'https://bench.test/b','Машины другого профиля','Машины и операции профиля Б.');
    for (const query of ['машина','квантовые','кубиты','несуществующее','%','"','']) {
      assert.deepEqual(await readHistory(a,{kind:'search',query,limit:500}),a.search(query));
      const expected=collectHistoryCandidateSet(a,query), actual=await collectHistoryCandidateSetAsync(a,query);
      assert.deepEqual(actual,expected);
    }
    assert.deepEqual(await readHistory(a,{kind:'recent',limit:500}),a.getRecent());
    assert.deepEqual(await readHistory(a,{kind:'coverage'}),a.getContentCoverage());
    const results=await Promise.all([
      readHistory(a,{kind:'search',query:'Машины',limit:500}),
      readHistory(b,{kind:'search',query:'Машины',limit:500}),
      readHistory(a,{kind:'search',query:'Машины',limit:500}),
    ]);
    assert.ok(results[0].every(e=>e.url!=='https://bench.test/b'));
    assert.equal(results[1][0].url,'https://bench.test/b');
    assert.deepEqual(results[0],results[2]);
    // WAL: новое содержимое должно быть видно без перезапуска читающего соединения.
    add(a,'https://bench.test/new','Новый визит','маркерновойиндексации');
    let found=await collectHistoryCandidateSetAsync(a,'маркерновойиндексации');
    assert.equal(found.candidates.length,1);
    const newId=found.candidates[0].id;
    add(a,'https://bench.test/new','Новый визит','маркерзаменённоготекста');
    assert.equal((await collectHistoryCandidateSetAsync(a,'маркерновойиндексации')).candidates.length,0);
    assert.equal((await collectHistoryCandidateSetAsync(a,'маркерзаменённоготекста')).candidates[0].id,newId);
    // Запись в main во время запросов читателя: снимки могут различаться, последующий обязан быть свежим.
    const pending=collectHistoryCandidateSetAsync(a,'машина');
    a.deleteEntry(id);
    await pending;
    assert.ok((await collectHistoryCandidateSetAsync(a,'машина')).candidates.every(e=>e.id!==id));
    a.deleteEntry(newId);
    assert.equal((await collectHistoryCandidateSetAsync(a,'маркерзаменённоготекста')).candidates.length,0);
    assert.equal(a.clearHistory('all'),true);
    assert.deepEqual(await readHistory(a,{kind:'recent',limit:500}),[]);
    assert.deepEqual((await collectHistoryCandidateSetAsync(a,'квантовый')).candidates,[]);
    assert.deepEqual(await readHistory(a,{kind:'coverage'}),a.getContentCoverage());
    assert.equal((await readHistory(b,{kind:'recent',limit:500})).length,1);
    // Закрытие читателя не оставляет висящий Promise; следующий запрос открывает соединение заново.
    const interrupted=readHistory(b,{kind:'recent',limit:500});
    closeHistoryReaders();
    await assert.rejects(interrupted,/closed/);
    assert.equal((await readHistory(b,{kind:'recent',limit:500}))[0].url,'https://bench.test/b');
    closeHistoryReaders();
    return {profiles:true,write:true,replacement:true,delete:true,clear:true,reopen:true,equivalent:true};
  })()`);
  assert.ok(Object.values(result).every(Boolean));
  await ctx.evalMain(`process.mainModule.require(${JSON.stringify(path.resolve('dist-electron/electron/ProfileData.js'))}).activeHistory().recordVisit('https://bench.test/ipc','IPC-маркер')`);
  const ipc = await ctx.chrome.evaluate(`Promise.all([window.oblako.getHistory(),window.oblako.searchHistory('IPC-маркер'),window.oblako.getHistoryContentCoverage()])`);
  assert.equal(ipc[0][0].url,'https://bench.test/ipc');
  assert.equal(ipc[1][0].url,'https://bench.test/ipc');
  assert.equal(ipc[2].total,1);
  // Поздний ответ профиля A не должен засорить кэш уже открытого профиля B.
  await ctx.evalMain(`(() => {
    const reader=process.mainModule.require(${JSON.stringify(path.resolve('dist-electron/electron/HistoryReader.js'))});
    const data=process.mainModule.require(${JSON.stringify(path.resolve('dist-electron/electron/ProfileData.js'))});
    const original=reader.readHistory; const a=data.activeHistory();
    globalThis.__holdHistory=a; globalThis.__historyWaiting=false;
    reader.readHistory=async (history,request)=>{
      const value=await original(history,request);
      if (request.kind==='recent' && history===globalThis.__holdHistory) {
        globalThis.__historyWaiting=true;
        await new Promise(resolve=>{globalThis.__releaseHistory=resolve;});
      }
      return value;
    };
  })()`);
  await ctx.chrome.evaluate(`window.oblako.createSpecialTab('history')`);
  const waitGate=async()=>{
    for(let i=0;i<100;i++) {
      if(await ctx.evalMain('globalThis.__historyWaiting')) return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw Error('History gate timeout');
  };
  await waitGate();
  const newProfile=await ctx.chrome.evaluate(`(async()=>{const state=await window.oblako.createProfile('Reader test B','blue');const other=state.profiles.find(p=>p.id!==state.activeId);await window.oblako.switchProfile(other.id);return other.id;})()`);
  assert.ok(newProfile);
  await ctx.evalMain(`process.mainModule.require(${JSON.stringify(path.resolve('dist-electron/electron/ProfileData.js'))}).activeHistory().recordVisit('https://bench.test/profile-b','Профиль Б')`);
  const tab=await ctx.chrome.evaluate(`window.oblako.createSpecialTab('history')`);
  await ctx.chrome.evaluate(`(async()=>{for(let i=0;i<100;i++){if(document.querySelector('[title="https://bench.test/profile-b"]'))return;await new Promise(r=>setTimeout(r,20));}throw Error('Profile B history DOM timeout');})()`);
  await ctx.evalMain(`globalThis.__holdHistory=null;globalThis.__releaseHistory()`);
  await new Promise(resolve=>setTimeout(resolve,100));
  await ctx.evalMain(`globalThis.__holdHistory=process.mainModule.require(${JSON.stringify(path.resolve('dist-electron/electron/ProfileData.js'))}).activeHistory();globalThis.__historyWaiting=false`);
  await ctx.chrome.evaluate(`window.oblako.closeTab(${JSON.stringify(tab)})`);
  await ctx.chrome.evaluate(`window.oblako.createSpecialTab('history')`);
  await waitGate();
  const cache=await ctx.chrome.evaluate(`({b:!!document.querySelector('[title="https://bench.test/profile-b"]'),a:!!document.querySelector('[title="https://bench.test/ipc"]')})`);
  assert.equal(cache.a,false);
  assert.equal(cache.b,true);
  await ctx.evalMain(`globalThis.__holdHistory=null;globalThis.__releaseHistory()`);
  // Проверяем именно путь воркера внутри ASAR; нативный SQLite берётся с диска, как в asarUnpack.
  const archive=path.join(ctx.profile,'history-reader-test.asar');
  const packedSource=path.join(ctx.profile,'history-reader-pack');
  fs.cpSync(path.resolve('dist-electron'),packedSource,{recursive:true});
  for (const name of ['better-sqlite3','bindings','file-uri-to-path','snowball-stemmers']) {
    fs.cpSync(path.resolve('node_modules',name),path.join(packedSource,'node_modules',name),{recursive:true});
  }
  await createPackageWithOptions(packedSource,archive,{unpackDir:'node_modules/better-sqlite3'});
  const packed=await ctx.evalMain(`(async () => {
    const { Worker }=process.mainModule.require('node:worker_threads');
    const worker=new Worker(${JSON.stringify(path.join(archive,'electron/history-read-worker.js'))},{
      workerData:{dbPath:${JSON.stringify(path.join(ctx.profile,'reader-b.sqlite'))}},
    });
    const read=(id,request)=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('ASAR worker timeout')),15000);
      worker.once('error',error=>{clearTimeout(timer);reject(error);});
      worker.once('message',message=>{clearTimeout(timer);if(message.error)reject(Error(message.error));else resolve(message.value);});
      worker.postMessage({id,request});
    });
    try { return {
      recent:await read(1,{kind:'recent',limit:500}),
      candidates:await read(2,{kind:'candidates',query:'Машины',version:process.mainModule.require(${JSON.stringify(path.resolve('dist-electron/electron/HistoryManager.js'))}).TEXT_EXTRACTION_VERSION,lexicalLimit:8,ftsLimit:96}),
    }; } finally { await worker.terminate(); }
  })().catch(error=>({error:String(error.message),stack:String(error.stack)}))`);
  if (packed.error) throw new Error(JSON.stringify(packed));
  assert.equal(packed.recent[0].url,'https://bench.test/b');
  assert.equal(packed.candidates.chunks[0].url,'https://bench.test/b');
  assert.equal(packed.candidates.chunks[0].snippet,packed.candidates.chunks[0].text);
  console.log('ok read-only history worker: выдача, стемминг, профили, запись/замена текста, удаление/очистка и перезапуск');
}, {main:true});
