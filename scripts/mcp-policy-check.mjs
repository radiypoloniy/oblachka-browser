// Политика MCP-сервера: что браузер отдаёт наружу и на каких условиях (shared/mcpPolicy.ts).
//
// ⚠️ Проверяется машиной потому, что цена ошибки здесь другая, чем у остального кода. Лишний
// инструмент в каталоге или приватная вкладка, просочившаяся в список, — это не «функция
// работает хуже», а посторонний агент, читающий чужую почту. Такие вещи не должен держать
// человеческий глаз на код-ревью: они выглядят безобидно ровно до того дня, когда сработают.
import {
  MCP_TOOLS, MCP_CLOSED_PREFIXES, MCP_SUPPORTED_VERSIONS, MCP_VERSION,
  MCP_HISTORY_MAX, MCP_TEXT_LIMIT,
  annotationsFor, clampHistoryLimit, clampPageText, decide, eraOf, findTool,
  isClosedName, needsConfirmation, pickVersion, visibleTabs,
} from '../shared/mcpPolicy.ts';

let passed = 0;
let failed = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ok   ${what}`); }
  else { failed++; console.log(` FAIL  ${what}\n         получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`); }
};

const ALL = { connected: true, disabled: [] };

console.log('\n— каталог закрыт —');
// ⚠️ Главный инвариант файла: наружу торчит ровно то, что перечислено, и ничего сверх.
check('состав каталога', MCP_TOOLS.map((t) => t.name), ['tabs.list', 'page.text', 'history.search']);
check('в первом заходе записи нет вовсе', MCP_TOOLS.filter((t) => t.mode === 'write'), []);
check('у каждого инструмента объявлен режим',
  MCP_TOOLS.filter((t) => t.mode !== 'read' && t.mode !== 'write'), []);
check('у каждого есть описание для чужого клиента',
  MCP_TOOLS.filter((t) => !t.description || !t.title), []);
check('имя каждого — безопасное для заголовка HTTP',
  MCP_TOOLS.filter((t) => !/^[a-z][a-z0-9.]*$/.test(t.name)), []);

console.log('\n— закрытые категории —');
// ⚠️ Это замок на будущее: сегодня таких инструментов нет, и проверка следит, чтобы они не
// появились «просто на чтение». Пароль и кука — не данные страницы, а ключи от чужих аккаунтов.
check('ни один инструмент не из закрытой категории',
  MCP_TOOLS.filter((t) => isClosedName(t.name)).map((t) => t.name), []);
check('пароли закрыты', isClosedName('passwords.list'), true);
check('хранилище закрыто', isClosedName('vault.reveal'), true);
check('куки закрыты', isClosedName('cookies.get'), true);
check('автозаполнение закрыто', isClosedName('autofill.profile'), true);
check('приватные вкладки закрыты как категория', isClosedName('private.tabs'), true);
check('открытая вкладка — не закрытая категория', isClosedName('tabs.list'), false);
check('текст страницы — не закрытая категория', isClosedName('page.text'), false);
check('закрытых корней восемь', MCP_CLOSED_PREFIXES.length, 8);

console.log('\n— кому и что позволено —');
check('знакомый инструмент подтверждённому клиенту', decide('tabs.list', ALL).ok, true);
check('незнакомое имя', decide('tabs.nuke', ALL).reason, 'unknown');
check('выключенный тумблером',
  decide('page.text', { connected: true, disabled: ['page.text'] }).reason, 'disabled');
check('выключение одного не трогает соседей',
  decide('tabs.list', { connected: true, disabled: ['page.text'] }).ok, true);
// ⚠️ Неподтверждённый клиент получает ОДИН И ТОТ ЖЕ отказ на любое имя — иначе перебором имён
// он узнаёт состав каталога и то, чем человек пользуется, ещё до всякого разрешения.
check('неподтверждённому — отказ на существующее имя',
  decide('tabs.list', { connected: false, disabled: [] }).reason, 'not-connected');
check('неподтверждённому — тот же отказ на выдуманное имя',
  decide('нет-такого', { connected: false, disabled: [] }).reason, 'not-connected');
check('и слова у обоих отказов совпадают',
  decide('tabs.list', { connected: false, disabled: [] }).message
    === decide('нет-такого', { connected: false, disabled: [] }).message, true);
check('поиск по имени', findTool('history.search')?.mode, 'read');
check('поиск несуществующего', findTool('history.nuke'), null);

console.log('\n— аннотации для чужого клиента —');
check('чтение помечено чтением', annotationsFor(findTool('tabs.list')).readOnlyHint, true);
check('чтение не разрушительно', annotationsFor(findTool('tabs.list')).destructiveHint, false);
// ⚠️ Открытый мир везде: ответ зависит от живого веба, и повторный вызов даст другое.
check('открытый мир у всех', MCP_TOOLS.every((t) => annotationsFor(t).openWorldHint), true);
check('чтение идемпотентно', MCP_TOOLS.every((t) => annotationsFor(t).idempotentHint), true);
// Будущая запись: добавление против необратимого — разные карточки у клиента.
const openTab = { name: 'tabs.open', mode: 'write', title: '', description: '', input: { type: 'object', properties: {} } };
const closeTab = { name: 'tabs.close', mode: 'write', title: '', description: '', input: { type: 'object', properties: {} } };
check('открыть вкладку — добавление', annotationsFor(openTab).destructiveHint, false);
check('закрыть вкладку — необратимо', annotationsFor(closeTab).destructiveHint, true);
check('запись требует подтверждения', needsConfirmation(openTab), true);
check('чтение не требует', needsConfirmation(findTool('page.text')), false);

console.log('\n— что видно снаружи —');
const tabs = [
  { url: 'https://habr.com/ru/post/1', private: false },
  { url: 'https://bank.example/account', incognito: true },
  { url: 'https://mail.google.com/', private: true },
  { url: 'oblako-chrome://settings', private: false },
  { url: 'about:blank', private: false },
  { url: 'file:///C:/doc.pdf', private: false },
  { url: '', private: false },
];
// ⚠️ Приватная вкладка не видна ДАЖЕ ЗАГОЛОВКОМ: адрес и есть то, что человек прятал.
check('приватная не видна (incognito)',
  visibleTabs([{ url: 'https://mail.google.com/', incognito: true }]).length, 0);
check('приватная не видна', visibleTabs(tabs).map((t) => t.url), [
  'https://habr.com/ru/post/1', 'file:///C:/doc.pdf',
]);
check('наш интерфейс наружу не идёт',
  visibleTabs([{ url: 'oblako-chrome://newtab' }]).length, 0);
check('пустой адрес не идёт', visibleTabs([{ url: '   ' }]).length, 0);
check('регистр схемы не обходит фильтр',
  visibleTabs([{ url: 'OBLAKO-CHROME://settings' }]).length, 0);
check('обычная страница видна', visibleTabs([{ url: 'https://example.com' }]).length, 1);

console.log('\n— пределы ответа —');
check('по умолчанию', clampHistoryLimit(undefined), 10);
check('просили больше потолка', clampHistoryLimit(500), MCP_HISTORY_MAX);
check('просили ноль', clampHistoryLimit(0), 1);
check('просили отрицательное', clampHistoryLimit(-7), 1);
check('дробное вниз', clampHistoryLimit(7.9), 7);
check('мусор вместо числа', clampHistoryLimit('много'), 10);
check('NaN', clampHistoryLimit(NaN), 10);
check('короткий текст не трогаем', clampPageText('статья'), 'статья');
// ⚠️ Обрезаем ВСЛУХ: молча укороченная статья выглядит для агента законченной, и он ответит
// уверенно и неправильно.
const long = clampPageText('я'.repeat(MCP_TEXT_LIMIT + 100));
check('длинный обрезан', long.length < MCP_TEXT_LIMIT + 100, true);
check('и обрезан вслух', long.includes('обрезано'), true);

console.log('\n— версия протокола —');
check('наша ревизия в списке поддержки', MCP_SUPPORTED_VERSIONS.includes(MCP_VERSION), true);
check('текущая', pickVersion('2026-07-28'), { ok: true, version: '2026-07-28', era: 'modern' });
// ⚠️ Старые ревизии поддержаны не для полноты: на них говорят ВЫПУЩЕННЫЕ клиенты, и сервер,
// понимающий только новое, для человека выглядит просто сломанным.
check('прошлая — старая эпоха', pickVersion('2025-11-25'), { ok: true, version: '2025-11-25', era: 'legacy' });
check('версии нет вовсе — это законно', pickVersion(undefined), { ok: true, version: '2025-03-26', era: 'legacy' });
check('пустая строка — то же самое', pickVersion('').ok, true);
check('неизвестная — отказ со списком', pickVersion('2030-01-01'), { ok: false, supported: MCP_SUPPORTED_VERSIONS });
check('не строка — отказ', pickVersion(42).ok, false);
check('рубеж эпох', [eraOf('2026-07-28'), eraOf('2025-11-25')], ['modern', 'legacy']);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
