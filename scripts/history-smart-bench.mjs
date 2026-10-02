// До/после: настоящая SQLite/FTS в отдельном профиле, детерминированный реранк для сравнения выдачи.
// node scripts/history-smart-bench.mjs [--after] [--live-ai]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

const after = process.argv.includes('--after');
const liveAi = process.argv.includes('--live-ai');
const aiOnly = process.argv.includes('--ai-only');
const file = path.resolve(`scripts/reports/history-smart-${after ? 'after' : 'before'}.json`);
const beforeFile = path.resolve('scripts/reports/history-smart-before.json');
const baseline = after ? JSON.parse(fs.readFileSync(beforeFile, 'utf8')) : null;
const modulePath = name => path.resolve(`dist-electron/electron/${name}.js`);
const report = aiOnly ? JSON.parse(fs.readFileSync(file, 'utf8')) : { measuredAt: new Date().toISOString(), samples: 12, results: [], liveAi: null };

for (const [visits, indexed] of aiOnly ? [] : [[10000, 2000], [100000, 10000], [500000, 20000]]) {
  console.log(`Smart history: ${visits} visits, ${indexed} indexed pages`);
  await withStand(async ctx => {
    const result = await ctx.evalMain(`(async () => {
      const req = process.mainModule.require.bind(process.mainModule);
      const { HistoryManager, TEXT_EXTRACTION_VERSION: version } = req(${JSON.stringify(modulePath('HistoryManager'))});
      const Database = req(${JSON.stringify(path.resolve('node_modules/better-sqlite3'))});
      const { stemText } = req(${JSON.stringify(modulePath('textStemming'))});
      const service = req(${JSON.stringify(modulePath('TranslationService'))});
      const search = req(${JSON.stringify(modulePath('HistorySearch'))});
      const history = new HistoryManager(${JSON.stringify(path.join(ctx.profile, 'smart-bench.sqlite'))});
      await history.initialize();
      const db = new Database(${JSON.stringify(path.join(ctx.profile, 'smart-bench.sqlite'))});
      const text = 'Исследование квантовых вычислений. Методы обработки информации и результаты экспериментов. '.repeat(14);
      const rare = text + ' сверхпроводимость';
      const stem = stemText(text), rareStem = stemText(rare);
      const started = performance.now();
      db.transaction(() => {
        const visit = db.prepare('INSERT INTO history(url,title,last_visit,visit_count) VALUES (?,?,?,1)');
        const chunk = db.prepare('INSERT INTO history_content_chunks(history_id,chunk_index,url,title,text,vector,dims,model_version,indexed_at) VALUES (?,?,?,?,?,?,0,?,?)');
        const fts = db.prepare('INSERT INTO history_content_chunks_fts(rowid,text,title,url) VALUES (?,?,?,?)');
        for (let i = 0; i < ${visits}; i++) {
          const url = 'https://bench.test/article/' + i;
          const title = (i % 5000 === 0 ? 'сверхпроводимость ' : '') + 'Статья об исследовании ' + i;
          const id = Number(visit.run(url, title, Date.UTC(2025,0,1) - i * 1000).lastInsertRowid);
          if (i >= ${indexed}) continue;
          for (let j = 0; j < 1 + i % 8; j++) {
            const isRare = i % 5000 === 0;
            const row = chunk.run(id,j,url,title,isRare ? rare : text,Buffer.alloc(0),version,Date.UTC(2025,0,1));
            fts.run(Number(row.lastInsertRowid),isRare ? rareStem : stem,stemText(title),url);
          }
        }
      })();
      const seedMs = performance.now() - started;
      const chunks = db.prepare('SELECT COUNT(*) n FROM history_content_chunks').get().n;
      const stats = values => { const a = [...values].sort((x,y)=>x-y); return { medianMs:a[Math.floor(a.length/2)],p95Ms:a[Math.ceil(a.length*.95)-1],rawMs:values }; };
      const cases = {};
      for (const [name, q] of Object.entries({ common:'исследование', rare:'сверхпроводимость', missing:'несуществующийзапрос', contentOnly:'квантовый' })) {
        const readings = { lexical:[], fts:[], collect:[], mainTimer:[] };
        for (let i = 0; i < 12; i++) {
          let t = performance.now(); history.search(q); readings.lexical.push(performance.now()-t);
          t = performance.now(); history.searchContentChunksFts(q,version,96); readings.fts.push(performance.now()-t);
          const timerStart = performance.now(); const timer = new Promise(r=>setTimeout(()=>r(performance.now()-timerStart),0));
          t = performance.now(); search.collectHistoryCandidates(history,q); readings.collect.push(performance.now()-t);
          readings.mainTimer.push(await timer);
        }
        let lexicalCalls = 0, ftsCalls = 0;
        const lexical = history.search.bind(history), fulltext = history.searchContentChunksFts.bind(history);
        history.search = (...args) => { lexicalCalls++; return lexical(...args); };
        history.searchContentChunksFts = (...args) => { ftsCalls++; return fulltext(...args); };
        const candidates = search.collectHistoryCandidates(history,q);
        const modes = {};
        for (const mode of ['ranked','empty','failed','related']) {
          service.rerankHistoryCandidates = async (_q, rows) => {
            if (mode === 'failed') throw Error('synthetic model failure');
            return mode === 'ranked' ? rows.map((_,i)=>i).filter(i=>i%2===0).reverse() : [];
          };
          lexicalCalls = 0; ftsCalls = 0;
          const t = performance.now();
          const response = await search.searchHistorySmart(history,q,8,{ related:mode==='related' });
          modes[mode] = { response, lexicalCalls, ftsCalls, totalMs:performance.now()-t };
        }
        history.search = lexical; history.searchContentChunksFts = fulltext;
        cases[name] = { query:q, timings:Object.fromEntries(Object.entries(readings).map(([k,v])=>[k,stats(v)])), candidates, modes };
      }
      // Настоящая запись индексатором после наполнения: FTS должен сразу видеть новый текст.
      history.recordVisit('https://bench.test/new','Новая статья');
      const id = history.getIdByUrl('https://bench.test/new');
      const t = performance.now();
      const saved = history.saveContentChunks(id,[{chunkIndex:0,url:'https://bench.test/new',title:'Новая статья',text:'маркерновойиндексации',vector:new Float32Array(0),dims:0}],version);
      const writeMs = performance.now()-t;
      const visible = history.searchContentChunksFts('маркерновойиндексации',version,96).some(c=>c.historyId===id);
      const coverageStart = performance.now(); const coverage = history.getContentCoverage();
      const coverageMs = performance.now()-coverageStart;
      db.close();
      return {visits:${visits},indexed:${indexed},chunks,seedMs,cases,write:{saved,visible,writeMs},coverage:{value:coverage,ms:coverageMs}};
    })()`);
    assert.equal(result.write.saved, true);
    assert.equal(result.write.visible, true);
    assert.ok(result.cases.contentOnly.candidates.length > 0);
    assert.ok(result.cases.contentOnly.candidates.every(c => c.snippet));
    assert.equal(result.cases.missing.candidates.length, 0);
    if (baseline) {
      const old = baseline.results.find(r => r.visits === visits);
      for (const [name, item] of Object.entries(result.cases)) {
        assert.deepEqual(item.candidates, old.cases[name].candidates, name + ': candidate regression');
        for (const [mode, value] of Object.entries(item.modes)) assert.deepEqual(value.response, old.cases[name].modes[mode].response, name + '/' + mode);
      }
    }
    report.results.push(result);
    console.log(JSON.stringify({visits,chunks:result.chunks,ftsCommonMs:result.cases.common.timings.fts.medianMs,collectContentMs:result.cases.contentOnly.timings.collect.medianMs,smartLexicalCalls:result.cases.contentOnly.modes.ranked.lexicalCalls,coverageMs:result.coverage.ms}));
  }, { main:true });
}
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
if (liveAi) {
  // GGUF только читается по исходному пути; нет копирования/junction и записи в реальный профиль.
  const modelPath = path.join(process.env.APPDATA ?? '', 'oblako-browser/models/gguf/Qwen3.5-4B-Q4_K_M.gguf');
  if (!fs.existsSync(modelPath)) throw Error('Installed benchmark model missing');
  await withStand(async ctx => {
    report.liveAi = await ctx.main.evaluate(`(async () => {
      const req = process.mainModule.require.bind(process.mainModule);
      const registry = req(${JSON.stringify(modulePath('ModelRegistry'))});
      const service = req(${JSON.stringify(modulePath('TranslationService'))});
      registry.add({id:'bench-qwen4b',label:'Qwen3.5 4B',filePath:${JSON.stringify(modelPath)},sizeBytes:${fs.statSync(modelPath).size},source:'legacy'});
      registry.setDefault('bench-qwen4b');
      const { HistoryManager, TEXT_EXTRACTION_VERSION: version } = req(${JSON.stringify(modulePath('HistoryManager'))});
      const search = req(${JSON.stringify(modulePath('HistorySearch'))});
      const history = new HistoryManager(':memory:'); await history.initialize();
      for (const [i,text] of ['Квантовые вычисления используют кубиты и квантовые алгоритмы.','Рецепт приготовления супа с овощами.','Квантовый компьютер решает задачи с использованием кубитов.'].entries()) {
        const url = 'https://bench.test/ai/' + i; history.recordVisit(url,'Статья ' + i);
        history.saveContentChunks(history.getIdByUrl(url),[{chunkIndex:0,url,title:'Статья '+i,text,vector:new Float32Array(0),dims:0}],version);
      }
      const runs = [];
      for (let i=0;i<2;i++) { const t=performance.now(); const response=await search.searchHistorySmart(history,'квантовые вычисления'); runs.push({state:i?'warm':'cold',ms:performance.now()-t,response}); }
      await service.unloadModel();
      return {model:'Qwen3.5 4B Q4_K_M',runs};
    })()`, 180000);
    console.log('Live AI:', JSON.stringify(report.liveAi.runs.map(r=>({state:r.state,ms:r.ms,ids:r.response.results.map(e=>e.id)}))));
    if (report.liveAi.runs.some(r=>r.response.degraded)) {
      report.liveAi.diagnostic = ctx.appLog.join('').slice(-4500);
      console.log(report.liveAi.diagnostic);
    }
  }, {main:true});
}
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
console.log(`Saved ${file}${after ? '; candidate and fallback outputs match baseline' : ''}`);
