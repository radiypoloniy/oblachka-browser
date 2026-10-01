// Действия настоящего меню против СКМ: фокус, приватность и возврат к исходной вкладке.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  const url = ctx.echoUrl('/links'), target = ctx.echoUrl('/a');
  const source = await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`);
  const main = async code => {
    const expression = `(async () => {
    const req = process.mainModule.require, root = req('electron').app.getAppPath();
    const tabs = req(req('path').join(root, 'dist-electron/electron/WindowRegistry.js')).mainContext().tabs;
    const wc = tabs.getWebContentsForTab(${JSON.stringify(source)});
    ${code}
  })()`;
    const response = await ctx.main.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.error || response.result?.exceptionDetails) throw new Error(JSON.stringify(response));
    return response.result?.result?.value;
  };
  await wait(600);
  const menuClick = (label, params, tabId = source) => main(`const { Menu } = req('electron'), original = Menu.buildFromTemplate;
    const menuWc = tabs.getWebContentsForTab(${JSON.stringify(tabId)});
    let items, nested = false;
    Menu.buildFromTemplate = rows => {
      if (nested) return original.call(Menu, rows);
      nested = true; try { original.call(Menu, rows); } finally { nested = false; }
      items = rows; return { popup() {} };
    };
    try { menuWc.emit('context-menu', {}, { x: 30, y: 30, linkURL: '', srcURL: '', mediaType: 'none',
      selectionText: '', isEditable: false, dictionarySuggestions: [], ...${JSON.stringify(params)} }); }
    finally { Menu.buildFromTemplate = original; }
    const item = items.find(i => i.label === ${JSON.stringify(label)});
    if (!item) throw new Error('Пункт меню отсутствует'); item.click();
    for (let i = 0; i < 50; i++) {
      const active = tabs.snapshot().find(t => t.id === tabs.getActiveId());
      if (active?.url && !active.isLoading) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return tabs.snapshot().find(t => t.id === tabs.getActiveId());`);
  const link = await menuClick('Открыть ссылку в новой вкладке', { linkURL: target });
  assert.equal(link.url, target); assert.notEqual(link.id, source);
  await ctx.chrome.evaluate(`window.oblako.closeTab(${JSON.stringify(link.id)})`);
  assert.equal(await main('return tabs.getActiveId();'), source);
  const image = await menuClick('Открыть картинку в новой вкладке', { mediaType: 'image', srcURL: ctx.echoUrl('/image.png') });
  assert.equal(image.url, ctx.echoUrl('/image.png'));
  await ctx.chrome.evaluate(`window.oblako.closeTab(${JSON.stringify(image.id)})`);
  await main(`tabs.activate(${JSON.stringify(source)}); wc.focus();
    const r = await wc.executeJavaScript("JSON.stringify(document.querySelector('a').getBoundingClientRect().toJSON())");
    const rect = JSON.parse(r), x = Math.round(rect.x + 5), y = Math.round(rect.y + 5);
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'middle', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'middle', clickCount: 1 }); return true;`);
  await wait(500);
  assert.equal(await main('return tabs.getActiveId();'), source);
  assert.equal(await main(`return tabs.snapshot().some(t => t.url === ${JSON.stringify(target)} && t.id !== ${JSON.stringify(source)});`), true);
  const privateSource = await main(`return tabs.createTab(${JSON.stringify(url)}, false, false, true);`);
  await wait(500);
  const privateLink = await menuClick('Открыть ссылку в новой вкладке', { linkURL: target }, privateSource);
  assert.equal(privateLink.url, target); assert.equal(privateLink.incognito, true);
  console.log('ok ПКМ ссылки и картинки переводит на новую вкладку; закрытие возвращает к источнику; СКМ открывает в фоне');
  console.log('ok Новая вкладка наследует приватность источника');
}, { main: true });
