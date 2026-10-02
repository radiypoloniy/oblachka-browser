// Один ограниченный замер на синтетической базе, без пользовательского профиля.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {withStand} from './isolated-stand.mjs';

await withStand(async ctx => {
  const result=await ctx.evalMain(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule);
    const {HistoryManager}=req(${JSON.stringify(path.resolve('dist-electron/electron/HistoryManager.js'))});
    const {readHistory,closeHistoryReaders}=req(${JSON.stringify(path.resolve('dist-electron/electron/HistoryReader.js'))});
    const Sqlite=req(${JSON.stringify(path.resolve('node_modules/better-sqlite3'))});
    const h=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'paging-large.sqlite'))});
    await h.initialize();const db=new Sqlite(h.readPath());
    db.transaction(()=>{
      const insert=db.prepare('INSERT INTO history(url,title,last_visit,visit_count) VALUES(?,?,?,1)');
      for(let i=0;i<500000;i++)insert.run('https://large.test/'+i,'common '+i,i);
    })();
    await readHistory(h,{kind:'page',page:{query:''}});
    const cases=[{query:''},{query:'',before:{lastVisit:250000,id:250001}},
      {query:'',before:{lastVisit:1000,id:1001}},{query:'common'},
      {query:'common 0'},{query:'absent-term'}];
    const runs=[];let last=performance.now(),maxGap=0;
    const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},10);
    try{for(const page of cases){
      const start=performance.now(),response=await readHistory(h,{kind:'page',page});
      runs.push({page,ms:performance.now()-start,rows:response.entries.length,hasNext:!!response.next});
    }}finally{clearInterval(timer);}
    const plan=db.prepare('EXPLAIN QUERY PLAN SELECT id FROM history WHERE last_visit <= ? AND (last_visit < ? OR id < ?) ORDER BY last_visit DESC,id DESC LIMIT 501').all(250000,250000,250001);
    db.close();closeHistoryReaders();return {records:500000,runs,maxMainTimerGapMs:maxGap,plan};
  })()`);
  assert.ok(result.runs.every(r=>r.rows<=500));
  assert.equal(result.runs[4].rows,1);assert.equal(result.runs[5].rows,0);
  assert.ok(result.maxMainTimerGapMs<200,'чтение не должно блокировать main на 200 мс');
  fs.mkdirSync('scripts/reports',{recursive:true});
  fs.writeFileSync('scripts/reports/history-paging-bench.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
},{main:true});
