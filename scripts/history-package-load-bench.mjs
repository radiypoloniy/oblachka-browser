// Синтетические 500k визитов/90k чанков. SQL-замеры отдельно от отзывчивости production worker.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';
const report={measuredAt:new Date().toISOString(),visits:500_000,chunks:90_000};
await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  Object.assign(report,await ctx.evalMain(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule), assert=req('node:assert/strict');
    const {HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')});
    const queries=req(${p('HistoryReadQueries')}), stemming=req(${p('textStemming')});
    const {collectHistoryCandidateSetAsync}=req(${p('HistorySearch')});
    const dbPath=${JSON.stringify(path.join(ctx.profile,'numeric-load.sqlite'))};
    const history=new HistoryManager(dbPath);await history.initialize();
    const Database=req(${JSON.stringify(path.resolve('node_modules/better-sqlite3'))}),db=new Database(dbPath);
    const visit=db.prepare('INSERT INTO history(id,url,title,last_visit,visit_count) VALUES (?,?,?,?,1)');
    const chunk=db.prepare('INSERT INTO history_content_chunks(id,history_id,chunk_index,url,title,text,vector,dims,model_version,indexed_at) VALUES (?,?,0,?,?,?, ?,0,?,0)');
    const fts=db.prepare('INSERT INTO history_content_chunks_fts(rowid,text,title,url) VALUES (?,?,?,?)');
    db.transaction(()=>{
      for(let i=1;i<=500000;i++)visit.run(i,'https://load.test/article/'+i,'Контрольный справочник '+i,1700000000000-i);
      for(let i=1;i<=90000;i++){
        const url='https://load.test/article/'+i,title='Контрольный справочник '+i;
        const text=i%5000===0?'Версия 1.2.3 исправляет документы. Правило 3-2-1 сохраняет архивы.':'Версия 1.2.4 исправляет документы. Правило 3-2-4 сохраняет архивы.';
        chunk.run(i,i,url,title,text,Buffer.alloc(0),version);
        fts.run(i,stemming.stemText(text),stemming.stemText(title),stemming.stemText(url));
      }
    })();
    db.close();await new Promise(r=>setTimeout(r,1000));
    let last=performance.now(),maxGap=0;const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},10);
    const runs=[];try{for(const query of ['версия','версия 1.2.3','3-2-1','2026']){const start=performance.now(),r=await collectHistoryCandidateSetAsync(history,query);assert.ok(r.candidates.length<=20);runs.push({query,ms:performance.now()-start,candidates:r.candidates.length});}}
    finally{clearInterval(timer);}return {runs,maxMainTimerGapMs:maxGap};
  })()`,120000));
},{main:true});
assert.ok(report.maxMainTimerGapMs<200);
fs.writeFileSync('scripts/reports/history-package-load.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
