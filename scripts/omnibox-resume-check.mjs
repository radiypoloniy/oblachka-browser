// Сборка панели омнибокса: стек закрытых, строки «Продолжить», одна полка.
import { pushClosed, popClosed, peekClosed, CLOSED_STACK_MAX } from '../shared/closedTabStack.ts';
import { pickResume, formatClosedAgo, mergeOmniboxShelf, RESUME_MAX, SHELF_MAX } from '../shared/omniboxResume.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const T = (url, title, closedAt) => ({ url, title, closedAt });
const NOW = 1_800_000_000_000;

console.log('\n— стек закрытых —');
let stack = [];
stack = pushClosed(stack, T('https://habr.com/a', 'A', 1));
stack = pushClosed(stack, T('ftp://x', 'no', 2));
check('не-http в стек не идёт', stack.length, 1);
stack = pushClosed(stack, T('https://github.com/b', 'B', 3));
check('peek — свежие первыми', peekClosed(stack).map((t) => t.url), ['https://github.com/b', 'https://habr.com/a']);
const popped = popClosed(stack);
check('pop снимает последнюю, как Ctrl+Shift+T', popped.tab.url, 'https://github.com/b');
check('после pop остаётся предыдущая', popped.rest.map((t) => t.url), ['https://habr.com/a']);

let filled = [];
for (let i = 0; i < CLOSED_STACK_MAX + 3; i++) {
  filled = pushClosed(filled, T(`https://ex.com/${i}`, String(i), i));
}
check('потолок стека', filled.length, CLOSED_STACK_MAX);
check('вытесняется самая старая', filled[0].url, 'https://ex.com/3');

console.log('\n— время закрытия, литералы порогов —');
check('меньше минуты', formatClosedAgo(NOW, NOW - 59_000), 'только что');
check('ровно минута', formatClosedAgo(NOW, NOW - 60_000), '1 мин назад');
check('двадцать минут', formatClosedAgo(NOW, NOW - 20 * 60_000), '20 мин назад');
check('час', formatClosedAgo(NOW, NOW - 60 * 60_000), '1 ч назад');
check('вчера', formatClosedAgo(NOW, NOW - 24 * 60 * 60_000), 'вчера');
check('трое суток', formatClosedAgo(NOW, NOW - 3 * 24 * 60 * 60_000), '3 дн. назад');

console.log('\n— три строки «продолжить» —');
// Две закрытые — третье место остаётся вкладке чужого окна. Три закрытые съели бы потолок.
const peeked = peekClosed([
  T('https://ozon.ru/cart', 'Корзина', NOW - 20 * 60_000),
  T('https://habr.com/a', 'Habr', NOW - 120_000),
]);
const other = [{
  tabId: 't1', windowId: 2, title: 'Issue', url: 'https://github.com/llama', windowLabel: 'окно 2',
}];
const rows = pickResume(peeked, other, 'https://habr.com/now', NOW);
check('потолок трёх', rows.length, RESUME_MAX);
check('текущую страницу не предлагаем, закрытые раньше чужого окна', rows.map((r) => r.url), [
  'https://habr.com/a', 'https://ozon.ru/cart', 'https://github.com/llama',
]);
check('время на закрытой', rows[0].meta, '2 мин назад');
check('окно — тег', rows[2].tagged, true);
check('окно — подпись', rows[2].meta, 'окно 2');

const skipCur = pickResume(
  peekClosed([T('https://habr.com/now', 'Эта', NOW - 1000)]),
  [],
  'https://habr.com/now',
  NOW,
);
check('закрытая текущая страница выбрасывается', skipCur, []);

console.log('\n— полка —');
const freq = [
  { url: 'https://habr.com/', title: 'habr' },
  { url: 'https://youtube.com/', title: 'youtube' },
  { url: 'https://github.com/', title: 'github' },
];
check('без кастома — только частые', mergeOmniboxShelf(null, freq).map((s) => s.title), ['habr', 'youtube', 'github']);
check('пустой кастом не подсовывает дефолт, частые остаются', mergeOmniboxShelf([], freq).map((s) => s.title), ['habr', 'youtube', 'github']);
const custom = [
  { url: 'https://figma.com/', title: 'figma' },
  { url: 'https://habr.com/ru', title: 'habr-pin' },
];
check('кастом первыми, тот же origin из частых не дублируется', mergeOmniboxShelf(custom, freq).map((s) => s.title), [
  'figma', 'habr-pin', 'youtube', 'github',
]);
const many = Array.from({ length: 12 }, (_, i) => ({ url: `https://s${i}.com/`, title: `s${i}` }));
check('потолок полки', mergeOmniboxShelf(null, many).length, SHELF_MAX);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
