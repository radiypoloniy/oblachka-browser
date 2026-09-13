// Политика живой индексации истории (shared/historyIndex.ts) — без electron, обычным node.
//
// Живой путь должен снимать текст при просмотре, не только кнопкой «Полная индексация».
// Эти случаи — дыры, которые уже случались: 8 с ожидания на уже загруженной странице,
// «YouTube» на did-navigate навсегда вычёркивал ролик, SPA-тики заголовка не должны
// заново гнать Readability, скелетон лоадера не должен считаться страницей, якорь
// не должен плодить визиты.
//
// Запуск: npm test -- history-index
import {
  classifyHistoryNoise,
  isNoisyForEmbedding,
  shouldWaitForPageLoad,
  decideHistoryIndex,
  coverageFromCounts,
  formatHistoryCoverageLine,
  formatOnboardingIndexLead,
  pickIdleCatchupPages,
  shouldRunIdleCatchup,
  isUnusableHistoryText,
  isSpaRouteChange,
  HISTORY_INDEX_CONCURRENCY,
  SLEEP_INDEX_BUDGET_MS,
  IDLE_CATCHUP_MAX_PAGES,
  IDLE_CATCHUP_MAX_AGE_MS,
  IDLE_CATCHUP_IDLE_SECONDS,
  HISTORY_TEXT_MIN_CHARS,
  HISTORY_SKELETON_MAX_CHARS,
} from '../shared/historyIndex.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  const ok = a === b;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${a}, ждали ${b}`);
}

const YT_WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const YT_HOME = 'https://www.youtube.com/';
const GH_REPO = 'https://github.com/arkie/oblako';
const LOGIN = 'https://accounts.google.com/signin/v2/identifier';

console.log('\n— ждать load только пока страница грузится —');
check('ещё грузится — ждать', shouldWaitForPageLoad({ destroyed: false, loading: true }), true);
check('уже готова — не ждать', shouldWaitForPageLoad({ destroyed: false, loading: false }), false);
check('вью уничтожена — не ждать', shouldWaitForPageLoad({ destroyed: true, loading: true }), false);
check('уничтожена и не грузится — не ждать', shouldWaitForPageLoad({ destroyed: true, loading: false }), false);

console.log('\n— шум: URL важнее заголовка, голый домен — title —');
check('ролик с именем сайта в title — title-шум', classifyHistoryNoise(YT_WATCH, 'YouTube'), 'title');
check('ролик с настоящим именем — не шум', classifyHistoryNoise(YT_WATCH, 'Never Gonna Give You Up'), 'none');
check('главная YouTube — title-шум', classifyHistoryNoise(YT_HOME, 'YouTube'), 'title');
check('репозиторий с именем сайта — title-шум', classifyHistoryNoise(GH_REPO, 'GitHub'), 'title');
check('репозиторий с именем — не шум', classifyHistoryNoise(GH_REPO, 'oblako: private browser'), 'none');
check('логин — url-шум даже с нормальным title', classifyHistoryNoise(LOGIN, 'Welcome to Google'), 'url');
check('oauth в адресе — url', classifyHistoryNoise('https://id.sber.ru/oauth/authorize', 'Сбер ID'), 'url');
check('заглушка Document — title', classifyHistoryNoise('https://example.com/page', 'Document'), 'title');
check('Sign in — title', classifyHistoryNoise('https://shop.test/account', 'Sign in'), 'title');
check('совместимость: isNoisy совпадает с classify', isNoisyForEmbedding(YT_WATCH, 'YouTube'), true);
check('совместимость: осмысленный title не шум', isNoisyForEmbedding(YT_WATCH, 'Never Gonna Give You Up'), false);

console.log('\n— навигация: title-шум не запоминать, url-шум запоминать —');
check('навигация, уже есть чанк — skip',
  decideHistoryIndex({ trigger: 'navigate', hasContent: true, memoryDone: false, inFlight: false, noise: 'none', previousNoise: null }),
  'skip');
check('навигация, в памяти как готовое — skip',
  decideHistoryIndex({ trigger: 'navigate', hasContent: false, memoryDone: true, inFlight: false, noise: 'none', previousNoise: null }),
  'skip');
check('навигация, уже извлекаем — skip',
  decideHistoryIndex({ trigger: 'navigate', hasContent: false, memoryDone: false, inFlight: true, noise: 'none', previousNoise: null }),
  'skip');
check('навигация, нормальный title — extract',
  decideHistoryIndex({ trigger: 'navigate', hasContent: false, memoryDone: false, inFlight: false, noise: 'none', previousNoise: null }),
  'extract');
