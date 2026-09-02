// Прогон таблицы маршрутов (shared/aiRouting.ts) — без electron, обычным node.
//
// ⚠️ Главное, что здесь сторожится: КОМУ ОБЛАКО НЕ ОТДАЁТСЯ ВОВСЕ. Разделитель — открытый ответ
// против закрытого выбора. Там, где модель выбирает из готового набора (разложить вкладки, назвать
// файл, положить закладку в папку, понять поле формы, выбрать тип виджета из каталога), потолок
// задачи взят уже локальной 4B: сильная модель сделает то же самое, только за деньги и медленнее.
// Там, где ответ сочиняют (беседа, конспект, объяснение чужого текста), потолок задаёт модель.
//
// ⚠️ Отдельная причина отказа — СКОРОСТЬ: адресная строка и разбор формы считаются, пока человек
// набирает, и круг до чужого сервера там приходит позже, чем нужен. Две причины различаются в коде
// и в словах, потому что человеку это разные новости.
//
// ⚠️ Роли перечислены ПОФИЧЕЙНО, и это исправление настоящей ошибки первой версии: роли были
// выведены из экспортов TranslationService, а один только runTabOrganizePrompt зовут семнадцать
// разных мест. Роль «порядок во вкладках» прятала за собой разбор форм, итоги дня и правила из
// фразы. Случай «выбор одной роли не утаскивает соседнюю» ниже держит именно это.
//
// ⚠️ И третье: ОТКАТ НЕ БЫВАЕТ МОЛЧАЛИВЫМ. У каждого отката обязана быть причина и слова — иначе
// человек получит ответ хуже привычного и решит, что испортился браузер.
//
// Запуск: npm run ai-routing-check
import {
  AI_ROLES, ROLE_INFO, cloudFit, cloudAllowed, cloudFitNote, hasChoice,
  resolveRoute, routingSummary, DEFAULT_ROUTING, LOCAL_ID,
} from '../shared/aiRouting.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const GPT = { id: 'gpt', label: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', concurrency: 4 };
const OLLAMA = { id: 'ollama', label: 'Ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'qwen3', concurrency: 4 };

const ctx = (over) => ({ connections: [GPT, OLLAMA], ready: ['gpt', 'ollama'], localIds: ['ollama'], ...over });
const route = (role, table, over) => resolveRoute(role, table, ctx(over));

console.log('\n— есть ли из чего выбирать —');
// ⚠️ Главный выключатель интерфейса подключений: пока человек ничего не подключил, ни чипа модели
// в панели, ни точек маршрута, ни таблицы ролей быть не должно. Выбор из одного пункта — не выбор,
// а лишний элемент. Правило держится ЗДЕСЬ, а не тремя условиями в трёх компонентах: разъехавшись,
// они дали бы худшее — чип в панели есть, а настроить его негде.
check('ничего не подключено — показывать нечего', hasChoice({ connections: [] }), false);
check('одно подключение — выбор появился', hasChoice({ connections: [GPT] }), true);
// ⚠️ Порог — «есть подключение», а НЕ «есть облако». У человека с одной только Ollama на localhost
// облака нет, но развилка есть: встроенная Qwen против Ollama. Прятать её было бы ошибкой.
check('одна лишь Ollama на localhost — тоже выбор', hasChoice({ connections: [OLLAMA] }), true);
check('несколько подключений', hasChoice({ connections: [GPT, OLLAMA] }), true);

console.log('\n— чистая установка: всё считается здесь —');
check('пустая таблица', route('chat', DEFAULT_ROUTING), { connectionId: LOCAL_ID, reason: 'default', notice: null });
check('явно выбранная локальная — тоже без слов', route('chat', { chat: LOCAL_ID }),
  { connectionId: LOCAL_ID, reason: 'default', notice: null });

console.log('\n— кому облако отдаётся —');
check('чат', route('chat', { chat: 'gpt' }), { connectionId: 'gpt', reason: 'chosen', notice: null });
check('работа со страницей', route('page', { page: 'gpt' }).reason, 'chosen');
check('блокнот и Студия', route('notebook', { notebook: 'gpt' }).reason, 'chosen');
check('ровно три роли из десяти', AI_ROLES.filter(cloudAllowed), ['page', 'chat', 'notebook']);

console.log('\n— выбор не растекается на соседей —');
check('выбор «чата» не утаскивает блокнот', route('notebook', { chat: 'gpt' }).connectionId, LOCAL_ID);
check('и не трогает работу со страницей', route('page', { chat: 'gpt' }).connectionId, LOCAL_ID);

console.log('\n— кому облако не отдаётся вовсе —');
check('поиск: ответ придёт позже, чем нужен',
  route('search', { search: 'gpt' }),
  { connectionId: LOCAL_ID, reason: 'fallback-not-offered',
    notice: '«Поиск и адресная строка» всегда считается на этой машине. Считается, пока вы набираете, — ответ из облака придёт позже, чем нужен.' });
check('порядок и имена: тот же результат за деньги',
  route('organize', { organize: 'gpt' }),
  { connectionId: LOCAL_ID, reason: 'fallback-not-offered',
    notice: '«Порядок и имена» всегда считается на этой машине. Модель выбирает из готового набора: облако сделает то же самое, но за деньги.' });
check('разбор форм', route('forms', { forms: 'gpt' }).reason, 'fallback-not-offered');
check('итоги дня', route('digest', { digest: 'gpt' }).reason, 'fallback-not-offered');
// ⚠️ ГЛАВНОЕ РАЗЛИЧЕНИЕ ЭТОГО ФАЙЛА, и первая версия его провалила: «перевод страницы целиком по
// кнопке» и «перевести вот этот кусок» — РАЗНЫЕ роли, идущие разными путями. Кнопка — это
// translatePageBatch: обход DOM, батчи, плейсхолдеры ⟪N⟫, движок из настроек. Кусок — это
// runAiAction, роль page, и там выбор модели у человека есть. Слив их в одну роль, мы отняли бы
// выбор ровно там, где он уместен.
check('страница целиком — облаку не отдаётся', route('translate', { translate: 'gpt' }).reason, 'fallback-not-offered');
check('а перевод фрагмента — отдаётся, это роль page', route('page', { page: 'gpt' }).reason, 'chosen');
check('у перевода страницы объяснение своё, а не общее',
  cloudFitNote('translate'),
  'Страницу целиком переводит движок перевода — Bergamot или локальная Qwen, выбор в настройках. Перевести отдельный фрагмент любой подключённой моделью можно в поповере над выделением и в AI-панели.');
// ⚠️ Объяснение обязано называть ОБА движка. Написать «переводит Bergamot» было бы неправдой:
// Bergamot узко заточен под страницу по кнопке, а в настройках есть выбор в пользу Qwen, и
// поповер с панелью переводят именно Qwen, а не Bergamot.
check('объяснение называет оба движка страницы',
  ['Bergamot', 'Qwen'].every((w) => cloudFitNote('translate').includes(w)), true);
check('и указывает, где выбор модели всё-таки есть',
  ['поповере', 'AI-панели'].every((w) => cloudFitNote('translate').includes(w)), true);
check('у остальных закрытых — общее',
  cloudFitNote('organize'), 'Модель выбирает из готового набора: облако сделает то же самое, но за деньги.');
check('своё объяснение не отменяет отказа', cloudAllowed('translate'), false);
// ⚠️ Правила и виджеты — закрытые каталоги, и это не случайность, а починка: генератор виджетов
// заработал ровно тогда, когда открытую задачу («напиши код плитки») превратили в закрытую
// («выбери тип и заполни поля»). Пустить туда облако значило бы заново открыть закрытое.
check('правила из фразы — закрытый каталог', route('rules', { rules: 'gpt' }).reason, 'fallback-not-offered');
check('виджеты — закрытый каталог', route('widgets', { widgets: 'gpt' }).reason, 'fallback-not-offered');

console.log('\n— две причины отказа, и они разные —');
check('пока человек набирает — поздно', AI_ROLES.filter((r) => cloudFit(r) === 'too-slow'), ['search', 'forms']);
check('выбор из закрытого набора — незачем',
  AI_ROLES.filter((r) => cloudFit(r) === 'no-gain'), ['translate', 'organize', 'digest', 'rules', 'widgets']);
check('у каждого отказа есть объяснение словами',
  AI_ROLES.filter((r) => !cloudAllowed(r) && cloudFitNote(r) === null), []);
check('у разрешённой роли объяснения нет', cloudFitNote('chat'), null);
check('интерактивные роли — те же две', AI_ROLES.filter((r) => ROLE_INFO[r].interactive), ['search', 'forms']);

console.log('\n— откаты и их слова —');
check('подключение удалили',
  route('chat', { chat: 'исчезло' }),
  { connectionId: LOCAL_ID, reason: 'fallback-unknown',
    notice: 'Выбранное подключение удалено — считает модель на этой машине.' });
check('подключение есть, но не отвечает',
  route('chat', { chat: 'gpt' }, { ready: [] }),
  { connectionId: LOCAL_ID, reason: 'fallback-unavailable',
    notice: '«OpenAI» сейчас недоступно — ответила модель на этой машине.' });
// ⚠️ Порядок проверок не случаен: «мы не отдаём эту роль» — решение продукта, «сервер не ответил» —
// случайность. Когда верно и то и другое, человеку называют первое: оно объясняет, почему так
// будет ВСЕГДА, а не почему не повезло сегодня.
check('роль не отдаётся И сервер мёртв — говорим про решение, а не про невезение',
  route('search', { search: 'gpt' }, { ready: [] }).reason, 'fallback-not-offered');
check('у всех четырёх откатов есть слова',
  [route('chat', { chat: 'нет' }).notice,
   route('chat', { chat: 'gpt' }, { ready: [] }).notice,
   route('search', { search: 'gpt' }).notice,
   route('widgets', { widgets: 'gpt' }).notice].map((n) => n !== null && n !== ''),
  [true, true, true, true]);

console.log('\n— сводка для шапки настроек —');
check('чистая установка: все роли здесь', routingSummary(DEFAULT_ROUTING, ctx()), { local: 10, cloud: 0 });
check('одна роль в облаке', routingSummary({ chat: 'gpt' }, ctx()), { local: 9, cloud: 1 });
check('три разрешённые роли разом',
  routingSummary({ page: 'gpt', chat: 'gpt', notebook: 'gpt' }, ctx()), { local: 7, cloud: 3 });
// ⚠️ Ollama на localhost — это «здесь», и сводка обязана считать её локальной: иначе шапка пугала
// бы человека облаком там, где текст не покидает машину.
check('Ollama на localhost считается локальной', routingSummary({ chat: 'ollama' }, ctx()), { local: 10, cloud: 0 });
// ⚠️ Считается РАЗРЕШЁННЫЙ маршрут, а не запись в таблице: иначе шапка обещала бы облако там, где
// на деле работает откат, — то есть врала бы ровно в ту сторону, в которую врать нельзя.
check('запись про неотдаваемую роль остаётся локальной',
  routingSummary({ search: 'gpt', organize: 'gpt' }, ctx()), { local: 10, cloud: 0 });

console.log('\n— описание ролей на месте —');
check('у каждой роли есть карточка', AI_ROLES.filter((r) => ROLE_INFO[r] === undefined), []);
check('у каждой роли сказано, что уходит наружу', AI_ROLES.filter((r) => !ROLE_INFO[r].leaves), []);
check('ролей десять', AI_ROLES.length, 10);
check('роли не повторяются', AI_ROLES.length, new Set(AI_ROLES).size);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
