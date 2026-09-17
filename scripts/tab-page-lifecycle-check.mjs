// Порядок и гварды событий страницы: перенос вкладки, split, инкогнито, fullscreen.
// Запуск после сборки: npm test -- tab-page-lifecycle
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { wireTabPageLifecycle } = require('../dist-electron/electron/tabPageLifecycle.js');

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(` ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

class FakePage extends EventEmitter {
  url = 'https://example.test/a';
  _oblakoFavicon;
  getURL() { return this.url; }
  getTitle() { return 'Заголовок'; }
  isDestroyed() { return false; }
}
class FakeWindow extends EventEmitter {
  full = false;
  isDestroyed() { return false; }
  isFullScreen() { return this.full; }
  setFullScreen(value) { this.full = value; }
}
const wc = new FakePage();
const win = new FakeWindow();
const calls = [];
let owned = true;
let firstLoaded = false;
let active = true;
let inSplit = false;
let shownPartner = false;
let privateTab = false;
let fullscreenId = null;
const hit = (name) => (...args) => calls.push([name, ...args]);
const host = {
  win,
  mine: () => owned,
  notify: hit('notify'),
  focusedSplitSide: () => 'right',
  focusSplitPanel: hit('focus-panel'),
  onContentFocus: hit('content-focus'),
  firstTabLoaded: () => firstLoaded,
  markFirstTabLoaded: () => { firstLoaded = true; calls.push(['first-load']); },
  clearError: hit('clear-error'),
  clearAiTitle: hit('clear-title'),
  isActive: () => active,
  splitState: () => ({ inSplit, shownPartner }),
  clearFind: hit('clear-find'),
  touch: hit('touch'),
  reveal: hit('reveal'),
  incognito: () => privateTab,
  onNavigate: (url) => calls.push(['visit', url]),
  onRuleNavigate: (url) => calls.push(['rule', url]),
  getFullscreenTabId: () => fullscreenId,
  setFullscreenTabId: (id) => { fullscreenId = id; calls.push(['fullscreen-id', id]); },
  repositionViews: hit('reposition'),
  onTitleUpdate: (_url, title) => calls.push(['title', title]),
  cacheFavicon: (_page, url) => calls.push(['favicon-cache', url]),
  markAudio: hit('audio'),
  onFindResult: (result) => calls.push(['find', result]),
};
wireTabPageLifecycle('tab-a', wc, host);

wc.emit('focus');
check('фокус выбирает панель до уведомления контента', calls.splice(0), [['focus-panel', 'right'], ['content-focus']]);
wc.emit('did-finish-load');
wc.emit('did-finish-load');
check('первая загрузка отмечается один раз', calls.splice(0), [['first-load']]);
wc.emit('did-start-loading');
check('ошибка снимается до уведомления', calls.splice(0), [['clear-error'], ['notify']]);
wc.emit('did-navigate');
check('активная навигация сохраняет порядок эффектов', calls.splice(0), [
  ['clear-title'], ['clear-find'], ['touch'], ['reveal'],
  ['visit', wc.url], ['rule', wc.url], ['notify'],
]);

active = false; inSplit = true; shownPartner = false;
wc.emit('did-navigate');
check('припаркованная пара не поднимает вью', calls.splice(0), [
  ['clear-title'], ['touch'], ['visit', wc.url], ['rule', wc.url], ['notify'],
]);
shownPartner = true; privateTab = true;
wc.emit('did-navigate');
check('показанный split-партнёр виден, инкогнито не пишет визит', calls.splice(0), [
  ['clear-title'], ['touch'], ['reveal'], ['rule', wc.url], ['notify'],
]);

wc.emit('enter-html-full-screen');
check('fullscreen ждёт событие окна перед раскладкой', calls.splice(0), [['fullscreen-id', 'tab-a']]);
win.emit('enter-full-screen');
check('после разворота окна вью переставлена', calls.splice(0), [['reposition']]);
wc.emit('leave-html-full-screen');
win.emit('leave-full-screen');
check('выход из fullscreen сбрасывает вкладку и вью', calls.splice(0), [['fullscreen-id', null], ['reposition']]);

wc.emit('page-favicon-updated', {}, []);
check('пустой favicon не стирает прежний', calls.splice(0), []);
wc.emit('page-favicon-updated', {}, ['https://example.test/favicon.ico']);
check('favicon обновляется до кэширования', calls.splice(0), [['notify'], ['favicon-cache', 'https://example.test/favicon.ico']]);
wc.emit('audio-state-changed', { audible: true });
wc.emit('found-in-page', {}, { activeMatchOrdinal: 2, matches: 5 });
check('звук и результат поиска доставлены', calls.splice(0), [['audio'], ['notify'], ['find', { activeMatch: 2, count: 5 }]]);

owned = false;
wc.emit('focus');
wc.emit('did-navigate');
wc.emit('found-in-page', {}, { activeMatchOrdinal: 1, matches: 1 });
check('старый владелец после переноса не получает события', calls.splice(0), []);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
