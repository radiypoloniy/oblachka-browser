// Сборка списка подсказок омнибокса (shared/suggestList.ts) — без electron, обычным node.
//
// ⚠️ Главный случай здесь — про ВКЛАДКИ, и он из жизни. Набранный адрес, совпавший с открытой
// вкладкой, давал первой подсказкой «перейти на вкладку»: человек вводил адрес, чтобы ОТКРЫТЬ
// страницу, а его перекидывало на старую вкладку. Живая жалоба звучала как «неудобно, хочу
// дубль». Для запросов-имён переключение, наоборот, удобно — и должно остаться.
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
  check('дальше история и вкладки, потом подсказки', out.slice(2).map((i) => i.kind), ['tab', 'suggest']);
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

console.log('\n— тот самый случай: адрес против имени —');
{
  const typedAddress = composeSuggestions({ ...base, topItem: histItem, restItems: [tabItem], query: 'github.com' });
  const asTab = typedAddress.find((i) => i.url === 'https://github.com');
  check('набран адрес — вкладка становится обычной навигацией', asTab.kind, 'history');
  check('и теряет привязку к вкладке', [asTab.tabId, asTab.windowId], [undefined, undefined]);

  const typedName = composeSuggestions({ ...base, topItem: histItem, restItems: [tabItem], query: 'гитхаб' });
  const stillTab = typedName.find((i) => i.url === 'https://github.com');
  check('набрано имя — переключение на вкладку остаётся', stillTab.kind, 'tab');
  check('привязка цела', stillTab.tabId, 't1');

  check('двоеточие тоже адрес (localhost:3000)', looksLikeAddress('localhost:3000'), true);
  check('точка в конце фразы — увы, тоже адрес', looksLikeAddress('что это.'), true);
  check('обычные слова — не адрес', looksLikeAddress('как дела'), false);
  check('пробелы по краям не мешают', looksLikeAddress('  ozon.ru  '), true);
}

console.log('\n— вход не мутируется —');
{
  const rest = [{ ...tabItem }];
  const suggests = [{ ...phrase }];
  composeSuggestions({ ...base, topItem: histItem, restItems: rest, suggestItems: suggests, query: 'ozon.ru' });
  check('исходные элементы не получили подписи', [rest[0].sectionHeader, suggests[0].sectionHeader], [undefined, undefined]);
  check('исходная вкладка осталась вкладкой', rest[0].kind, 'tab');
}

console.log('\n— пустые части —');
{
  check('только поиск', composeSuggestions(base).map((i) => i.kind), ['search']);
  check('герой без всего', composeSuggestions({ ...base, topItem: histItem }).map((i) => i.kind), ['history', 'search']);
}

console.log(`\nИтого: ${passed} ок, ${failed} провалено\n`);
process.exit(failed === 0 ? 0 : 1);
