// Политика живой индексации истории (shared/historyIndex.ts) — без electron, обычным node.
//
// Живой путь должен снимать текст при просмотре, не только кнопкой «Полная индексация».
// Эти случаи — дыры, которые уже случались: 8 с ожидания на уже загруженной странице,
// «YouTube» на did-navigate навсегда вычёркивал ролик, SPA-тики заголовка не должны
// заново гнать Readability.
//
// Запуск: npm test -- history-index
import {
  classifyHistoryNoise,
  isNoisyForEmbedding,
  shouldWaitForPageLoad,
  decideHistoryIndex,
  HISTORY_INDEX_CONCURRENCY,
  SLEEP_INDEX_BUDGET_MS,
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

console.log(`\n${passed} прошло, ${failed} провалов`);
process.exit(failed === 0 ? 0 : 1);
