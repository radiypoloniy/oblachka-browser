// Сборка списка подсказок омнибокса (shared/suggestList.ts) — без electron, обычным node.
//
// ⚠️ Главный случай здесь — про ВКЛАДКИ, и он из жизни. Подсказка ВСЕГДА открывает страницу,
// даже когда она уже открыта в другой вкладке: прежде исход зависел от того, похож ли набранный
// текст на адрес, и предсказать его человек не мог. Переход остался — отдельной кликабельной
// пометкой «уже открыта» (поле openTab).
//
// ⚠️ Второй по важности — порядок. «Искать в вебе» стоит СРАЗУ за героем, а не в конце: это
// всегда доступный вариант, и заставлять долистывать до него историю неправильно.
//
// Запуск: npm test -- suggest-list
import { composeSuggestions, looksLikeAddress } from '../shared/suggestList.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

const search = { kind: 'search', label: 'Искать: q', url: 'https://s/?q=q' };
const tabItem = { kind: 'tab', label: 'github.com', url: 'https://github.com', tabId: 't1', windowId: 'w1' };
const histItem = { kind: 'history', label: 'habr.com', url: 'https://habr.com' };
const phrase = { kind: 'suggest', label: 'фраза', url: 'https://s/?q=фраза' };

const base = { searchItem: search, restItems: [], suggestItems: [], query: 'q', engineName: 'Google' };

console.log('\n— порядок секций —');
{
  const out = composeSuggestions({ ...base, topItem: histItem, restItems: [tabItem], suggestItems: [phrase] });
  check('герой первый, поиск сразу за ним', out.slice(0, 2).map((i) => i.kind), ['history', 'search']);
  // Вкладка приходит сюда как навигация с пометкой — см. раздел про вкладки ниже.
  check('дальше история и вкладки, потом подсказки', out.slice(2).map((i) => i.kind), ['history', 'suggest']);
  check('без героя список начинается с поиска',
    composeSuggestions({ ...base, suggestItems: [phrase] }).map((i) => i.kind), ['search', 'suggest']);
  check('без героя остальные совпадения не показываются вовсе',
    composeSuggestions({ ...base, restItems: [tabItem] }).map((i) => i.kind), ['search']);
}

console.log('\n— подписи секций —');
{
  const out = composeSuggestions({
    ...base, topItem: histItem, restItems: [tabItem, histItem], suggestItems: [phrase, phrase],
  });
  check('у героя подписи нет', out[0].sectionHeader, undefined);
  check('у «искать» подписи нет', out[1].sectionHeader, undefined);
  check('подпись на первом из истории', out[2].sectionHeader, 'История и вкладки');
  check('на втором из истории подписи нет', out[3].sectionHeader, undefined);
  check('подпись на первой живой подсказке', out[4].sectionHeader, 'Предложения Google');
  check('на второй подписи нет', out[5].sectionHeader, undefined);
  check('имя движка подставляется',
    composeSuggestions({ ...base, suggestItems: [phrase], engineName: 'DuckDuckGo' })[1].sectionHeader,
    'Предложения DuckDuckGo');
}

console.log('\n— вкладка: всегда дубль, переход отдельной пометкой —');
{
  // ⚠️ Прежде исход зависел от того, похож ли текст на адрес: адрес открывал дублем, имя
  // телепортировало к старой вкладке. Разницу приходилось угадывать, и она удивляла ровно тогда,
  // когда человек её не ждал.
  for (const query of ['github.com', 'гитхаб', 'GitHub проект']) {
    const out = composeSuggestions({ ...base, topItem: histItem, restItems: [tabItem], query });
    const row = out.find((i) => i.url === 'https://github.com');
    check(`«${query}» — строка открывает страницу`, row.kind, 'history');
    check(`«${query}» — привязки к вкладке в основном действии нет`, [row.tabId, row.windowId], [undefined, undefined]);
    check(`«${query}» — но пометка «уже открыта» есть`, row.openTab, { tabId: 't1', windowId: 'w1' });
  }

  const plain = composeSuggestions({ ...base, topItem: histItem, restItems: [{ ...histItem, url: 'https://x.dev' }] });
  check('у строки без открытой вкладки пометки нет', plain[2].openTab, undefined);

  // Смысловой поиск вкладок добавляет строки МИМО этой функции — там переключение основное,
  // и такие строки остаются как есть.
  check('вкладка без tabId не превращается в навигацию',
    composeSuggestions({ ...base, topItem: { kind: 'tab', label: 'x', url: 'https://x' } })[0].kind, 'tab');

  check('двоеточие тоже адрес (localhost:3000)', looksLikeAddress('localhost:3000'), true);
  check('обычные слова — не адрес', looksLikeAddress('как дела'), false);
  check('пробелы по краям не мешают', looksLikeAddress('  ozon.ru  '), true);
}

console.log('\n— вход не мутируется —');
{
  const rest = [{ ...tabItem }];
  const suggests = [{ ...phrase }];
  composeSuggestions({ ...base, topItem: histItem, restItems: rest, suggestItems: suggests, query: 'ozon.ru' });
  check('исходные элементы не получили подписи', [rest[0].sectionHeader, suggests[0].sectionHeader], [undefined, undefined]);
  check('исходная вкладка не переписана на месте', [rest[0].kind, rest[0].openTab], ['tab', undefined]);
}

console.log('\n— пустые части —');
{
  check('только поиск', composeSuggestions(base).map((i) => i.kind), ['search']);
  check('герой без всего', composeSuggestions({ ...base, topItem: histItem }).map((i) => i.kind), ['history', 'search']);
}

console.log(`\nИтого: ${passed} ок, ${failed} провалено\n`);
process.exit(failed === 0 ? 0 : 1);
