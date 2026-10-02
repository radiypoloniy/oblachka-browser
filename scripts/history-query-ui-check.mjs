// Настоящий React → preload → IPC; задерживаем только ответ в одноразовом профиле.
import assert from 'node:assert/strict';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';

await withStand(async ctx => {
  const modulePath = name => JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  const untilMain = async predicate => {
    for(let i=0;i<100;i++) {
      if(await ctx.evalMain(predicate)) return;
      await new Promise(r=>setTimeout(r,20));
    }
    throw Error(`Main wait timeout: ${predicate}; ${JSON.stringify(await ctx.evalMain('({smart:globalThis.__smartQuery,queries:globalThis.__queries})'))}; ${JSON.stringify(await ctx.chrome.evaluate('[...document.querySelectorAll("input")].map(e=>({value:e.value,placeholder:e.placeholder}))'))}`);
  };
  const untilDom = predicate => ctx.chrome.evaluate(`(async()=>{
    for(let i=0;i<100;i++){if(${predicate})return;await new Promise(r=>setTimeout(r,20));}
    throw Error('DOM wait timeout');
  })()`);
  const type = value => ctx.chrome.evaluate(`(()=>{
    const input=[...document.querySelectorAll('input')].find(e=>/истории|history/i.test(e.placeholder));
    if(!input)throw Error('History input missing');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await ctx.evalMain(`(()=>{
    const data=process.mainModule.require(${modulePath('ProfileData')});
    const reader=process.mainModule.require(${modulePath('HistoryReader')});
    const original=reader.readHistory;
    const history=data.activeHistory();
    history.recordVisit('https://bench.test/final','queue-final');
    history.recordVisit('https://bench.test/other','unrelated');
    globalThis.__queries=[];globalThis.__holdQuery=null;globalThis.__queryWaiting=false;
    reader.readHistory=async(h,r)=>{
      const query=r.kind==='page'?r.page.query:r.query;
      if(r.kind==='search'||(r.kind==='page'&&query))globalThis.__queries.push(query);
      const result=await original(h,r);
      if((r.kind==='search'||r.kind==='page') && query===globalThis.__holdQuery){
        globalThis.__queryWaiting=true;
        await new Promise(resolve=>{globalThis.__releaseQuery=resolve;});
      }
      return result;
    };
  })()`);
  let tab=await ctx.chrome.evaluate(`window.oblako.createSpecialTab('history')`);
  await untilDom(`document.querySelector('[title="https://bench.test/final"]')`);
  const hold = async first => {
    await ctx.evalMain(`globalThis.__queries=[];globalThis.__holdQuery=${JSON.stringify(first)};globalThis.__queryWaiting=false`);
    await type(first);
    await untilMain('globalThis.__queryWaiting');
  };
  const release = () => ctx.evalMain('globalThis.__holdQuery=null;globalThis.__releaseQuery()');
  await hold('queue-a');
  for(const value of ['queue-ab','queue-abc','queue-abcd','queue-abcde','queue-final']) {
    await type(value); await new Promise(r=>setTimeout(r,20));
  }
  // Тот же API используется другим потребителем; его запрос не должен ждать нашу очередь.
  const other=await ctx.chrome.evaluate(`window.oblako.searchHistory('unrelated')`);
  assert.equal(other[0].url,'https://bench.test/other');
  assert.deepEqual(await ctx.evalMain('globalThis.__queries'),['queue-a','unrelated']);
  await release();
  await untilDom(`document.querySelector('[title="https://bench.test/final"]') && !document.querySelector('[title="https://bench.test/other"]')`);
  assert.deepEqual(await ctx.evalMain('globalThis.__queries'),['queue-a','unrelated','queue-final']);
  await type('');
  await untilDom(`document.querySelector('[title="https://bench.test/other"]')`);
  console.log('ok UI: серия ввода пропускает промежуточные IPC, чужой поиск независим, очистка восстанавливает историю');

  await hold('close-a'); await type('close-pending');
  await new Promise(r=>setTimeout(r,30));
  await ctx.chrome.evaluate(`window.oblako.closeTab(${JSON.stringify(tab)})`);
  await untilDom(`![...document.querySelectorAll('input')].some(e=>/истории|history/i.test(e.placeholder))`);
  await release();
  await new Promise(r=>setTimeout(r,100));
  assert.deepEqual(await ctx.evalMain('globalThis.__queries'),['close-a']);
  console.log('ok UI: закрытие вкладки отменяет ожидающий поиск');

  tab=await ctx.chrome.evaluate(`window.oblako.createSpecialTab('history')`);
  await untilDom(`document.querySelector('[title="https://bench.test/final"]')`);
  await hold('ai-a'); await type('ai-pending');
  await new Promise(r=>setTimeout(r,30));
  // Только модель заменена детерминированной выдачей: проверяем сосуществование с UI AI,
  // качество модели и индекса проверяют отдельные стенды.
  await ctx.evalMain(`(()=>{
    const search=process.mainModule.require(${modulePath('HistorySearch')});
    const data=process.mainModule.require(${modulePath('ProfileData')});
    search.searchHistorySmart=async (_history,q)=>{globalThis.__smartQuery=q;return {results:data.activeHistory().search('queue-final'),degraded:false};};
  })()`);
  await ctx.chrome.evaluate(`(()=>{
    const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Найти по смыслу');
    if(!button)throw Error('AI history button missing');button.click();
  })()`);
  await untilMain(`globalThis.__smartQuery==='ai-pending'`);
  await untilDom(`document.querySelector('[title="https://bench.test/final"]')`);
  await release(); await new Promise(r=>setTimeout(r,100));
  assert.deepEqual(await ctx.evalMain('globalThis.__queries'),['ai-a']);
  assert.ok(await ctx.chrome.evaluate(`!!document.querySelector('[title="https://bench.test/final"]')`));
  console.log('ok UI: AI инвалидирует ожидающий обычный поиск, поздний ответ не перезаписывает AI-результат');

  await type(''); await untilDom(`document.querySelector('[title="https://bench.test/other"]')`);
  await hold('profile-a'); await type('profile-pending');
  await new Promise(r=>setTimeout(r,30));
  await ctx.chrome.evaluate(`(async()=>{
    const state=await window.oblako.createProfile('Queue B','blue');
    await window.oblako.switchProfile(state.profiles.find(p=>p.id!==state.activeId).id);
  })()`);
  await ctx.evalMain(`process.mainModule.require(${modulePath('ProfileData')}).activeHistory().recordVisit('https://bench.test/b','Профиль Б')`);
  await ctx.chrome.evaluate(`window.oblako.createSpecialTab('history')`);
  await untilDom(`document.querySelector('[title="https://bench.test/b"]')`);
  await release(); await new Promise(r=>setTimeout(r,100));
  assert.deepEqual(await ctx.evalMain('globalThis.__queries'),['profile-a']);
  assert.ok(await ctx.chrome.evaluate(`!!document.querySelector('[title="https://bench.test/b"]') && !document.querySelector('[title="https://bench.test/final"]')`));
  console.log('ok UI: смена профиля отменяет старую очередь и сохраняет выдачу нового профиля');
}, {main:true});
