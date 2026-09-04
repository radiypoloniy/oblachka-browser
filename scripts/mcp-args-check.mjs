// Разбор аргументов внешнего агента и тексты, которые видит человек (shared/mcpArgs.ts).
//
// ⚠️ Отдельно от политики, как и сам модуль: там проверяется, КОМУ И ЧТО позволено, здесь — ЧТО
// ИМЕННО просят в этом вызове и как это назвать человеку. Цена ошибки тоже разная: в политике это
// посторонний, читающий чужую почту, здесь — карточка, по которой человек не может понять, на что
// соглашается, и агент, ушедший делать работу мимо браузера.
//
// Запуск: node scripts/mcp-args-check.mjs
import {
  MCP_BATCH_MAX, MCP_BOOKMARKS_MAX, MCP_LINKS_MAX,
  batchTextLimit, bookmarkTargets, confirmSubject, readUrlTargets, tidyLinks,
} from '../shared/mcpArgs.ts';
import { findTool } from '../shared/mcpPolicy.ts';

let passed = 0;
let failed = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ok   ${what}`); }
  else { failed++; console.log(` FAIL  ${what}\n         получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`); }
};

console.log('\n— ссылки со страницы —');
// ⚠️ Отсев живёт ЗДЕСЬ, а не в скрипте, который бегает по чужому DOM: тот исполняется на любом
// сайте мира и обязан быть простым до предела, иначе упадёт и вернёт агенту пустоту — а тот
// прочитает её как «ссылок на странице нет».
const here = 'https://site.ru/article';
check('ссылка на саму себя выброшена',
  tidyLinks([{ url: 'https://site.ru/article', text: 'сюда' }], here), []);
check('и её же якорь на этой странице',
  tidyLinks([{ url: 'https://site.ru/article#comments', text: 'к комментариям' }], here), []);
check('чужая схема не проходит',
  tidyLinks([{ url: 'javascript:void(0)', text: 'меню' }, { url: 'mailto:a@b.ru', text: 'почта' }], here), []);
check('обычная ссылка проходит с текстом',
  tidyLinks([{ url: 'https://site.ru/next', text: '  Следующая\n глава ' }], here),
  [{ url: 'https://site.ru/next', text: 'Следующая глава' }]);
check('дубликаты схлопываются',
  tidyLinks([{ url: 'https://a.ru/x', text: 'раз' }, { url: 'https://a.ru/x#top', text: 'два' }], here).length, 1);
check('ссылка без текста остаётся — адрес важнее подписи',
  tidyLinks([{ url: 'https://a.ru/x', text: '' }], here), [{ url: 'https://a.ru/x', text: '' }]);
check('мусор в списке пропускается поштучно',
  tidyLinks(['строка', null, 7, { url: 'https://a.ru/x' }], here).length, 1);
check('не массив — пустой список', tidyLinks('ссылки', here), []);
check('список обрезан по потолку',
  tidyLinks(Array.from({ length: MCP_LINKS_MAX + 30 }, (_, i) => ({ url: `https://a.ru/${i}`, text: 'x' })), here).length,
  MCP_LINKS_MAX);

console.log('\n— пакетное чтение: адреса и бюджет ответа —');
// ⚠️ Заведено ради КРУГОВ: десять страниц по одной — это десять оборотов «модель → клиент →
// браузер → модель», и каждый человек оплачивает контекстом заново.
const targets = (args) => readUrlTargets(args);
check('одиночный url принимается', targets({ url: 'https://a.ru' }).urls, ['https://a.ru/']);
check('список urls принимается',
  targets({ urls: ['https://a.ru', 'https://b.ru'] }).urls, ['https://a.ru/', 'https://b.ru/']);
check('оба поля разом — url идёт первым',
  targets({ url: 'https://a.ru', urls: ['https://b.ru'] }).urls, ['https://a.ru/', 'https://b.ru/']);
check('одиночная строка в urls тоже годится', targets({ urls: 'https://a.ru' }).urls, ['https://a.ru/']);
check('дубликаты не читаем дважды',
  targets({ urls: ['https://a.ru', 'https://a.ru/'] }).urls, ['https://a.ru/']);
// ⚠️ Одна битая ссылка в списке — обычное дело; терять из-за неё остальные семь незачем.
check('битый адрес выбрасывается поштучно',
  targets({ urls: ['не адрес', 'https://a.ru'] }).urls, ['https://a.ru/']);
check('и сосчитан вслух', targets({ urls: ['не адрес', 'https://a.ru'] }).dropped, 1);
check('чужая схема не проходит',
  targets({ urls: ['file:///c:/secret.txt', 'javascript:alert(1)'] }).ok, false);
