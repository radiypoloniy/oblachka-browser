// Политика MCP-сервера: что браузер отдаёт наружу и на каких условиях (shared/mcpPolicy.ts).
//
// ⚠️ Проверяется машиной потому, что цена ошибки здесь другая, чем у остального кода. Лишний
// инструмент в каталоге или приватная вкладка, просочившаяся в список, — это не «функция
// работает хуже», а посторонний агент, читающий чужую почту. Такие вещи не должен держать
// человеческий глаз на код-ревью: они выглядят безобидно ровно до того дня, когда сработают.
import {
  MCP_TOOLS, MCP_CLOSED_PREFIXES, MCP_SUPPORTED_VERSIONS, MCP_VERSION,
  MCP_HISTORY_MAX, MCP_TEXT_LIMIT,
  MCP_CONFIRM_TTL_MS,
  annotationsFor, approvalFits, clampHistoryLimit, clampPageText, clientKey, clientLabel,
  batchTextLimit, canonicalToolName, canRemember, confirmSubject, confirmTitle, decide,
  defaultStance, eraOf, findTool, isClosedName, mustAsk, readUrlTargets, MCP_BATCH_MAX,
  pickVersion, safeOpenUrl, stanceFor, visibleTabs,
} from '../shared/mcpPolicy.ts';

let passed = 0;
let failed = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ok   ${what}`); }
  else { failed++; console.log(` FAIL  ${what}\n         получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`); }
};

const ALL = { connected: true, stances: {} };

console.log('\n— каталог закрыт —');
// ⚠️ Главный инвариант файла: наружу торчит ровно то, что перечислено, и ничего сверх.
check('состав каталога', MCP_TOOLS.map((t) => t.name),
  ['tabs_list', 'page_text', 'page_screenshot', 'history_search', 'page_read_url',
    'tabs_open', 'tabs_activate', 'tabs_close']);
// ⚠️ Снимок — ЧТЕНИЕ, и по умолчанию идёт молча, как page_text: он показывает ровно ту страницу,
// которую человек и так видит на экране. Отдельного вопроса это не стоит, а вот отдать снимок
// приватной вкладки нельзя (проверяется живьём — в снимке участвует политика видимости).
check('снимок страницы — чтение', findTool('page_screenshot').mode, 'read');
check('и не помечен чувствительным', findTool('page_screenshot').sensitive, undefined);
check('снимок по умолчанию не спрашивает', defaultStance(findTool('page_screenshot')), 'allow');
check('аргументов у снимка нет', Object.keys(findTool('page_screenshot').input.properties), []);
// ⚠️ Главный инвариант захода 2: КАЖДЫЙ инструмент на запись проходит через вопрос человеку.
// Забытое подтверждение — это чужая программа, меняющая браузер молча.
// ⚠️ Главный инвариант захода 3: пока человек не решил иначе, ЛЮБАЯ запись спрашивает, а чтение
// идёт молча — согласие на него дано при подключении, и переспрашивать про уговорённое значит
// приучить жать «разрешить» не глядя.
check('запись по умолчанию спрашивает',
  MCP_TOOLS.filter((t) => t.mode === 'write' && defaultStance(t) !== 'ask'), []);
check('обычное чтение идёт молча',
  MCP_TOOLS.filter((t) => t.mode === 'read' && !t.sensitive && defaultStance(t) !== 'allow'), []);
// ⚠️ Чтение ЛЮБОГО адреса куками человека — тоже вопрос, хотя браузер оно не меняет: page_text
// отдаёт страницу, которую человек и так видит, а page_read_url — любую, какую выберет программа.
// ── Имя инструмента: подчёркивание, а не точка ──────────────────────────────────────────────
//
// ⚠️ СЛУЧАЙ ИЗ ЖИЗНИ 04.09.2026, и он стоил дня разбора. Спецификация MCP точку в имени допускает,
// а провайдерские API — нет: и Anthropic, и OpenAI требуют ^[a-zA-Z0-9_-]{1,64}$. Клиент, ведущий
// разговор через такую модель, заменяет точку на подчёркивание у себя и зовёт сервер уже
// изменённым именем — обратно не переводит никто. Cursor звал `tabs_open`, браузер отвечал
// «такого инструмента нет», в журнале копились `unknown`, карточка не показывалась ни разу, а
// страницу Cursor открывал своими средствами — со стороны это выглядело как «MCP не работает».
check('каталог назван через подчёркивание', MCP_TOOLS.every((t) => !t.name.includes('.')), true);
check('прежнее написание через точку принимается', findTool('tabs.open')?.name, 'tabs_open');
check('и приводится к каноническому', canonicalToolName('page.read_url'), 'page_read_url');
check('каноническое имя не портится', canonicalToolName('tabs_open'), 'tabs_open');
check('незнакомое имя остаётся собой', canonicalToolName('tabs.nuke'), 'tabs.nuke');
check('незнакомый инструмент по-прежнему не находится', findTool('tabs_nuke'), null);
// ⚠️ Закрытая категория обязана ловить оба написания: иначе запрет обходится сменой одного символа.
check('закрытая категория ловит подчёркивание', isClosedName('passwords_list'), true);
check('и точку', isClosedName('passwords.list'), true);
check('и составной префикс в обоих видах',
  [isClosedName('downloads_file'), isClosedName('downloads.file')], [true, true]);

// ── Пакетное чтение: адреса и бюджет ответа ─────────────────────────────────────────────────
//
// ⚠️ Заведено ради КРУГОВ: десять страниц по одной — это десять оборотов «модель → клиент →
// браузер → модель», и каждый человек оплачивает контекстом заново.
//
// ⚠️ Бюджет ответа ОБЩИЙ. Иначе восемь адресов дают сотню тысяч знаков за вызов — десятки тысяч
// токенов, за которые платит человек, а прочитана будет первая треть.
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
check('и они тоже сосчитаны',
  targets({ urls: Array.from({ length: MCP_BATCH_MAX + 3 }, (_, i) => `https://s${i}.ru`) }).dropped, 3);

