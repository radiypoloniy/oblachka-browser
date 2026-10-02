// Один парный замер на одинаковой синтетической базе; профиль пользователя не открывается.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async ctx => {
  const p = name => JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  const result = await ctx.evalMain(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule),{HistoryManager}=req(${p('HistoryManager')});
    const {readHistory,closeHistoryReaders}=req(${p('HistoryReader')});
    const Database=req(${JSON.stringify(path.resolve('node_modules/better-sqlite3'))});
    const h=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'substring-large.sqlite'))});await h.initialize();const db=new Database(h.readPath());
    const start=performance.now();db.transaction(()=>{const insert=db.prepare('INSERT INTO history(url,title,last_visit,visit_count) VALUES(?,?,?,1)');
      for(let i=0;i<500000;i++)insert.run('https://large.test/'+i,'common '+i,i);})();const seedMs=performance.now()-start;
    await readHistory(h,{kind:'page',page:{query:''}});
    const cases=[{query:''},{query:'common'},{query:'common 0'},{query:'absent-term'}],runs=[];
    let maxGap=0;
    for(const mode of ['baseline','indexed']) {
      db.prepare("UPDATE history_meta SET value=? WHERE key='trigram-ready'").run(mode==='indexed'?'1':'0');
      let last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},10);
      try {for(const page of cases){const t=performance.now(),response=await readHistory(h,{kind:'page',page});runs.push({mode,query:page.query,ms:performance.now()-t,rows:response.entries.length});}}
      finally{clearInterval(timer);}
    }
    const indexBytes=db.prepare("SELECT SUM(pgsize) bytes FROM dbstat WHERE name LIKE 'history_lookup%'").get().bytes;
    const t=performance.now();for(let i=0;i<100;i++)h.recordVisit('https://writes.test/'+i,'Запись '+i);const writeMs=(performance.now()-t)/100;
    db.close();closeHistoryReaders();return {records:500000,seedMs,indexBytes,writeMs,maxMainTimerGapMs:maxGap,runs};
  })()`, 120000);
  fs.writeFileSync('scripts/reports/history-substring-package.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  assert.ok(result.runs.every(r=>r.rows<=500));
  for (const query of ['common 0','absent-term']) {
    const old=result.runs.find(r=>r.mode==='baseline'&&r.query===query), fresh=result.runs.find(r=>r.mode==='indexed'&&r.query===query);
    assert.equal(fresh.rows,old.rows);assert.ok(fresh.ms<old.ms, `${query}: индекс не улучшил время`);
  }
  assert.ok(result.maxMainTimerGapMs<200);


}, { main: true });
