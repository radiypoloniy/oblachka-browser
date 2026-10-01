// Живой IPC/React/main на пустом профиле. Провайдер подменён: ни платных запросов, ни загрузки GGUF.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  const until = async (predicate, label, timeout = 16000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await predicate()) { console.log('ok', label); return; } await wait(200); }
    throw new Error(label + ': ' + JSON.stringify(await panel.evaluate('document.body.innerText')));
  };
  await until(() => panel.evaluate(`(document.body?.innerText || '').includes('Подключите модель')`), 'Без модели — предложение подключить');
  await ctx.evalMain(String.raw`(() => {
    const req = process.mainModule.require, root = req('electron').app.getAppPath();
    const mod = name => req(req('path').join(root,'dist-electron/electron',name));
    globalThis.insightCalls = 0; globalThis.insightDelay = 0;
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
        const fragments = [...prompt.matchAll(/^\[(\d+)\] (.+)$/gm)];
        return {cards:fragments.slice(0,7).map((f,i) => ({title:'Вывод '+(i+1),text:'Сохраните документы заранее.',kind:'Условие',source:Number(f[1]),quote:f[2].slice(0,100)}))};
      }
    });
  })()`);
  await panel.evaluate(`window.aiPanel.setPageInsightsConfig({connectionId:'insight-fixture',allowRemote:false})`);
  await until(() => panel.evaluate(`(document.body?.innerText || '').includes('Разрешите фоновые')`), 'Облако требует отдельного разрешения');
  assert.equal(await ctx.evalMain('globalThis.insightCalls'), 0);
  await panel.evaluate('window.aiPanel.setPageInsightsConfig({allowRemote:true})');
  await until(() => panel.evaluate(`document.querySelectorAll('.page-insight').length === 5`), 'Максимум пять карточек');
  assert.equal(await ctx.evalMain('globalThis.insightCalls'), 1);
  assert.ok(await panel.evaluate(`(document.body?.innerText || '').includes('Скиллы') || document.body.innerText.toLowerCase().includes('скиллы')`));
  assert.ok(await panel.evaluate('!!document.querySelector("textarea")'));
  await panel.evaluate(`document.querySelector('.page-insights-menu').open = true;
    document.querySelector('.page-insights-menu summary').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await panel.evaluate(`document.querySelector('.page-insights-menu').open`), false);
  assert.equal(await ctx.evalMain(`(() => { const req=process.mainModule.require;
    return req(req('path').join(req('electron').app.getAppPath(),'dist-electron/electron/aipanel/instances.js')).allPanels().some(p=>p.open); })()`), true);
  console.log('ok Escape закрывает меню, сохраняя открытую панель');
  await panel.evaluate(`document.querySelector('[aria-label="Следующая карточка"]').click()`);
  await until(() => panel.evaluate(`document.querySelector('.page-insights-navigation > span')?.textContent === '2 / 5'`), 'Листание карточек');
  await panel.evaluate(`document.querySelector('[aria-label="Свернуть все карточки"]').click()`);
  await until(() => panel.evaluate(`!document.querySelector('.page-insights-track')`), 'Сворачивается весь блок');
  await panel.evaluate(`document.querySelector('.page-insights-title').click()`);
  await until(() => panel.evaluate(`document.querySelectorAll('.page-insight').length === 5`), 'Возвращаются все карточки');
  assert.equal(await panel.evaluate(`document.querySelector('.page-insights-navigation > span').textContent`), '2 / 5');
  assert.equal(await ctx.evalMain('globalThis.insightCalls'), 1);
  await panel.evaluate(`document.querySelector('.page-insight button').click()`);
  await until(() => page.evaluate('window.getSelection().toString().length > 20'), 'Переход к источнику');
  assert.ok(await page.evaluate('window.getSelection().toString().length < 300'));
  const shot = await panel.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('scripts/shots', { recursive: true });
  fs.writeFileSync('scripts/shots/page-insights.png', Buffer.from(shot.result.data, 'base64'));
  await page.evaluate(`document.querySelector('p').textContent += ' Срок изменился: теперь 20 дней.'`);
  await until(() => panel.evaluate(`!!document.querySelector('.is-stale')`), 'Изменённый источник помечает карточки устаревшими');
  assert.equal(await ctx.evalMain('globalThis.insightCalls'), 1);
  await panel.evaluate('window.aiPanel.runPageInsights()');
  await until(() => ctx.evalMain('globalThis.insightCalls === 2'), 'Явный повтор обходит паузу');
  await until(() => panel.evaluate(`!!document.querySelector('.page-insights-track:not(.is-stale)')`), 'Обновлённые карточки');
  await panel.evaluate('window.aiPanel.setPageInsightsConfig({dailyLimit:2})');
  await page.evaluate(`document.querySelector('p').textContent += ' Новая версия условий.'`);
  await panel.evaluate('window.aiPanel.runPageInsights()');
  await until(() => panel.evaluate(`(document.body?.innerText || '').includes('Дневной предел')`), 'Дневной предел блокирует и ручной платный повтор');
  assert.equal(await ctx.evalMain('globalThis.insightCalls'), 2);
  await panel.evaluate('window.aiPanel.setPageInsightsConfig({dailyLimit:3})');
  await ctx.evalMain('globalThis.insightDelay = 3000');
  await panel.evaluate('window.aiPanel.runPageInsights()');
  await until(() => ctx.evalMain('globalThis.insightCalls === 3'), 'Начался третий разбор');
  await panel.evaluate('window.aiPanel.setPageInsightsConfig({enabled:false})');
  await wait(3500);
  assert.equal(await panel.evaluate(`document.querySelectorAll('.page-insight').length`), 0);
  console.log('ok Выключение отменяет текущий разбор и отбрасывает поздний ответ');
  await ctx.evalMain(`(() => {
    const req=process.mainModule.require, root=req('electron').app.getAppPath();
    req(req('path').join(root,'dist-electron/electron/ModelRegistry.js')).getDefault = () => ({id:'cold-fixture',label:'Спящая локальная модель'});
  })()`);
  await panel.evaluate('window.aiPanel.setPageInsightsConfig({enabled:true,connectionId:null,allowRemote:false})');
  await until(() => panel.evaluate(`(document.body?.innerText || '').includes('Модель отдыхает')`), 'Фон не загружает холодную локальную модель');
  assert.equal(await ctx.evalMain('globalThis.insightCalls'), 3);
  await ctx.evalMain(`(() => {
    const req=process.mainModule.require, root=req('electron').app.getAppPath();
    req(req('path').join(root,'dist-electron/electron/ai/ConnectionStore.js')).upsert({id:'local-api-fixture',label:'Локальный API',kind:'openai-compatible',baseUrl:${JSON.stringify(ctx.echoUrl('/v1'))},model:'fixture',concurrency:1});
  })()`);
  await panel.evaluate(`window.aiPanel.setPageInsightsConfig({connectionId:'local-api-fixture',allowRemote:false})`);
  await until(() => panel.evaluate(`(document.body?.innerText || '').includes('Для локального API')`), 'Фон не будит внешний локальный раннер');
  assert.equal(await ctx.evalMain('globalThis.insightCalls'), 3);
  await panel.evaluate('window.aiPanel.setPageInsightsConfig({enabled:false,collapsed:true,connectionId:null})');
  await until(() => panel.evaluate(`(document.body?.innerText || '').includes('Автоподсказки выключены')`), 'Выключение из панели');
  await wait(3000);
  assert.equal(await ctx.evalMain('globalThis.insightCalls'), 3);
  const stored = JSON.parse(fs.readFileSync(path.join(ctx.profile,'page-insights.json'),'utf8'));
  assert.equal(stored.count, 3); assert.equal(stored.config.enabled, false);
  assert.equal(JSON.stringify(stored).includes('документы'), false);
  await ctx.chrome.evaluate(`window.oblako.createSpecialTab('settings','ai')`);
  await until(() => ctx.chrome.evaluate(`!!document.querySelector('[aria-label="Модель для карточек"]')`), 'Настройки карточек доступны в разделе AI');
  await ctx.chrome.evaluate(`document.querySelector('[aria-label="Модель для карточек"]').value = 'insight-fixture';
    document.querySelector('[aria-label="Модель для карточек"]').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal((await ctx.chrome.evaluate('window.oblako.pageInsightsConfig()')).connectionId, 'insight-fixture');
  await ctx.chrome.evaluate(`[...document.querySelectorAll('label')].find(n=>n.textContent.includes('Автоматически выделять главное')).querySelector('[role="switch"]').click()`);
  await until(() => panel.evaluate(`!(document.body?.innerText || '').includes('Автоподсказки выключены')`), 'Тумблер настроек синхронизируется с панелью');
  await ctx.chrome.evaluate(`window.oblako.setPageInsightsConfig({enabled:false,connectionId:null,allowRemote:false})`);
  page.close(); panel.close();
  await ctx.restart();
  const persisted = await ctx.chrome.evaluate('window.oblako.pageInsightsConfig()');
  assert.equal(persisted.enabled, false); assert.equal(persisted.collapsed, true); assert.equal(persisted.dailyLimit, 3);
  console.log('ok Настройки и счёт пережили перезапуск; текст страниц на диск не записан');
}, { main: true });