check('одна страница получает полный лимит', batchTextLimit(1), 12000);
check('восемь делят общий бюджет', batchTextLimit(8), 3000);
// ⚠️ Ниже минимума не опускаемся: страница, обрезанная до пары абзацев, бесполезна — честнее
// прочитать меньше адресов целиком.
check('мельче минимума не режем', batchTextLimit(50), 3000);
check('бюджет не растёт от числа адресов', batchTextLimit(2) <= 12000, true);

// ⚠️ Карточка называет ВСЕ адреса: человек решает, пускать ли программу на конкретные сайты своим
// профилем, и разница между списком документации и списком, куда затесалась почта, видна только
// в самих адресах.
const subj = confirmSubject(findTool('page_read_url'), { urls: ['https://a.ru', 'https://mail.ru'] });
check('в карточке перечислены все адреса',
  subj.includes('https://a.ru/') && subj.includes('https://mail.ru/'), true);
check('и сказано про профиль во множественном числе', subj.includes('Страницы будут открыты'), true);

check('чтение чужого адреса спрашивает', defaultStance(findTool('page_read_url')), 'ask');
check('и его можно разрешить навсегда', canRemember(findTool('page_read_url')), true);
check('«прочитать по адресу» помечено чувствительным', findTool('page_read_url').sensitive, true);
check('у остальных чтений пометки нет',
  MCP_TOOLS.filter((t) => t.mode === 'read' && t.sensitive).map((t) => t.name), ['page_read_url']);
// ⚠️ Заголовок карточки — ВОПРОС: названием действия она читается как сообщение, которое можно
// не заметить (тот же закон, что у карточки разрешений сайта).
check('у каждой записи заголовок — вопрос',
  MCP_TOOLS.filter((t) => t.mode === 'write' && !confirmTitle(t).endsWith('?')), []);
check('у каждой записи есть предмет вопроса',
  MCP_TOOLS.filter((t) => t.mode === 'write' && confirmSubject(t, {}).length < 5), []);
// Адрес в карточке — проверенный, а не тот, что прислали.
check('в карточке показывается разобранный адрес',
  confirmSubject(findTool('tabs_open'), { url: 'https://ok.ru' }), 'https://ok.ru/');
check('у каждого инструмента объявлен режим',
  MCP_TOOLS.filter((t) => t.mode !== 'read' && t.mode !== 'write'), []);
check('у каждого есть описание для чужого клиента',
  MCP_TOOLS.filter((t) => !t.description || !t.title), []);
