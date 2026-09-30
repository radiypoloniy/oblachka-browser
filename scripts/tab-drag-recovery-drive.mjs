// Проверяет, что отпускание на странице и новое нажатие закрывают жест на пустом профиле.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const url = ctx.echoUrl('/tab-drag-recovery');
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`);
  await wait(300);
  const pageId = await ctx.evalMain(`process.mainModule.require('electron').webContents
    .getAllWebContents().find((wc) => wc.getURL() === ${JSON.stringify(url)})?.id`);
  assert.ok(pageId, 'страница не появилась в main');

  const received = () => ctx.chrome.evaluate('window.__dragFinishedResults || []');
  await ctx.chrome.evaluate(`window.__dragFinishedResults = [];
    window.oblako.onTabDragFinished((result) => window.__dragFinishedResults.push(result))`);
  const emit = (type) => ctx.evalMain(`process.mainModule.require('electron').webContents
    .fromId(${pageId})?.emit('input-event', {}, { type: ${JSON.stringify(type)}, button: 'left' })`);

  await ctx.chrome.evaluate("window.oblako.tabDragStart({ title: 'test', favicon: null })");
  await emit('mouseUp');
  await wait(550);
  assert.equal((await received()).length, 1, 'mouseUp страницы не закрыл жест страховкой');
  assert.equal((await ctx.chrome.evaluate('window.oblako.tabDragEnd()')).zone, null,
    'после отпускания остался активный жест');

  await ctx.chrome.evaluate("window.oblako.tabDragStart({ title: 'test', favicon: null })");
  await emit('mouseDown');
  await wait(80);
  const results = await received();
  assert.equal(results.length, 2, 'новое нажатие не отменило прошлый жест сразу');
  assert.equal(results[1].zone, null, 'новое нажатие не должно создавать split');
  assert.equal((await ctx.chrome.evaluate('window.oblako.tabDragEnd()')).zone, null,
    'после нового нажатия остался активный жест');
  console.log('ok tab drag recovery: page mouseUp and next mouseDown end the gesture');
}, { main: true });
