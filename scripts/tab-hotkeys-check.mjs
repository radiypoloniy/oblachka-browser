// Маршрутизация клавиш в main: приоритет Esc, chrome/page и перенос вкладки.
// Запуск после сборки: npm test -- tab-hotkeys
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { wireTabHotkeys } = require('../dist-electron/electron/tabHotkeys.js');

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(` ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

class FakeWebContents extends EventEmitter {
  id = 17;
  mainFrame = { origin: 'https://site.test' };
  focusedFrame = this.mainFrame;
  key(code, opts = {}) {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    this.emit('before-input-event', event, { type: 'keyDown', code, control: false, shift: false, alt: false, ...opts });
    return event.prevented;
  }
}
const wc = new FakeWebContents();
const calls = [];
let owned = true;
let screenshotOpen = false;
let findBarOpen = false;
let omniboxEditing = false;
let activePage = { stop: () => calls.push('stop') };
const host = {
  ownsWebContents: () => owned,
  screenshotOpen: () => screenshotOpen,
  closeScreenshot: () => { screenshotOpen = false; calls.push('closeScreenshot'); },
  findBarOpen: () => findBarOpen,
  closeFind: () => { findBarOpen = false; calls.push('closeFind'); },
  omniboxEditing: () => omniboxEditing,
  activeWebContents: () => activePage,
};
for (const name of [
  'openTaskManager', 'reload', 'toggleDevTools', 'goBack', 'goForward', 'openHub',
  'reopenLastClosedTab', 'openNewWindow', 'newIncognitoTab', 'returnActiveTab',
  'closeActiveTab', 'selectNext', 'selectPrev', 'zoomIn', 'zoomOut', 'resetZoom',
  'openFind', 'quickSearch', 'openHistory', 'bookmarkPage', 'reloadHard',
  'focusOmnibox', 'captureScreenshot', 'saveScreenshot', 'openBookmarks', 'toggleClipboard',
]) host[name] = () => calls.push(name);
host.runPageHotkey = (action) => calls.push(['page', action]);
host.selectByIndex = (index) => calls.push(['index', index]);
wireTabHotkeys(wc, 'tab', host);

screenshotOpen = true; findBarOpen = true;
check('Esc сперва закрывает карточку снимка', [wc.key('Escape'), calls.splice(0)], [true, ['closeScreenshot']]);
check('второй Esc закрывает FindBar', [wc.key('Escape'), calls.splice(0)], [true, ['closeFind']]);
omniboxEditing = true;
check('Esc в омнибоксе остаётся React', [wc.key('Escape'), calls.splice(0)], [false, []]);
omniboxEditing = false;
check('Esc без оверлея останавливает страницу', [wc.key('Escape'), calls.splice(0)], [true, ['stop']]);
check('Shift+Esc открывает диспетчер', [wc.key('Escape', { shift: true }), calls.splice(0)], [true, ['openTaskManager']]);
check('F5 обновляет, Ctrl+F5 — без кэша',
  [wc.key('F5'), wc.key('F5', { control: true }), calls.splice(0)], [true, true, ['reload', 'reloadHard']]);
check('Alt+стрелки ходят по истории',
  [wc.key('ArrowLeft', { alt: true }), wc.key('ArrowRight', { alt: true }), calls.splice(0)],
  [true, true, ['goBack', 'goForward']]);
check('базовые сочетания вкладок сохраняются',
  [wc.key('KeyT', { control: true }), wc.key('KeyW', { control: true }), wc.key('Tab', { control: true, shift: true }), calls.splice(0)],
  [true, true, true, ['openHub', 'closeActiveTab', 'selectPrev']]);
check('Ctrl+1 и Ctrl+9 выбирают по индексу',
  [wc.key('Digit1', { control: true }), wc.key('Digit9', { control: true }), calls.splice(0)],
  [true, true, [['index', 1], ['index', 9]]]);
check('Ctrl+S без карточки остаётся странице', [wc.key('KeyS', { control: true }), calls.splice(0)], [false, []]);
screenshotOpen = true;
check('Ctrl+S с карточкой сохраняет снимок', [wc.key('KeyS', { control: true }), calls.splice(0)], [true, ['saveScreenshot']]);
screenshotOpen = false;

check('Ctrl+F в главном кадре принадлежит странице', [wc.key('KeyF', { control: true }), calls.splice(0)], [false, []]);
wc.focusedFrame = { origin: 'https://site.test', parent: wc.mainFrame };
check('Ctrl+F в iframe своего origin тоже остаётся странице', [wc.key('KeyF', { control: true }), calls.splice(0)], [false, []]);
wc.focusedFrame = { origin: 'https://other.test', parent: wc.mainFrame };
check('Ctrl+F из чужого iframe подхватывает браузер', [wc.key('KeyF', { control: true }), calls.splice(0)],
  [true, [['page', 'find']]]);
owned = false;
check('старый владелец вкладки не реагирует после переноса', [wc.key('KeyW', { control: true }), calls.splice(0)], [false, []]);

const chrome = new FakeWebContents();
wireTabHotkeys(chrome, 'chrome', host);
check('chrome обрабатывает спорные клавиши сам',
  [chrome.key('KeyF', { control: true }), chrome.key('KeyD', { control: true }), calls.splice(0)],
  [true, true, ['openFind', 'bookmarkPage']]);
check('chrome не зависит от владельца guest-вкладки', [chrome.key('KeyT', { control: true }), calls.splice(0)],
  [true, ['openHub']]);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