// ⚠️ Подчёркивание и дефис законны: спека просит имена, которые можно положить в HTTP-заголовок
// как есть (Mcp-Name), а это token-символы RFC 9110. Запрещены пробелы, кириллица и регистр —
// такое имя пришлось бы кодировать base64, и в чужом интерфейсе оно стало бы нечитаемым.
check('имя каждого — безопасное для заголовка HTTP',
  MCP_TOOLS.filter((t) => !/^[a-z][a-z0-9._-]*$/.test(t.name)), []);

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
check('открытая вкладка — не закрытая категория', isClosedName('tabs_list'), false);
check('текст страницы — не закрытая категория', isClosedName('page_text'), false);
check('закрытых корней восемь', MCP_CLOSED_PREFIXES.length, 8);

console.log('\n— кому и что позволено —');
check('знакомый инструмент подтверждённому клиенту', decide('tabs_list', ALL).ok, true);
check('незнакомое имя', decide('tabs.nuke', ALL).reason, 'unknown');
check('выключенный тумблером',
  decide('page_text', { connected: true, stances: { 'page_text': 'deny' } }).reason, 'disabled');
check('выключение одного не трогает соседей',
  decide('tabs_list', { connected: true, stances: { 'page_text': 'deny' } }).ok, true);
// ⚠️ Неподтверждённый клиент получает ОДИН И ТОТ ЖЕ отказ на любое имя — иначе перебором имён
// он узнаёт состав каталога и то, чем человек пользуется, ещё до всякого разрешения.
check('неподтверждённому — отказ на существующее имя',
  decide('tabs_list', { connected: false, stances: {} }).reason, 'not-connected');
check('неподтверждённому — тот же отказ на выдуманное имя',
  decide('нет-такого', { connected: false, stances: {} }).reason, 'not-connected');
check('и слова у обоих отказов совпадают',
  decide('tabs_list', { connected: false, stances: {} }).message
    === decide('нет-такого', { connected: false, stances: {} }).message, true);
check('поиск по имени', findTool('history_search')?.mode, 'read');
check('поиск несуществующего', findTool('history.nuke'), null);

console.log('\n— аннотации для чужого клиента —');
check('чтение помечено чтением', annotationsFor(findTool('tabs_list')).readOnlyHint, true);
check('чтение не разрушительно', annotationsFor(findTool('tabs_list')).destructiveHint, false);
// ⚠️ Открытый мир везде: ответ зависит от живого веба, и повторный вызов даст другое.
check('открытый мир у всех', MCP_TOOLS.every((t) => annotationsFor(t).openWorldHint), true);
// ⚠️ Идемпотентно только чтение: повторный tabs_open откроет ВТОРУЮ вкладку, и клиент, решивший
// «можно смело повторить», сделал бы человеку два окна вместо одного.
check('чтение идемпотентно',
  MCP_TOOLS.filter((t) => t.mode === 'read').every((t) => annotationsFor(t).idempotentHint), true);
check('запись — нет',
  MCP_TOOLS.filter((t) => t.mode === 'write').every((t) => !annotationsFor(t).idempotentHint), true);
// Будущая запись: добавление против необратимого — разные карточки у клиента.
const openTab = { name: 'tabs_open', mode: 'write', title: '', description: '', input: { type: 'object', properties: {} } };
const closeTab = { name: 'tabs_close', mode: 'write', title: '', description: '', input: { type: 'object', properties: {} } };
check('открыть вкладку — добавление', annotationsFor(openTab).destructiveHint, false);
check('закрыть вкладку — необратимо', annotationsFor(closeTab).destructiveHint, true);
check('запись требует подтверждения', mustAsk(openTab, {}), true);
check('чтение не требует', mustAsk(findTool('page_text'), {}), false);
// ⚠️ «Разрешать всегда» есть у добавляющего и НЕТ у необратимого: одним нажатием разрешить
// закрывать вкладки навсегда человек не должен даже при желании.
check('«всегда» можно для открытия', canRemember(openTab), true);
check('«всегда» нельзя для закрытия', canRemember(closeTab), false);

console.log('\n— решение человека сильнее умолчания —');
check('разрешил молча — не спрашиваем',
  mustAsk(openTab, { 'tabs_open': 'allow' }), false);
check('запретил — decide отказывает',
  decide('tabs_open', { connected: true, stances: { 'tabs_open': 'deny' } }).reason, 'disabled');
