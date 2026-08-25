// Распознавание страниц результатов поиска (shared/searchEngines.ts) — без electron, голым node.
//
// ⚠️ Функция решает две вещи сразу: что НЕ попадёт в историю (HistoryManager::#shouldRecord) и
// что не покажется в подсказках омнибокса. Ошибка в любую сторону заметна:
//   • пропустили лишнее → «лучшим совпадением» становится страница Google, у которой заголовок
//     это сам запрос (живой случай 25.08.2026: по «dai» всплыла страница поиска, потому что
//     когда-то в неё вставили адрес daily.afisha.ru);
//   • отсекли лишнее → из истории пропадают нормальные страницы, и человек их не найдёт.
//
// ⚠️ Половина случаев здесь — про ВТОРОЕ. Домен поисковика сам по себе, маркетплейс с путём
// /search, расписание автобусов — всё это валидная история, и трогать её нельзя. Случаи взяты из
// боевой базы, а не выдуманы.
//
// Запуск: npm test -- search-engines
import { isSearchResultUrl, getSearchEngine, SEARCH_ENGINES } from '../shared/searchEngines.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

console.log('\n— страница результатов: узнаём —');
{
  check('google с запросом', isSearchResultUrl('https://www.google.com/search?q=%D0%BF%D1%80%D0%BE%D0%B4%D0%B0%D0%B6%D0%B8'), true);
  // Ровно та запись из базы, из-за которой всё началось: в поиск вставили адрес.
  check('google, в запросе — вставленный адрес',
    isSearchResultUrl('https://www.google.com/search?q=https%3A%2F%2Fdaily.afisha.ru%2Fnews%2F111085-na'), true);
  check('yandex с текстом', isSearchResultUrl('https://yandex.ru/search/?text=%D0%BF%D0%BE%D0%B8%D1%81%D0%BA'), true);
  check('duckduckgo', isSearchResultUrl('https://duckduckgo.com/?q=oblako'), true);
  check('без www тоже', isSearchResultUrl('https://google.com/search?q=x'), true);
}

console.log('\n— валидная история: НЕ трогаем —');
{
  check('главная поисковика', isSearchResultUrl('https://www.google.com/'), false);
  check('домен яндекса', isSearchResultUrl('https://yandex.ru/'), false);
  // Из боевой базы: маркетплейс и расписание — у обоих в пути /search, но это не поисковики.
  check('маркет с путём /search', isSearchResultUrl('https://market.yandex.ru/search?text=%D0%BA%D0%B5%D0%BF%D0%BA%D0%B0'), false);
  check('расписание автобусов', isSearchResultUrl('https://rasp.yandex.ru/search/bus/?fromId=c35'), false);
  check('обычная страница', isSearchResultUrl('https://daily.afisha.ru/news/111085-na-vdnh'), false);
  check('чужой сайт со словом search', isSearchResultUrl('https://github.com/search?q=electron'), false);
  check('картинки яндекса — отдельный раздел, не веб-поиск',
    isSearchResultUrl('https://yandex.ru/images/search?text=%D0%BA%D0%B8%D0%BD%D0%BE'), false);
}

console.log('\n— вырожденное —');
{
  check('пустая строка', isSearchResultUrl(''), false);
  check('не адрес', isSearchResultUrl('просто текст'), false);
  check('не http(s)', isSearchResultUrl('file:///C:/search?q=1'), false);
  check('oblako-chrome не поиск', isSearchResultUrl('oblako-chrome://localhost/index.html'), false);
}

console.log('\n— реестр движков цел —');
{
  check('три движка', SEARCH_ENGINES.length, 3);
  check('у каждого есть имя и шаблон',
    SEARCH_ENGINES.every((e) => e.name && typeof e.buildUrl('x') === 'string'), true);
  check('своя же ссылка узнаётся как поиск',
    SEARCH_ENGINES.every((e) => isSearchResultUrl(e.buildUrl('тест'))), true);
  check('неизвестный id падает на умолчание', getSearchEngine('нетакого').id, 'duckduckgo');
}

console.log(`\nИтого: ${passed} ок, ${failed} провалено\n`);
process.exit(failed === 0 ? 0 : 1);
