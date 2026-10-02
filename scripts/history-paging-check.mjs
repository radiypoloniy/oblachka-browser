// Проверяем SQLite, worker, IPC и реальные кнопки на одноразовом профиле.
import assert from 'node:assert/strict';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';

await withStand(async ctx => {
  const mod=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  const result=await ctx.evalMain(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule),assert=req('node:assert/strict');
    const history=req(${mod('ProfileData')}).activeHistory();
    const Sqlite=req(${JSON.stringify(path.resolve('node_modules/better-sqlite3'))});
    const db=new Sqlite(history.readPath());
    db.transaction(()=>{
      const insert=db.prepare('INSERT INTO history(url,title,last_visit,visit_count) VALUES(?,?,?,1)');
      for(let i=0;i<1205;i++)insert.run('https://paging.test/'+i,'paging-match '+i,1000);
      insert.run('https://paging.test/older','unique-oldest',900);
    })();
    const {readHistory}=req(${mod('HistoryReader')});
    const walk=async query=>{
      const ids=[],sizes=[];let before;
      do{
        const page=await readHistory(history,{kind:'page',page:{query,before}});
        sizes.push(page.entries.length);ids.push(...page.entries.map(e=>e.id));before=page.next;
      }while(before);
      assert.equal(new Set(ids).size,ids.length);
      return {ids,sizes};
    };
    const all=await walk(''),filtered=await walk('paging-match');
    assert.deepEqual(all.sizes,[500,500,206]);
    assert.deepEqual(filtered.sizes,[500,500,205]);
    assert.equal(all.ids.length,1206);assert.equal(filtered.ids.length,1205);
    assert.deepEqual((await walk('missing')).sizes,[0]);
    const first=await readHistory(history,{kind:'page',page:{query:''}});
    db.prepare('DELETE FROM history WHERE id=?').run(first.next.id);
    const next=await readHistory(history,{kind:'page',page:{query:'',before:first.next}});
    assert.ok(next.entries.every(e=>!first.entries.some(f=>f.id===e.id)));
    const oldest=await readHistory(history,{kind:'page',page:{query:'unique-oldest'}});
    assert.equal(oldest.entries[0].url,'https://paging.test/older');
    await assert.rejects(()=>readHistory(history,{kind:'page',page:{query:'',before:{id:-1,lastVisit:1}}}));
    db.close();return {all:all.sizes,filtered:filtered.sizes};
  })()`);
  assert.deepEqual(result.all,[500,500,206]);
  console.log('ok paging: >1200 записей, одинаковые даты, поиск, пустая выдача и удалённая граница');
  await ctx.chrome.evaluate(`window.oblako.createSpecialTab('history')`);
  const until=predicate=>ctx.chrome.evaluate(`(async()=>{
    for(let i=0;i<200;i++){if(${predicate})return;await new Promise(r=>setTimeout(r,25));}
    throw Error('Paging UI timeout: '+${JSON.stringify(predicate)});
  })()`);
  const text='document.body.textContent';
  await until(`${text}.includes('Страница 1') && [...document.querySelectorAll('button')].some(b=>b.textContent==='Старее'&&!b.disabled)`);
  const click=label=>ctx.chrome.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
  await click('Старее');await until(`${text}.includes('Страница 2')`);
  await click('Старее');await until(`${text}.includes('Страница 3') && document.querySelector('[title="https://paging.test/older"]')`);
  assert.ok(await ctx.chrome.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Старее').disabled`));
  await click('Новее');await until(`${text}.includes('Страница 2')`);
  assert.equal(await ctx.chrome.evaluate(`document.querySelectorAll('[title^="https://paging.test/"]').length`),500);
  await ctx.chrome.evaluate(`(()=>{
    const input=[...document.querySelectorAll('input')].find(e=>/истории|history/i.test(e.placeholder));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'unique-oldest');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await until(`${text}.includes('Страница 1') && document.querySelector('[title="https://paging.test/older"]')`);
  assert.equal(await ctx.chrome.evaluate(`document.querySelectorAll('[title^="https://paging.test/"]').length`),1);
  console.log('ok paging UI: переходы, ограниченная память списка и сброс страницы при поиске');
},{main:true});