check('навигация, YouTube до имени ролика — не extract и не remember',
  decideHistoryIndex({ trigger: 'navigate', hasContent: false, memoryDone: false, inFlight: false, noise: 'title', previousNoise: null }),
  'skip');
check('навигация на логин — remember-url-noise',
  decideHistoryIndex({ trigger: 'navigate', hasContent: false, memoryDone: false, inFlight: false, noise: 'url', previousNoise: null }),
  'remember-url-noise');

console.log('\n— заголовок: YouTube → имя ролика заводит извлечение, SPA-тик нет —');
check('title-updated: YouTube → имя ролика — extract',
  decideHistoryIndex({ trigger: 'title', hasContent: false, memoryDone: false, inFlight: false, noise: 'none', previousNoise: 'title' }),
  'extract');
check('title-updated: всё ещё YouTube — skip',
  decideHistoryIndex({ trigger: 'title', hasContent: false, memoryDone: false, inFlight: false, noise: 'title', previousNoise: 'title' }),
  'skip');
check('title-updated: SPA сменил осмысленный title — не гонять снова',
  decideHistoryIndex({ trigger: 'title', hasContent: false, memoryDone: false, inFlight: false, noise: 'none', previousNoise: 'none' }),
  'skip');
check('первый осмысленный title без предыдущего — extract',
  decideHistoryIndex({ trigger: 'title', hasContent: false, memoryDone: false, inFlight: false, noise: 'none', previousNoise: null }),
  'extract');
check('title-updated, уже есть чанк — skip',
  decideHistoryIndex({ trigger: 'title', hasContent: true, memoryDone: false, inFlight: false, noise: 'none', previousNoise: 'title' }),
  'skip');
check('title-updated на логине — remember, не extract',
  decideHistoryIndex({ trigger: 'title', hasContent: false, memoryDone: false, inFlight: false, noise: 'url', previousNoise: 'url' }),
  'remember-url-noise');

console.log('\n— усыпление: последний шанс снять текст —');
check('сон без чанка — extract даже при title-шуме',
  decideHistoryIndex({ trigger: 'sleep', hasContent: false, memoryDone: false, inFlight: false, noise: 'title', previousNoise: 'title' }),
  'extract');
check('сон, страница уже с чанком — skip',
  decideHistoryIndex({ trigger: 'sleep', hasContent: true, memoryDone: false, inFlight: false, noise: 'none', previousNoise: 'none' }),
  'skip');
check('сон, идёт живое извлечение — skip (вкладку не выгружать)',
  decideHistoryIndex({ trigger: 'sleep', hasContent: false, memoryDone: false, inFlight: true, noise: 'none', previousNoise: 'none' }),
  'skip');
check('сон на логине — не открывать',
  decideHistoryIndex({ trigger: 'sleep', hasContent: false, memoryDone: false, inFlight: false, noise: 'url', previousNoise: null }),
  'remember-url-noise');

console.log('\n— бюджеты, литералы рядом с инвариантом —');
check('не больше двух извлечений разом', HISTORY_INDEX_CONCURRENCY, 2);
check('бюджет сна 1.5 с, не таймаут загрузки', SLEEP_INDEX_BUDGET_MS, 1500);
check('бюджет сна короче восьми секунд ожидания load', SLEEP_INDEX_BUDGET_MS < 8000, true);

console.log('\n— охват: дыра умного поиска отдельно от шума и импорта —');
check('сумма частей — все строки, не count(*) сбоку',
  coverageFromCounts(12, [{ noisy: true }, { noisy: true }, { noisy: false }, { noisy: false }]),
  { withContent: 12, noisy: 2, missing: 2, total: 16 });
check('пустая история', coverageFromCounts(0, []), { withContent: 0, noisy: 0, missing: 0, total: 0 });
check('всё с текстом', coverageFromCounts(5, []), { withContent: 5, noisy: 0, missing: 0, total: 5 });
check('только шум без чанка',
  coverageFromCounts(3, [{ noisy: true }, { noisy: true }]),
  { withContent: 3, noisy: 2, missing: 0, total: 5 });
check('строка когда всё на месте',
  formatHistoryCoverageLine({ withContent: 12, noisy: 0, missing: 0, total: 12 }),
  'Полный текст: 12 из 12 страниц');
check('строка когда дыра в умном поиске',
  formatHistoryCoverageLine({ withContent: 12, noisy: 8, missing: 20, total: 40 }),
  'Полный текст: 12 из 40. Ещё 20 без текста — умный поиск их не видит, пока не откроете снова или не запустите полную индексацию.');
