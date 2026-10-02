import assert from 'node:assert/strict';
import path from 'node:path';
import { withStand } from './isolated-stand.mjs';

await withStand(async ctx => {
  const p = name => JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  const result = await ctx.evalMain(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule);
    const {HistoryManager,TEXT_EXTRACTION_VERSION:version}=req(${p('HistoryManager')});
    const h=new HistoryManager(${JSON.stringify(path.join(ctx.profile,'filters.sqlite'))});await h.initialize();
    const urls=['https://example.test/article','https://sub.example.test/article','https://example.test.evil.test/article','https://prefixexample.test/article','https://other.test/example.test','https://example.test@evil.test/article'];
    for(const url of urls){h.recordVisit(url,'Установка клиента');h.saveContentChunks(h.getIdByUrl(url),[{chunkIndex:0,url,title:'Установка клиента',text:'Установка клиента Linux без интернета',vector:new Float32Array(0),dims:0}],version);}
    const {readHistory}=req(${p('HistoryReader')}),search=req(${p('HistorySearch')});
    const page=await readHistory(h,{kind:'page',page:{query:'',filters:{domain:'example.test'}}});
    const candidates=await search.collectHistoryCandidateSetAsync(h,'установка',{domain:'example.test'});
    const future=await readHistory(h,{kind:'page',page:{query:'',filters:{from:Date.now()+1000}}});
    const {prepareHistoryCandidateChunks}=req(${p('HistorySearchSnippet')});
    const base={historyId:100,url:'https://example.test/notes',title:'Настройка клиента',lastVisit:1,visitCount:1};
    const evidence=prepareHistoryCandidateChunks([{...base,text:'Linux: установка клиента. '+ 'Описание установки. '.repeat(20)},{...base,text:'Работает без интернета. '+ 'Описание работы. '.repeat(20)}],'Linux без интернета')[0].snippet;
    return {urls:page.entries.map(r=>r.url).sort(),candidates:candidates.candidates.map(r=>r.url).sort(),future:future.entries.length,evidence};
  })()`);
  const expected=['https://example.test/article','https://sub.example.test/article'];
  assert.deepEqual(result.urls,expected); assert.deepEqual(result.candidates,expected); assert.equal(result.future,0);
  assert.ok(result.evidence.includes('Linux')); assert.ok(result.evidence.includes('без интернета')); assert.ok(result.evidence.length<=240);
  console.log('ok: домен/поддомены без подделок; период до отбора; два доказательства в прежнем бюджете');
}, { main: true });
