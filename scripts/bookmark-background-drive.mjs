// Живые нажатия СКМ через CDP: проверяем весь путь UI → preload → IPC → TabManager.
// Только временный профиль стенда; реальные закладки и сессия не открываются.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ({ chrome, echoUrl }) => {
  const evaluate = (expression) => chrome.evaluate(expression);
  await wait(1200);
  await evaluate(`(async () => {
    await window.oblako.createTab(${JSON.stringify(echoUrl('/active'))});
    await window.oblako.addBookmark(${JSON.stringify(echoUrl('/first'))}, 'СКМ первая');
    await window.oblako.addBookmark(${JSON.stringify(echoUrl('/second'))}, 'СКМ вторая');
    const folder = await window.oblako.createBookmarkFolder('Папка стенда', null);
    const nested = await window.oblako.addBookmark(${JSON.stringify(echoUrl('/nested'))}, 'СКМ вложенная');
    await window.oblako.moveBookmark(nested.id, folder.id);
  })()`);
  const click = async (text, button = 'left') => {
    const rect = await evaluate(`(() => {
      const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
      if (!el) throw Error('Не найдена кнопка: ' + ${JSON.stringify(text)});
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button, buttons: button === 'middle' ? 4 : 1, clickCount: 1 });
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button, buttons: 0, clickCount: 1 });
    await wait(180);
  };
  const tabs = () => evaluate('window.oblako.getAllTabs()');
  const initial = await tabs();
  const activeId = initial.find(t => t.isActive)?.id;
  assert.ok(activeId);
  await click('Закладки');
  await click('СКМ первая', 'middle');
  await click('СКМ вторая', 'middle');
  const after = await tabs();
  assert.equal(after.length, initial.length + 2);
  assert.equal(after.find(t => t.isActive)?.id, activeId);
  assert.match(await evaluate('document.querySelector("[role=status]").textContent'), /Открыто в фоне: 2/);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".oblako-bookmark-confirm")).animationName'), 'oblako-bookmark-confirm');
  await wait(300);
  await click('СКМ первая', 'middle');
  assert.equal((await tabs()).length, initial.length + 3);
  await click('Папка стенда');
  await click('СКМ вложенная', 'middle');
  assert.equal((await tabs()).length, initial.length + 4);
  assert.equal((await tabs()).find(t => t.isActive)?.id, activeId);
  await wait(3100);
  assert.match(await evaluate('document.querySelector("[role=status]").textContent'), /СКМ по закладке/);
  await click('СКМ вложенная');
  const foreground = await tabs();
  assert.equal(foreground.length, initial.length + 5);
  assert.notEqual(foreground.find(t => t.isActive)?.id, activeId);
  assert.equal(foreground.find(t => t.isActive)?.id, foreground.at(-1)?.id);
  assert.ok(foreground.find(t => t.isActive)?.url.endsWith('/nested'));
  assert.equal(await evaluate('[...document.querySelectorAll("[role=status]")].some(el => el.textContent.includes("СКМ по закладке"))'), false);
  console.log('OK: СКМ, серия закладок, повторное открытие, вложенная папка, анимация, сброс подтверждения и ЛКМ.');
});