check('пустой список — отказ словами', targets({ urls: [] }).ok, false);
check('лишние адреса сверх предела отсекаются',
  targets({ urls: Array.from({ length: MCP_BATCH_MAX + 3 }, (_, i) => `https://s${i}.ru`) }).urls.length,
  MCP_BATCH_MAX);
// ⚠️ Бюджет ответа ОБЩИЙ: иначе восемь адресов дают сотню тысяч знаков за вызов — десятки тысяч
// токенов, за которые платит человек, а прочитана будет первая треть.
check('одна страница получает полный лимит', batchTextLimit(1), 12000);
check('восемь делят общий бюджет', batchTextLimit(8), 3000);
check('мельче минимума не режем', batchTextLimit(50), 3000);

console.log('\n— сохранение в закладки —');
// ⚠️ Пачкой, а не по одной: восемь находок — это восемь карточек подтверждения подряд, и на
// третьей человек перестаёт читать, что в них написано.
const marks = (args) => bookmarkTargets(args);
check('одна закладка', marks({ url: 'https://a.ru', title: 'Раз' }).items,
  [{ url: 'https://a.ru/', title: 'Раз' }]);
check('список закладок',
  marks({ items: [{ url: 'https://a.ru', title: 'Раз' }, { url: 'https://b.ru', title: 'Два' }] }).items.length, 2);
check('название чистится от переносов',
  marks({ url: 'https://a.ru', title: '  Кресло\n  игровое ' }).items[0].title, 'Кресло игровое');
// ⚠️ Пустое название — не ошибка: адрес важнее подписи, браузер подставит заголовок сам.
check('без названия закладка остаётся', marks({ url: 'https://a.ru' }).items,
  [{ url: 'https://a.ru/', title: '' }]);
check('дубликат адреса не сохраняем дважды',
  marks({ items: [{ url: 'https://a.ru' }, { url: 'https://a.ru/' }] }).items.length, 1);
check('битый адрес выброшен и сосчитан',
  [marks({ items: ['не адрес', { url: 'https://a.ru' }] }).items.length,
    marks({ items: ['не адрес', { url: 'https://a.ru' }] }).dropped], [1, 1]);
check('чужая схема не сохраняется', marks({ url: 'file:///c:/passwords.txt' }).ok, false);
check('пусто — отказ словами', marks({ items: [] }).ok, false);
check('сверх предела отсекается',
  marks({ items: Array.from({ length: MCP_BOOKMARKS_MAX + 5 }, (_, i) => ({ url: `https://s${i}.ru` })) }).items.length,
  MCP_BOOKMARKS_MAX);
// ⚠️ Папка называется ИМЕНЕМ: номеров наших папок у агента нет и не будет.
check('имя папки чистится', marks({ url: 'https://a.ru', folder: '  Кресла  ' }).folder, 'Кресла');
check('без папки — в корень', marks({ url: 'https://a.ru' }).folder, null);
check('пустое имя папки — тоже в корень', marks({ url: 'https://a.ru', folder: '   ' }).folder, null);

console.log('\n— карточка называет то, на что человек соглашается —');
// ⚠️ «Сохранить 8 закладок» — вопрос, на который нельзя ответить осмысленно: разница между
// подборкой кресел и списком, куда затесалась почта, видна только в самих адресах.
const subj = confirmSubject(findTool('bookmarks_add'), {
  items: [{ url: 'https://a.ru/kreslo', title: 'Кресло' }, { url: 'https://b.ru/stul' }],
  folder: 'Кресла',
});
check('папка названа', subj.includes('Папка «Кресла»'), true);
check('и перечислены все адреса',
  subj.includes('https://a.ru/kreslo') && subj.includes('https://b.ru/stul'), true);
check('в корень — так и сказано',
  confirmSubject(findTool('bookmarks_add'), { url: 'https://a.ru' }).includes('В корень закладок'), true);
// ⚠️ Пустого предмета не бывает: карточка без адреса — вопрос ни о чём, и человек ответит «да»
// просто потому, что читать нечего.
check('без пригодного адреса карточка говорит об этом',
  confirmSubject(findTool('bookmarks_add'), { url: 'javascript:1' }), 'Программа не назвала пригодный адрес.');
const readSubj = confirmSubject(findTool('page_read_url'), { urls: ['https://a.ru', 'https://mail.ru'] });
check('чтение перечисляет все адреса',
  readSubj.includes('https://a.ru/') && readSubj.includes('https://mail.ru/'), true);
check('и говорит про профиль во множественном числе',
  readSubj.includes('Страницы будут открыты'), true);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
