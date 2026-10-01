// Подготовка закрытой панели: реальный DOM/IPC, без модели и платных запросов.
import assert from 'node:assert/strict';
import {withStand, connectCdp, wait} from './isolated-stand.mjs';
await withStand(async ctx => {
  const url=ctx.echoUrl('/prepared-article');
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`); await wait(500);
  const page=connectCdp(await ctx.findTarget(t=>t.url===url)); await page.ready;
  const article='<article>'+Array.from({length:10},(_,i)=>`<p>Факт ${i}: документы нужно сохранить отдельно, поскольку экспорт включает только сообщения. Доступ к архиву заканчивается через десять дней. Вложения в экспорт не входят.</p>`).join('')+'<form><textarea>secret-textarea</textarea></form></article>';
  await page.evaluate(`document.body.innerHTML=${JSON.stringify(article)}`);
  await ctx.evalMain(String.raw`(() => {
    const req=process.mainModule.require, root=req('electron').app.getAppPath();
    const mod=name=>req(req('path').join(root,'dist-electron/electron',name));
    globalThis.prepCalls=0;
    const conn={id:'prep-fixture',label:'Тестовое облако',kind:'openai-compatible',baseUrl:'https://prep.invalid/v1',model:'fixture',concurrency:1};
    mod('ai/KeyStore.js').saveKey(conn.id,'fixture'); mod('ai/ConnectionStore.js').upsert(conn);
    mod('ai/registry.js').providerById=()=>({connection:conn,generateStructured:async(_schema,prompt)=>{
      globalThis.prepCalls++; if(prompt.includes('secret-textarea')) throw Error('Форма попала в запрос');
      return {cards:[{title:'Документы отдельно',text:'Вложения не входят в экспорт.',kind:'Главное',source:1}]};
    }});
    globalThis.preparedState=()=>{
      const ctx=mod('WindowRegistry.js').mainContext(), tab=ctx.tabs.snapshot().find(t=>t.isActive);
      const page=tab && mod('aipanel/InsightsPreparation.js').preparedInsights(ctx.win.id,tab.id,tab.url);
      return page && {url:page.url,textLength:page.text.length,age:Date.now()-page.stableAt,prompt:page.material.prompt};
    };
  })()`);
  const until=async(fn,label,timeout=15000)=>{
    const end=Date.now()+timeout;
    while(Date.now()<end){if(await fn()){console.log('ok',label);return;} await wait(100);}
    throw Error(label);
  };
  await ctx.chrome.evaluate(`window.oblako.setPageInsightsConfig({enabled:true,connectionId:'prep-fixture',allowRemote:true})`);
  await until(async()=>{const p=await ctx.evalMain('globalThis.preparedState()');return p?.textLength>600 && p.age>=4000;},'Снимок и запрос подготовлены при закрытой панели');
  assert.equal(await ctx.evalMain('globalThis.prepCalls'),0);
  await page.evaluate(`document.querySelector('p').textContent += ' Обновлённые условия: срок продлён.'`);
  await until(async()=>{const p=await ctx.evalMain('globalThis.preparedState()');return p?.prompt.includes('Обновлённые условия') && p.age>=4000;},'Подготовка обновилась после изменения статьи, без генерации');
  assert.equal(await ctx.evalMain('globalThis.prepCalls'),0);
  const started=Date.now(); await ctx.chrome.evaluate('window.oblako.toggleAiPanel()');
  const panel=connectCdp(await ctx.findTarget(t=>t.url?.includes('aipanel.html'))); await panel.ready;
  await until(()=>panel.evaluate(`document.querySelectorAll('.page-insight').length===1`),'Карточка без новой паузы стабилизации',3000);
  console.log('От открытия до карточки с мгновенным тестовым провайдером:',Date.now()-started,'мс');
  assert.equal(await ctx.evalMain('globalThis.prepCalls'),1);
  await ctx.chrome.evaluate('window.oblako.toggleAiPanel()');
  const next=ctx.echoUrl('/new-prepared-article');
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(next)})`);
  await until(async()=>!(await ctx.evalMain('globalThis.preparedState()'))?.prompt.includes('Факт 0:'),'Предыдущий материал не попадает в новую вкладку');
  await ctx.chrome.evaluate('window.oblako.setPageInsightsConfig({enabled:false})');
  assert.equal(await ctx.evalMain('globalThis.preparedState()'),null);
  assert.equal(await ctx.evalMain('globalThis.prepCalls'),1);
  console.log('ok Выключение очистило подготовку; скрытая панель не генерирует карточки');
  page.close();panel.close();
},{main:true});