check('строка когда без текста только шум',
  formatHistoryCoverageLine({ withContent: 12, noisy: 8, missing: 0, total: 20 }),
  'Полный текст: 12 из 20. Остальные 8 — вход и служебные, в поиск по смыслу не идут.');
check('пустая история в настройках',
  formatHistoryCoverageLine({ withContent: 0, noisy: 0, missing: 0, total: 0 }),
  'История пуста — умный поиск появится после просмотра страниц.');
check('онбординг после импорта называет число',
  formatOnboardingIndexLead(1240),
  'Перенесли 1240 страниц: есть адрес и заголовок, текста нет. Умный поиск по смыслу их не видит, пока не откроете снова — или не проиндексируете сейчас.');
check('онбординг без импорта молчит', formatOnboardingIndexLead(0), '');

console.log('\n— тихий добор: только недавние свои, не архив 2019 —');
check('не больше восьми за простой', IDLE_CATCHUP_MAX_PAGES, 8);
check('окно давности 36 часов', IDLE_CATCHUP_MAX_AGE_MS, 129600000);
check('компьютер простаивает полторы минуты', IDLE_CATCHUP_IDLE_SECONDS, 90);
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
check('вчерашний визит берём, визит 2019 — нет',
  pickIdleCatchupPages([
    { lastVisit: NOW - 20 * HOUR, noisy: false, id: 'recent' },
    { lastVisit: NOW - 40 * HOUR, noisy: false, id: 'old' },
    { lastVisit: Date.UTC(2019, 0, 1), noisy: false, id: 'archive' },
  ], NOW).map((r) => r.id),
  ['recent']);
check('шумный недавний не берём',
  pickIdleCatchupPages([{ lastVisit: NOW - HOUR, noisy: true, id: 'login' }], NOW).length,
  0);
check('девятый недавний не берём',
  pickIdleCatchupPages(
    Array.from({ length: 9 }, (_, i) => ({ lastVisit: NOW - i * 60_000, noisy: false, id: String(i) })),
    NOW,
  ).map((r) => r.id),
  ['0', '1', '2', '3', '4', '5', '6', '7']);
check('в простое можно', shouldRunIdleCatchup({ backfillRunning: false, catchupRunning: false, idleSeconds: 90 }), true);
check('89 секунд ещё рано', shouldRunIdleCatchup({ backfillRunning: false, catchupRunning: false, idleSeconds: 89 }), false);
check('полная индексация важнее тихого добора',
  shouldRunIdleCatchup({ backfillRunning: true, catchupRunning: false, idleSeconds: 900 }), false);
check('уже идёт добор — не второй',
  shouldRunIdleCatchup({ backfillRunning: false, catchupRunning: true, idleSeconds: 900 }), false);

check('минимум текста — 80', HISTORY_TEXT_MIN_CHARS, 80);
check('скелетон не длиннее 240', HISTORY_SKELETON_MAX_CHARS, 240);
check('живой скелетон Диска не страница',
  isUnusableHistoryText('Загружается... (собрано 74%)'), true);
check('короче 80 символов — не страница',
  isUnusableHistoryText('a'.repeat(79)), true);
check('ровно 80 без лоадера — страница',
  isUnusableHistoryText('a'.repeat(80)), false);
check('статья со словом loading внутри — страница',
  isUnusableHistoryText(`The chapter about loading cargo onto ships in the harbour runs for many paragraphs of real reportage that a reader would actually want to find later when searching history. ${'word '.repeat(40)}`),
  false);
check('короткий please wait — скелетон',
  isUnusableHistoryText(`Please wait ${'x'.repeat(90)}`), true);

check('якорь — не смена маршрута',
  isSpaRouteChange('https://app.example/inbox#a', 'https://app.example/inbox#b'), false);
check('тот же адрес — не смена',
  isSpaRouteChange('https://app.example/inbox', 'https://app.example/inbox'), false);
check('пустой from — ещё не было did-navigate',
  isSpaRouteChange('', 'https://app.example/inbox'), false);
check('pathname сменился — маршрут',
  isSpaRouteChange('https://app.example/inbox', 'https://app.example/inbox/msg/1'), true);
check('search сменился — маршрут',
  isSpaRouteChange('https://app.example/p?id=1', 'https://app.example/p?id=2'), true);

console.log(`\n${passed} прошло, ${failed} провалов`);
process.exit(failed === 0 ? 0 : 1);
