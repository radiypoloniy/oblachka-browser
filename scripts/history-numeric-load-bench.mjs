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
    const stats=a=>{a.sort((a,b)=>a-b);return {medianMs:a[Math.floor(a.length/2)],p95Ms:a[Math.ceil(a.length*.95)-1],maxMs:a.at(-1)};};
    const oldTerms=q=>stemming.stemQuery(q).toLowerCase().split(/[\\s\\-_/|·•,.:;!?()[\\]{}'"«»—–]+/).filter(x=>x.length>=2).slice(0,8);
    const originalTerms=stemming.historyFtsTerms,sql=[];
    try{
      for(const query of ['версия','версия 1.2.3','3-2-1','2026']){
        const before=[],after=[];let beforeRows,afterRows;
        // Чередование на одной базе уменьшает зависимость результата от порядка/кэша.
        for(let i=0;i<12;i++){
          for(const mode of (i%2?['after','before']:['before','after'])){
            stemming.historyFtsTerms=mode==='before'?oldTerms:originalTerms;
            const t=performance.now(),rows=queries.readFts(db,query,version,96),elapsed=performance.now()-t;
            if(mode==='before')beforeRows=rows.length;else afterRows=rows.length;
            if(i>=2)(mode==='before'?before:after).push(elapsed);
          }
        }
        sql.push({query,beforeRows,afterRows,before:stats(before),after:stats(after)});
      }
    }finally{stemming.historyFtsTerms=originalTerms;db.close();}
    // Синхронный seed/SQL временно задерживает запуск приложения; даём ему закончиться
    // и прогреваем читателя до измерения production-пути, а не смешиваем эти фазы.
    await new Promise(resolve=>setTimeout(resolve,2000));
    for(const q of ['версия','версия 1.2.3','3-2-1','2026'])await collectHistoryCandidateSetAsync(history,q);
    const {PerformanceObserver}=req('node:perf_hooks'),gc=[];
    const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())gc.push({startTime:entry.startTime,duration:entry.duration});});
    observer.observe({entryTypes:['gc']});
    const delays=[],idleDelays=[],outliers=[],start=performance.now();let last=start,phase='idle';
    const timer=setInterval(()=>{const now=performance.now(),delay=now-last;(phase==='idle'?idleDelays:delays).push(delay);if(delay>50)outliers.push({phase,intervalMs:delay});last=now;},10);
    const worker=[];
    try{
      await new Promise(resolve=>setTimeout(resolve,1000));
      for(const query of ['версия','версия 1.2.3','3-2-1','2026']){
        phase=query;
        const times=[];let count;
        for(let i=0;i<10;i++){
          const t=performance.now(),collected=await collectHistoryCandidateSetAsync(history,query);
          times.push(performance.now()-t);count=collected.candidates.length;assert.ok(count<=20);
          if(query==='3-2-1' || query==='версия 1.2.3')assert.equal(count,12);
        }
        worker.push({query,candidates:count,warm:stats(times)});
      }
    }finally{clearInterval(timer);observer.disconnect();}
    return {sql,worker,idleTimerIntervalMs:stats(idleDelays),mainTimerIntervalMs:stats(delays),outliers,gc,versions:process.versions};
  })()`));
},{main:true});
assert.equal(report.sql.find(c=>c.query==='версия').beforeRows,report.sql.find(c=>c.query==='версия').afterRows);
fs.writeFileSync('scripts/reports/history-numeric-load.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sql:report.sql,worker:report.worker,mainTimerIntervalMs:report.mainTimerIntervalMs}));