check('вернул «спрашивать»', mustAsk(openTab, { 'tabs_open': 'ask' }), true);
// ⚠️ Мусор в записи не должен молча превращаться в разрешение: неизвестное значение — умолчание.
check('мусор в записи читается как умолчание',
  stanceFor(openTab, { 'tabs_open': 'да конечно' }), 'ask');
check('решение про соседа не задевает',
  mustAsk(openTab, { 'tabs_close': 'allow' }), true);
check('чтение можно и запретить',
  decide('tabs_list', { connected: true, stances: { 'tabs_list': 'deny' } }).reason, 'disabled');

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

console.log('\n— какой адрес позволено открыть —');
// ⚠️ Белый список схем, как у гостевой навигации после аудита 21.08: чёрный обходится записью,
// о которой мы не подумали.
check('обычный адрес', safeOpenUrl('https://habr.com/p/1'), 'https://habr.com/p/1');
check('http тоже можно', safeOpenUrl('http://example.com/') !== null, true);
check('javascript:', safeOpenUrl('javascript:alert(1)'), null);
check('перевод строки перед схемой не обманывает', safeOpenUrl('\njavascript:alert(1)'), null);
check('data:text/html', safeOpenUrl('data:text/html,<b>x</b>'), null);
// ⚠️ file:// закрыт намеренно: открыть локальный файл по просьбе чужой программы — это чтение
// диска чужими руками, а не навигация.
check('file://', safeOpenUrl('file:///C:/secret.txt'), null);
check('наш интерфейс', safeOpenUrl('oblako-chrome://settings'), null);
check('протокол-относительный', safeOpenUrl('//evil.example/x'), null);
// ⚠️ «Без хоста» не значит «с пустым хостом»: `http:///path` разбор нормализует в хост `path`,
// и это законный, хоть и бессмысленный адрес. Ловим случай, где хоста нет по-настоящему.
check('одна схема без адреса', safeOpenUrl('https://'), null);
check('пробелы вместо адреса', safeOpenUrl('https://   '), null);
check('пусто', safeOpenUrl(''), null);
check('не строка', safeOpenUrl(42), null);
check('слишком длинный', safeOpenUrl('https://a.com/' + 'x'.repeat(3000)), null);

console.log('\n— подтверждение живёт недолго и только на своё —');
const now = 1_000_000;
const given = { tool: 'tabs_open', digest: 'D1', at: now };
check('своё подтверждение годится', approvalFits(given, { tool: 'tabs_open', digest: 'D1' }, now), true);
// ⚠️ Без слепка аргументов подтверждённое «открыть habr.ru» открывало бы что угодно.
check('другие аргументы — не годится', approvalFits(given, { tool: 'tabs_open', digest: 'D2' }, now), false);
check('другой инструмент — не годится', approvalFits(given, { tool: 'tabs_close', digest: 'D1' }, now), false);
check('в пределах срока', approvalFits(given, { tool: 'tabs_open', digest: 'D1' }, now + MCP_CONFIRM_TTL_MS), true);
check('просрочено', approvalFits(given, { tool: 'tabs_open', digest: 'D1' }, now + MCP_CONFIRM_TTL_MS + 1), false);
// Часы съехали назад — подтверждение «из будущего» не принимаем.
check('время назад', approvalFits(given, { tool: 'tabs_open', digest: 'D1' }, now - 1), false);
check('подтверждения не было вовсе', approvalFits(null, { tool: 'tabs_open', digest: 'D1' }, now), false);
check('срок — минута', MCP_CONFIRM_TTL_MS, 60000);

console.log('\n— как называем клиента —');
// ⚠️ Имя приходит от самого клиента и ничем не подтверждено: приводим к безопасному виду и на
// этом останавливаемся.
check('обычное имя', clientLabel('Claude Code'), 'Claude Code');
check('перевод строки не рисует вторую строку в карточке',
  clientLabel('Claude\nCode: разрешите всё'), 'Claude Code: разрешите всё');
check('пусто', clientLabel(''), 'неизвестный клиент');
check('не строка', clientLabel(null), 'неизвестный клиент');
check('длинное режется', clientLabel('и'.repeat(200)).length, 60);
check('ключ не зависит от регистра и пробелов',
  clientKey(clientLabel('  Claude   CODE ')), clientKey(clientLabel('claude code')));

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
