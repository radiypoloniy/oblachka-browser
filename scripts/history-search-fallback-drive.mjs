// Настоящий IPC и React на временном профиле; ответ модели управляемый, без загрузки GGUF.
import assert from 'node:assert/strict';
import path from 'node:path';
import {withStand} from './isolated-stand.mjs';

await withStand(async ctx => {
  const modulePath = name => JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`));
  await ctx.evalMain(`(()=>{
    const h=process.mainModule.require(${modulePath('ProfileData')}).activeHistory();
    h.recordVisit('https://fallback.test/alpha','alpha');
    globalThis.__fallbackMode='empty';
    process.mainModule.require(${modulePath('TranslationService')}).rerankHistoryCandidates=async()=>{
      if(globalThis.__fallbackMode==='failed')throw Error('synthetic failure');
      return globalThis.__fallbackMode==='ranked'?[0]:[];
    };
  })()`);
  await ctx.chrome.evaluate(`window.oblako.createSpecialTab('history')`);
  const until = predicate => ctx.chrome.evaluate(`(async()=>{
    for(let i=0;i<200;i++){if(${predicate})return;await new Promise(r=>setTimeout(r,25));}
    throw Error('History fallback UI timeout');
  })()`);
  await until(`document.querySelector('[title="https://fallback.test/alpha"]')`);
  const type = value => ctx.chrome.evaluate(`(()=>{
    const input=[...document.querySelectorAll('input')].find(e=>/истории|history/i.test(e.placeholder));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await type('alpha');
  for(const mode of ['empty','failed','ranked']) {
    await ctx.evalMain(`globalThis.__fallbackMode=${JSON.stringify(mode)}`);
    await until(`[...document.querySelectorAll('button')].some(b=>/Найти по смыслу/.test(b.textContent)&&!b.disabled)`);
    await ctx.chrome.evaluate(`[...document.querySelectorAll('button')].find(b=>/Найти по смыслу/.test(b.textContent)).click()`);
    const phrase=mode==='empty'?'ИИ не нашёл подходящих страниц по смыслу.':mode==='failed'?'ИИ недоступен.':'По смыслу';
    await until(`document.body.textContent.includes(${JSON.stringify(phrase)})`);
    assert.ok(await ctx.chrome.evaluate(`!!document.querySelector('[title="https://fallback.test/alpha"]')`));
    const text=await ctx.chrome.evaluate('document.body.textContent');
    assert.equal(text.includes('Обычные совпадения'),mode!=='ranked');
    assert.equal(text.includes('ИИ недоступен.'),mode==='failed');
    assert.equal(text.includes('ИИ не нашёл подходящих страниц по смыслу.'),mode==='empty');
    console.log(`ok UI: ${mode} сохраняет находку и правильно объясняет её происхождение`);
  }
  await type('');
  await until(`!document.body.textContent.includes('По смыслу')`);
  assert.ok(await ctx.chrome.evaluate(`!!document.querySelector('[title="https://fallback.test/alpha"]')`));
  console.log('ok UI: очистка запроса возвращает обычную историю без старого статуса AI');
}, {main:true});
