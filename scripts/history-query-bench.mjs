// Реальные IPC/SQLite, синтетическая история с индексом в одноразовом профиле.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {withStand} from './isolated-stand.mjs';

const compiled=ts.transpileModule(fs.readFileSync('src/components/library/LatestHistoryQuery.ts','utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;
const report={measuredAt:new Date().toISOString(),cpu:os.cpus()[0]?.model,
  visits:500000,indexedPages:20000,chunks:90000,inputIntervalMs:30,rounds:[],
  methodology:'Same temporary database and read-only worker. Warm cache, three alternating pairs. Reference reproduces previous immediate IPC dispatch with generation guard; queue uses actual renderer queue module. Both finish at latest response, excluding DOM/paint. Separate actual UI run ends at matching DOM. Synthetic index is present but no concurrent AI inference/index writes or cold-disk simulation.',
};
await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  await ctx.evalMain(`(()=>{
    const req=process.mainModule.require.bind(process.mainModule);
    const data=req(${p('ProfileData')}); const h=data.activeHistory();
    const dbPath=h.readPath(), relative=req('path').relative(${JSON.stringify(ctx.profile)},dbPath);
    if(!relative || relative.startsWith('..') || req('path').isAbsolute(relative))throw Error('Unsafe profile');
    const db=new (req(${JSON.stringify(path.resolve('node_modules/better-sqlite3'))}))(dbPath);
    const {TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')});
    const {stemText}=req(${p('textStemming')});
    const text='Квантовые вычисления и результаты исследования. '.repeat(30), stem=stemText(text);
    db.transaction(()=>{
      const visit=db.prepare('INSERT INTO history(url,title,last_visit,visit_count) VALUES (?,?,?,1)');
      const chunk=db.prepare('INSERT INTO history_content_chunks(history_id,chunk_index,url,title,text,vector,dims,model_version,indexed_at) VALUES (?,?,?,?,?,?,0,?,?)');
      const fts=db.prepare('INSERT INTO history_content_chunks_fts(rowid,text,title,url) VALUES (?,?,?,?)');
      for(let i=0;i<500000;i++){
        const url=${JSON.stringify(ctx.echoUrl('/queue-bench/'))}+i;
        const title='Статья '+i+(i%5000===0?' queue-final':'');
        const id=Number(visit.run(url,title,Date.UTC(2025,0,1)-i*1000).lastInsertRowid);
        if(i>=20000)continue;
        for(let j=0;j<1+i%8;j++){
          const row=chunk.run(id,j,url,title,text,Buffer.alloc(0),version,Date.UTC(2025,0,1));
          fts.run(Number(row.lastInsertRowid),stem,stemText(title),url);
        }
      }
    })(); db.close();
    const reader=req(${p('HistoryReader')}), original=reader.readHistory;
    globalThis.__queryReads=[];
    reader.readHistory=async(history,request)=>{
      if(request.kind==='search')globalThis.__queryReads.push(request.query);
      return original(history,request);
    };
  })()`);
  report.versions=await ctx.evalMain('process.versions');
  await ctx.evalMain(`(()=>{
    const win=process.mainModule.require(${p('WindowRegistry')}).mainContext()?.win;
    if(!win)throw Error('Benchmark window missing');
    if(win.isMinimized())win.restore();win.show();win.setAlwaysOnTop(true);win.moveTop();win.focus();
  })()`);
  await ctx.chrome.send('Page.bringToFront');
  await ctx.chrome.evaluate(`globalThis.__queryExports={};((exports)=>{${compiled}\n})(globalThis.__queryExports)`);
  await ctx.chrome.evaluate(`window.oblako.searchHistory('queue-warmup')`);
  const run=async mode=>{
    await ctx.evalMain('globalThis.__queryReads=[]');
    const value=await ctx.chrome.evaluate(`(async()=>{
      const queries=['queue-a','queue-ab','queue-abc','queue-abcd','queue-abcde','queue-final'];
      let generation=0, final;
      const queue=new globalThis.__queryExports.LatestHistoryQuery(q=>window.oblako.searchHistory(q));
      if(document.visibilityState!=='visible')throw Error('Benchmark window hidden');
      const jobs=[], started=performance.now(), inputTimes=[];
      for(const query of queries){
        inputTimes.push(performance.now()-started);
        const seq=++generation;
        const read=${JSON.stringify(mode)}==='queue'
          ? queue.run(query,()=>seq===generation)
          : window.oblako.searchHistory(query);
        jobs.push(read.then(rows=>{if(seq===generation)final=rows;}));
        await new Promise(r=>setTimeout(r,30));
      }
      await Promise.all(jobs);
      return {ms:performance.now()-started,inputTimes,ids:final.map(e=>e.id)};
    })()`,30000);
    value.reads=await ctx.evalMain('globalThis.__queryReads');
    assert.equal(value.ids.length,100);
    assert.equal(value.reads[0],'queue-a');
    assert.equal(value.reads.at(-1),'queue-final');
    return value;
  };
  for(let i=0;i<3;i++){
    const order=i%2?['queue','reference']:['reference','queue'], pair={};
    for(const mode of order)pair[mode]=await run(mode);
    assert.deepEqual(pair.queue.ids,pair.reference.ids);
    assert.equal(pair.reference.reads.length,6);
    assert.ok(pair.queue.reads.length<=6);
    for(const value of Object.values(pair)){
      value.rows=value.ids.length;
      value.idsHash=createHash('sha256').update(JSON.stringify(value.ids)).digest('hex');
      delete value.ids;
    }
    report.rounds.push(pair);
    console.log(JSON.stringify({round:i+1,referenceMs:pair.reference.ms,queueMs:pair.queue.ms,reads:pair.queue.reads.length}));
  }
  await ctx.chrome.evaluate(`window.oblako.createSpecialTab('history')`);
  await ctx.chrome.evaluate(`(async()=>{for(let i=0;i<200;i++){if(document.querySelectorAll('button[title="Удалить из истории"]').length===500)return;await new Promise(r=>setTimeout(r,20));}throw Error('Initial DOM timeout');})()`);
  await ctx.evalMain('globalThis.__queryReads=[]');
  report.ui=await ctx.chrome.evaluate(`(async()=>{
    const input=[...document.querySelectorAll('input')].find(e=>/истории|history/i.test(e.placeholder));
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    const started=performance.now();
    for(const query of ['queue-a','queue-ab','queue-abc','queue-abcd','queue-abcde','queue-final']){
      setter.call(input,query);input.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,30));
    }
    for(let i=0;i<300;i++){
      const rows=document.querySelectorAll('button[title="Удалить из истории"]');
      if(rows.length===100 && document.querySelector('[title=${JSON.stringify(ctx.echoUrl('/queue-bench/0'))}]')){
        const ms=performance.now()-started;
        await new Promise(r=>setTimeout(r,200));
        if(document.querySelectorAll('button[title="Удалить из истории"]').length!==100)throw Error('Stale UI');
        return {ms,rows:100,query:input.value};
      }
      await new Promise(r=>setTimeout(r,10));
    }
    throw Error('Final DOM timeout');
  })()`,30000);
  report.ui.reads=await ctx.evalMain('globalThis.__queryReads');
  assert.ok(report.ui.reads.length<=6);
  console.log(JSON.stringify(report.ui));
},{main:true});
fs.writeFileSync('scripts/reports/history-query-queue.json',JSON.stringify(report,null,2)+'\n');
