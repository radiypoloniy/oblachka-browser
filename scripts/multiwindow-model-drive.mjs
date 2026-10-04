// Настоящий runtime и установленная модель; настройки и история только во временном профиле.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  await wait(900);
  const sync = async expression => {
    const r = await ctx.main.send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r));
    return r.result?.result?.value;
  };
  const load = suffix => `Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith(${JSON.stringify(suffix)})).exports`;
  await sync(`globalThis.modelStand = { registry: ${load('/WindowRegistry.js')}, models: ${load('/ModelRegistry.js')}, service: ${load('/TranslationService.js')}, queue: ${load('/QwenQueue.js')}, events: [], inputs: [] }; true`);
  const model = await sync('modelStand.models.list().sort((a,b)=>a.sizeBytes-b.sizeBytes)[0]');
  assert.ok(model, 'Для реального прогона нужна установленная GGUF-модель');
  await sync(`modelStand.models.setDefault(${JSON.stringify(model.id)}); true`);
  console.log('Реальная модель:', model.label);
  await ctx.chrome.evaluate('window.oblako.openWindow()'); await wait(650);
  await sync(`modelStand.a=modelStand.registry.allContexts()[0]; modelStand.b=modelStand.registry.allContexts()[1];
    const original=modelStand.service.runChatMessage;
    modelStand.service.runChatMessage=(text,history,...rest)=>{modelStand.inputs.push({text,history:JSON.parse(JSON.stringify(history))});return original(text,history,...rest);};
    for(const name of ['a','b']) {const wc=modelStand[name].chromeView.webContents;const send=wc.send.bind(wc);wc.send=(channel,data)=>{if(channel==='hub-chat:result')modelStand.events.push({name,data});send(channel,data);};} true`);
  const inWindow = (w, code) => ctx.evalMain(`modelStand.${w}.chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  const send = (w,text) => inWindow(w,`window.oblako.sendHubChatMessage('hub',${JSON.stringify(text)},false)`);
  const awaitResults = async count => {
    for(let n=0;n<90;n++) {
      const events=await sync('modelStand.events');
      if(events.length>=count) return events;
      if(n%15===0) console.log('Ожидаю локальный ответ:',events.length,'из',count);
      await wait(1000);
    }
    throw Error('Локальная модель не ответила за 90 секунд: '+ctx.appLog.join('').slice(-1800));
  };
  await send('a','Remember the code SUN. Reply with one short word.');
  await send('b','Remember the code MOON. Reply with one short word.');
  const initial=await awaitResults(2);
  for(const e of initial) assert.ok(e.data.outcome.ok && e.data.outcome.out.trim(),JSON.stringify(e));
  assert.deepEqual(new Set(initial.map(e=>e.name)),new Set(['a','b']));
  assert.equal(await sync('modelStand.inputs[0].history.length'),0);
  assert.equal(await sync('modelStand.inputs[1].history.length'),0);
  assert.equal(await sync('modelStand.service.getLoadedModelId()'),model.id);
  await sync('modelStand.a.win.close(); true'); await wait(150);
  await send('b','What code did I give you? Reply with just the code.');
  const final=await awaitResults(3);
  assert.ok(final[2].data.outcome.ok && final[2].data.outcome.out.trim());
  const history=JSON.stringify(await sync('modelStand.inputs[2].history'));
  assert.ok(history.includes('MOON'));
  assert.equal(history.includes('SUN'),false);
  assert.equal(await sync('modelStand.service.getLoadedModelId()'),model.id);
  console.log('OK: настоящая локальная генерация в двух окнах, пустые независимые первые истории, продолжение только истории B после закрытия A, тот же загруженный runtime.');
}, { main:true });
