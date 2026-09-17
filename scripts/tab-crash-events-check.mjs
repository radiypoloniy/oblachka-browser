// Гварды ошибок и уничтожения WebContents: не ломать закрытие окна и перенос вкладки.
// Запуск после сборки: npm test -- tab-crash-events
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { wireTabCrashEvents } = require('../dist-electron/electron/tabCrashEvents.js');

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(` ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

class FakePage extends EventEmitter {
  url = 'https://example.test/page';
  getURL() { return this.url; }
  fail(code, validatedURL = this.url, mainFrame = true) {
    this.emit('did-fail-load', {}, code, 'failed', validatedURL, mainFrame);
  }
}
const wc = new FakePage();
const calls = [];
let owned = true;
let windowDestroyed = false;
let viewCurrent = true;
let online = false;
const host = {
  mine: () => owned,
  notify: () => calls.push('notify'),
  onZoom: (direction) => calls.push(['zoom', direction]),
  isOnline: () => online,
  isRussianCaCandidate: (hostname) => hostname === 'bank.test',
  reportError: (error) => calls.push(['error', error]),
  windowDestroyed: () => windowDestroyed,
  viewStillCurrent: () => viewCurrent,
  closeTab: () => calls.push('close'),
};
wireTabCrashEvents(wc, host);
check('четыре события подписаны', ['zoom-changed', 'did-fail-load', 'destroyed', 'render-process-gone'].map((e) => wc.listenerCount(e)), [1, 1, 1, 1]);

const zoomEvent = { prevented: false, preventDefault() { this.prevented = true; } };
wc.emit('zoom-changed', zoomEvent, 'in');
check('нативный зум отменён, браузерный вызван', [zoomEvent.prevented, calls.splice(0)], [true, [['zoom', 'in']]]);
wc.fail(-3);
wc.fail(-105, wc.url, false);
check('ERR_ABORTED и ошибка подфрейма игнорируются', calls.splice(0), []);
wc.fail(-105);
check('ошибка снимала статус сети в момент события', calls.splice(0), [
  ['error', { type: 'load', code: -105, url: wc.url, offline: true, russianCa: false }], 'notify',
]);
online = true;
wc.url = 'https://bank.test/';
wc.fail(-202);
check('специальный сертификат отмечен лишь при нужном коде', calls.splice(0), [
  ['error', { type: 'load', code: -202, url: wc.url, offline: false, russianCa: true }], 'notify',
]);

windowDestroyed = true;
wc.emit('destroyed');
check('при выходе из приложения вкладка не закрывается повторно', calls.splice(0), []);
windowDestroyed = false; viewCurrent = false;
wc.emit('destroyed');
check('старая вью после сна не закрывает вкладку', calls.splice(0), []);
viewCurrent = true;
wc.emit('destroyed');
check('самозакрытие текущей вью убирает вкладку', calls.splice(0), ['close']);

owned = false;
wc.fail(-105);
wc.emit('destroyed');
check('старый владелец после переноса не обрабатывает сбой и закрытие', calls.splice(0), []);
wc.emit('render-process-gone');
check('проводка краша сохраняет исходное отсутствие mine-гарда', calls.splice(0), [
  ['error', { type: 'crash', code: 0, url: wc.url, offline: false }], 'notify',
]);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
