import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async ctx => {
  const p = name => JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  const result = await ctx.evalMain(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule),{HistoryManager}=req(${p('HistoryManager')});
    const h=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'substring.sqlite'))});await h.initialize();
    h.recordVisit('https://search.test/first','ИСТОРИЯ аккумуляторов');h.recordVisit('https://search.test/a%20b','URL с пробелом');
    const upper=h.getPage({query:'история'}).entries.length;
    h.updateTitle('https://search.test/first','Другая статья');const removed=h.getPage({query:'история'}).entries.length;
    h.recordVisit('https://search.test/final','Новая ИСТОРИЯ');const first=h.getPage({query:'история'}).entries.map(r=>r.url);
    const wildcard=h.getPage({query:'a%20b'}).entries.map(r=>r.url);
    h.deleteEntry(h.getIdByUrl('https://search.test/final'));const afterDelete=h.getPage({query:'история'}).entries.length;
    const Database=req(${JSON.stringify(path.resolve('node_modules/better-sqlite3'))});const db=new Database(h.readPath());
    // Прямой импорт через старую схему не требует новых JS-функций для триггеров.
    db.prepare('INSERT INTO history(url,title,last_visit,visit_count) VALUES(?,?,?,1)').run('https://search.test/legacy','Legacy migration',1);
    const legacy=h.getPage({query:'migration'}).entries.length;
    const imported=h.bulkImportVisits(Array.from({length:2001},(_,i)=>({url:'https://import.test/'+i,title:'import-marker '+i,lastVisit:i,visitCount:1})));
    const importFallback=h.getPage({query:'import-marker 1999'}).entries.length;
    req(${p('HistoryLookup')}).setupHistoryLookup(db);
    for(let i=0;i<300&&!req(${p('HistoryLookup')}).historyLookupReady(db);i++)await new Promise(r=>setTimeout(r,10));
    const importIndexed=h.getPage({query:'import-marker 1999'}).entries.length;
    db.exec('DROP TABLE history_lookup');const fallback=h.getPage({query:'migration'}).entries.length;db.close();
    const migrationPath=${JSON.stringify(path.join(ctx.profile,'migration.sqlite'))};
    const legacyDb=new Database(migrationPath);legacyDb.exec('CREATE TABLE history(id INTEGER PRIMARY KEY,url TEXT UNIQUE NOT NULL,title TEXT NOT NULL,last_visit INTEGER NOT NULL,visit_count INTEGER NOT NULL)');
    legacyDb.transaction(()=>{for(let i=1;i<=150;i++)legacyDb.prepare('INSERT INTO history VALUES(?,?,?,?,1)').run(i,'https://old.test/'+i,'old-marker '+i,i);})();legacyDb.close();
    const old=new HistoryManager(migrationPath);await old.initialize();old.updateTitle('https://old.test/140','changed-marker');old.deleteEntry(141);
    const migratedDb=new Database(migrationPath),lookup=req(${p('HistoryLookup')});lookup.setupHistoryLookup(migratedDb);
    for(let i=0;i<300&&!lookup.historyLookupReady(migratedDb);i++)await new Promise(r=>setTimeout(r,10));
    const migration=lookup.historyLookupReady(migratedDb)&&old.getPage({query:'changed-marker'}).entries.length===1&&old.getPage({query:'old-marker 141'}).entries.length===0;
    migratedDb.close();
    return {migration,upper,removed,first,wildcard,afterDelete,legacy,fallback,imported:imported.inserted,importFallback,importIndexed};
  })()`);
  assert.equal(result.migration,true);assert.equal(result.upper,1);assert.equal(result.removed,0);assert.deepEqual(result.first,['https://search.test/final']);
  assert.deepEqual(result.wildcard,['https://search.test/a%20b']);assert.equal(result.afterDelete,0);assert.equal(result.legacy,1);assert.equal(result.fallback,1);
  assert.equal(result.imported,2001);assert.equal(result.importFallback,1);assert.equal(result.importIndexed,1);
  console.log('ok: кириллический регистр, заголовки, удаления, wildcard, старые записи и отказ индекса');
}, { main: true });
