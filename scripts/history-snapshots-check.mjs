import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async ctx => {
  const p = name => JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  const result = await ctx.evalMain(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule);
    const {HistoryManager,TEXT_EXTRACTION_VERSION:v}=req(${p('HistoryManager')});
    const {buildTextChunks}=req(${p('HistoryIndexer')});
    const file=${JSON.stringify(path.join(ctx.profile,'snapshots.sqlite'))};
    const h=new HistoryManager(file);await h.initialize();const url='https://snapshot.test/article';h.recordVisit(url,'История устройства');const id=h.getIdByUrl(url);
    const save=text=>h.saveContentChunks(id,buildTextChunks(text).map((text,chunkIndex)=>({chunkIndex,url,title:'История устройства',text,vector:new Float32Array(0),dims:0})),v);
    const Database=req(${JSON.stringify(path.resolve('node_modules/better-sqlite3'))}), db=new Database(file);
    const counts=()=>db.prepare('SELECT COUNT(*) n FROM history_previous_chunks').get().n;
    const long='Вступление к справочнику. '.repeat(800)+'Акклиматизация на высоте сохраняет силы.';
    if(!save(long))throw Error('save long failed');
    const tail=h.searchContentChunksFts('акклиматизация',v,288).length;
    save(long);const unchanged=counts();
    save('Бета версия устройства работает без интернета.');const archived=h.searchContentChunksFts('акклиматизация',v,288).length;
    const reopened=new HistoryManager(file);await reopened.initialize();const afterReopen=reopened.searchContentChunksFts('акклиматизация',v,288).length;
    save('Гамма версия устройства поддерживает Linux.');const expired=h.searchContentChunksFts('акклиматизация',v,288).length,beta=h.searchContentChunksFts('бета',v,288).length;
    h.deleteEntry(id);const deleted=counts(),fts=db.prepare('SELECT COUNT(*) n FROM history_previous_chunks_fts').get().n;
    db.close();return {tail,unchanged,archived,afterReopen,expired,beta,deleted,fts,chunks:buildTextChunks(long).length};
  })()`);
  assert.ok(result.chunks>8 && result.chunks<=24);assert.ok(result.tail>0);assert.equal(result.unchanged,0);
  assert.ok(result.archived>0);assert.ok(result.afterReopen>0);assert.equal(result.expired,0);assert.ok(result.beta>0);
  assert.equal(result.deleted,0);assert.equal(result.fts,0);
  console.log('ok: конец длинной статьи; одинаковый текст без дубля; две версии после перезапуска; удаление обеих версий и индекса');
}, { main: true });
