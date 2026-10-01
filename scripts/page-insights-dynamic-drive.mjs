// Живой IPC/React/main на пустом профиле. Провайдер подменён: ни платных запросов, ни загрузки GGUF.
import assert from 'node:assert/strict';
import { withStand, wait, connectCdp } from './isolated-stand.mjs';

await withStand(async ctx => {
  const url = ctx.echoUrl('/insight-article');
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`);
  await wait(700);
  const pageTarget = await ctx.findTarget(t => t.url === url);
  const page = connectCdp(pageTarget); await page.ready;
  const paragraphs = Array.from({ length: 8 }, (_, i) => `<p>Условие номер ${i + 1}: документы для проекта нужно скачать отдельно в течение ${i + 10} дней. После этого срока доступ к архиву закрывается, поэтому сохраните необходимые файлы заранее.</p>`).join('');
  await page.evaluate(`document.body.innerHTML = ${JSON.stringify('<article><h1>Условия экспорта</h1>' + paragraphs + '<form><input value="secret-input"><textarea>secret-textarea</textarea></form></article>')}`);
  await ctx.evalMain(`(() => {
    const req=process.mainModule.require, root=req('electron').app.getAppPath();
    req(req('path').join(root,'dist-electron/electron/ModelRegistry.js')).getDefault = () => null;
  })()`);
  await ctx.chrome.evaluate('window.oblako.toggleAiPanel()');
  const target = await ctx.findTarget(t => t.url?.includes('aipanel.html'));
  const panel = connectCdp(target); await panel.ready;
  const until = async (predicate, label, timeout = 24000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await predicate()) { console.log('ok', label); return; } await wait(200); }
    throw new Error(label + ': ' + JSON.stringify(await panel.evaluate('document.body.innerText')));
  };
  await until(() => panel.evaluate(`(document.body?.innerText || '').includes('Подключите модель')`), 'Без модели — предложение подключить');
  await ctx.evalMain(String.raw`(() => {
    const req = process.mainModule.require, root = req('electron').app.getAppPath();
    const mod = name => req(req('path').join(root,'dist-electron/electron',name));
    globalThis.insightCalls = 0; globalThis.insightDelay = 0; globalThis.insightEmpty = false;
    const conn = { id:'insight-fixture', label:'Тестовое облако', kind:'openai-compatible',
      baseUrl:'https://insights-fixture.invalid/v1', model:'fixture', concurrency:1 };
    mod('ai/KeyStore.js').saveKey(conn.id,'fixture-key');
    mod('ai/ConnectionStore.js').upsert(conn);
    mod('ai/registry.js').providerById = () => ({
      connection:conn, generateStructured:async (_schema,prompt,opts) => {
        if (prompt.includes('secret-input') || prompt.includes('secret-textarea')) throw new Error('Поле формы попало в AI');
        globalThis.insightCalls++;
        await new Promise(resolve => setTimeout(resolve,globalThis.insightDelay));
        if (opts.abort.aborted) throw new Error('Отменено');
        if (globalThis.insightEmpty) return {cards:[]};
        const fragments = [...prompt.matchAll(/^\[(\d+)\] (.+)$/gm)];
        return {cards:fragments.slice(0,7).map((f,i) => ({title:'Вывод '+(i+1),text:'Сохраните документы заранее.',kind:'Условие',source:Number(f[1]),quote:f[2].slice(0,100)}))};
      }
    });
  })()`);
  await panel.evaluate(`window.aiPanel.setPageInsightsConfig({connectionId:'insight-fixture',allowRemote:false})`);
  await until(() => panel.evaluate(`(document.body?.innerText || '').includes('Разрешите фоновые')`), 'Облако требует отдельного разрешения');
  assert.equal(await ctx.evalMain('globalThis.insightCalls'), 0);
  await panel.evaluate('window.aiPanel.setPageInsightsConfig({allowRemote:true})');
  // Постоянно меняющийся материал не должен сбрасывать ожидание/терять медленный ответ.
  await ctx.evalMain('globalThis.insightDelay = 3500');
  await page.evaluate(`globalThis.changingArticle=setInterval(() => {document.querySelector('p').textContent = 'Непрерывное обновление материала: ' + Date.now() + '. ' + 'Документы надо скачать заранее, доступ закрывается через десять дней. '.repeat(3);},300)`);
  const started = Date.now();
  await until(() => ctx.evalMain('globalThis.insightCalls === 1'), 'Постоянные изменения не блокируют автоматический разбор');
  assert.ok(Date.now() - started < 16000);
  await until(() => panel.evaluate(`document.querySelectorAll('.page-insight').length > 0`), 'Медленный ответ не теряется при изменении материала');
  assert.ok(await panel.evaluate(`!!document.querySelector('.is-stale')`));
  assert.equal(await ctx.evalMain('globalThis.insightCalls'),1);
  await page.evaluate('clearInterval(globalThis.changingArticle)');
  await wait(3000);
  assert.equal(await ctx.evalMain('globalThis.insightCalls'),1);
  console.log('OK: ограниченное ожидание, устаревший снимок показан явно, повторного платного запроса нет');
  await ctx.evalMain('globalThis.insightDelay = 0; globalThis.insightEmpty = true');
  await panel.evaluate('window.aiPanel.runPageInsights()');
  await until(() => panel.evaluate(`document.body.innerText.includes('Модель вернула пустой обзор')`), 'Пустой ответ — ошибка, а не успешный обзор');
  await wait(3000);
  assert.ok(await panel.evaluate(`document.body.innerText.includes('Модель вернула пустой обзор')`));
  assert.equal(await ctx.evalMain('globalThis.insightCalls'),2);
  await ctx.evalMain('globalThis.insightEmpty = false');
  await panel.evaluate('window.aiPanel.runPageInsights()');
  await until(() => panel.evaluate(`!!document.querySelector('.page-insights-track:not(.is-stale)')`), 'Повтор после пустого ответа даёт карточки вместо кэша ошибки');
  assert.equal(await ctx.evalMain('globalThis.insightCalls'),3);
  panel.close(); page.close();
},{main:true});
