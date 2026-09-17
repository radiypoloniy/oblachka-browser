// Контракт поискового адаптера: последовательность вызовов Chromium и финальный requestId.
// Запуск: npm test -- tab-find
import { EventEmitter } from 'node:events';
import { startPageFind, findQuoteInWebContents } from '../electron/tabFind.ts';

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(` ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

class FakeWebContents extends EventEmitter {
  calls = [];
  nextId = 0;
  stopCount = 0;
  findInPage(query, options) {
    const requestId = ++this.nextId;
    this.calls.push({ query, ...options });
    if (options.findNext) queueMicrotask(() => {
      // Промежуточное событие не должно завершать поиск цитаты.
      this.emit('found-in-page', {}, { requestId, finalUpdate: false, matches: 99 });
      this.emit('found-in-page', {}, { requestId, finalUpdate: true, matches: query === 'нашлось' ? 2 : 0 });
    });
    return requestId;
  }
  stopFindInPage() { this.stopCount++; }
}

const wc = new FakeWebContents();
startPageFind(wc, 'запрос', '', true);
check('новый поиск вызывает старт и ответный проход', wc.calls, [
  { query: 'запрос', forward: true, findNext: false },
  { query: 'запрос', forward: true, findNext: true },
]);
wc.calls = [];
startPageFind(wc, 'запрос', 'запрос', false);
check('повторный поиск делает один обратный проход', wc.calls, [
  { query: 'запрос', forward: false, findNext: true },
]);

wc.calls = [];
const found = await findQuoteInWebContents(wc, ['мимо', 'нашлось', 'не проверять']);
check('цитата переходит к следующему кандидату и берёт финальное число', found,
  { matches: 2, query: 'нашлось' });
check('после совпадения третий кандидат не ищется', wc.calls.map((c) => c.query),
  ['мимо', 'мимо', 'нашлось', 'нашлось']);
check('временный слушатель результата снят', wc.listenerCount('found-in-page'), 0);

const absent = await findQuoteInWebContents(wc, ['мимо']);
check('отсутствие совпадений возвращает пустой запрос', absent, { matches: 0, query: '' });
check('при отсутствии совпадений старая подсветка снята', wc.stopCount, 1);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
