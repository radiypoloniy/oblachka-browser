// Проводка запрета схем: оба события, URL самой страницы и независимость от владельца вкладки.
// Запуск после сборки: npm test -- tab-navigation-guard
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { wireTabNavigationGuard } = require('../dist-electron/electron/tabNavigationGuard.js');

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++; else failed++;
  console.log(` ${ok ? 'ok  ' : 'FAIL'} ${label}`);
}

class FakeWebContents extends EventEmitter {
  url = 'https://example.com/';
  getURL() { return this.url; }
  navigate(kind, target) {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    this.emit(kind, event, target);
    return event.prevented;
  }
}

const wc = new FakeWebContents();
wireTabNavigationGuard(wc);
check('обычная навигация подписана', wc.listenerCount('will-navigate'), 1);
check('серверный редирект подписан отдельно', wc.listenerCount('will-redirect'), 1);
const warn = console.warn;
console.warn = () => {}; // ожидаемые запреты не засоряют вывод теста
try {
  check('обычный адрес разрешён', wc.navigate('will-navigate', 'https://example.org/'), false);
  check('привилегированная схема заблокирована', wc.navigate('will-navigate', 'oblako-chrome://localhost/index.html'), true);
  check('редирект на привилегированную схему заблокирован', wc.navigate('will-redirect', 'oblako-model://model'), true);
  wc.url = 'file:///C:/docs/start.html'; // после переноса вкладки хук остаётся на её WebContents
  check('переход между локальными файлами разрешён', wc.navigate('will-navigate', 'file:///C:/docs/next.html'), false);
  wc.url = 'https://example.com/';
  check('сайт не может перейти к локальному файлу', wc.navigate('will-navigate', 'file:///C:/docs/next.html'), true);
} finally {
  console.warn = warn;
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
