// Реальный renderer на пустом профиле: извлечение, мутации и стоимость старого/нового обхода DOM.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { withStand, connectCdp, wait } from './isolated-stand.mjs';
const oldSource = execFileSync('git',['show','e0ce80c:electron/aipanel/InsightsPage.ts'],{encoding:'utf8'});
const oldScript = Function('return ' + oldSource.match(/const SAMPLE = (`[\s\S]+?`);/)[1])();
await withStand(async ctx => {
  const url = ctx.echoUrl('/insight-extraction');
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`); await wait(600);
  const page = connectCdp(await ctx.findTarget(t => t.url === url)); await page.ready;
  const script = await ctx.evalMain(`(() => {const req=process.mainModule.require; return req(req('path').join(req('electron').app.getAppPath(),'dist-electron/electron/aipanel/InsightsPage.js')).INSIGHT_SAMPLE;})()`);
  const paragraphs = Array.from({length:1500},(_,i)=>`<p>Абзац ${i}: ${'Текст длинной статьи с фактами, аргументами и подробностями. '.repeat(5)}</p>`).join('');
  await page.evaluate(`document.body.innerHTML=${JSON.stringify('<article>Короткий анонс</article><main><article>'+paragraphs+'<form><textarea>secret-textarea</textarea></form><span role="timer">1</span></article></main><aside>Динамический виджет</aside>')}`);
  const result = await page.evaluate(`eval(${JSON.stringify(script)})`);
  assert.ok(result.includes('Абзац 0')); assert.ok(!result.includes('secret-textarea'));
  assert.ok(result.length <= 120100);
  assert.equal(await page.evaluate(`eval(${JSON.stringify(script)})`),null);
  await page.evaluate(`document.querySelector('aside').textContent='Изменение счётчика'; document.querySelector('[role="timer"]').textContent='2'`); await wait(30);
  assert.equal(await page.evaluate(`eval(${JSON.stringify(script)})`),null);
  await page.evaluate(`document.querySelector('p').textContent+=' Существенное изменение материала.'`); await wait(30);
  assert.ok((await page.evaluate(`eval(${JSON.stringify(script)})`)).includes('Существенное изменение'));
  // Для замера оба алгоритма получают один и тот же большой корень статьи.
  await page.evaluate(`document.querySelector('article').remove()`); await wait(30);
  await page.evaluate(`eval(${JSON.stringify(script)})`);
  const times = await page.evaluate(`(() => {
    const old=${JSON.stringify(oldScript)}, current=${JSON.stringify(script)};
    const run = code => {const start=performance.now(); for(let i=0;i<40;i++) eval(code); return (performance.now()-start)/40;};
    return {oldMs:run(old),unchangedMs:run(current)};
  })()`);
  console.log('Извлечение на 1500 абзацах, среднее за 40 проверок:',JSON.stringify(times));
  await page.evaluate(`document.querySelector('article').replaceWith(...document.querySelector('article').childNodes)`); await wait(30);
  await page.evaluate(`document.querySelector('p').textContent += ' Статья без семантической обёртки.'`); await wait(30);
  assert.ok((await page.evaluate(`eval(${JSON.stringify(script)})`)).includes('Статья без семантической обёртки'));
  await page.evaluate(`const body=document.createElement('body'); body.innerHTML='<main><p>Новая статья после замены всего body.</p></main>'; document.body.replaceWith(body)`);
  assert.ok((await page.evaluate(`eval(${JSON.stringify(script)})`)).includes('Новая статья'));
  console.log('OK: большая статья вместо анонса; формы исключены; неизменный DOM/виджеты не перечитываются; статья без article с формой работает');
  page.close();
},{main:true});
