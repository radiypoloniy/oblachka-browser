// Защиты перед автоматической выгрузкой: медиа, формы, инкогнито и гонки после await.
// Запуск после сборки: npm test -- tab-sleep-controller
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { canSleepNow } = require('../dist-electron/electron/tabSleepController.js');

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(` ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const tab = { id: 'candidate', sleeping: null, incognito: false, lastActiveAt: 0, lastMediaAt: undefined, view: null };
let audible = false;
let playing = false;
let filled = false;
let afterMedia = () => {};
let afterForms = () => {};
const frame = {
  framesInSubtree: [],
  executeJavaScript: async () => { afterMedia(); return playing; },
};
const wc = {
  mainFrame: frame,
  isCurrentlyAudible: () => audible,
  getURL: () => 'https://example.test/page',
  executeJavaScript: async () => { afterForms(); return filled; },
};
tab.view = { webContents: wc };
let activeId = 'other';
let activePair;
let neverSleep = false;
const host = {
  activeId: () => activeId,
  activePair: () => activePair,
  isNeverSleepHost: () => neverSleep,
  tabUrl: () => wc.getURL(),
};
const candidate = () => canSleepNow(tab, new Set(['other']), host);

check('безопасная фоновая вкладка подходит', await candidate(), true);
tab.incognito = true;
check('инкогнито не теряет in-memory сессию', await candidate(), false);
tab.incognito = false; neverSleep = true;
check('явный запрет выгрузки работает до опроса страницы', await candidate(), false);
neverSleep = false; tab.lastMediaAt = Date.now();
check('отсрочка после медиа сохраняет вкладку', await candidate(), false);
tab.lastMediaAt = undefined; audible = true;
check('слышимое медиа сохраняет вкладку', await candidate(), false);
audible = false; playing = true;
check('беззвучное воспроизведение тоже защищено', await candidate(), false);
check('обнаруженное медиа сохраняет время для отсрочки', typeof tab.lastMediaAt, 'number');
playing = false; tab.lastMediaAt = undefined; filled = true;
check('заполненная форма не выгружается', await candidate(), false);
filled = false;

afterForms = () => { activeId = tab.id; };
check('активация во время опроса формы отменяет сон', await candidate(), false);
afterForms = () => {}; activeId = 'other';
afterForms = () => { activePair = { leftId: tab.id, rightId: 'partner' }; };
check('вход в показываемый split во время await отменяет сон', await candidate(), false);
afterForms = () => {}; activePair = undefined;
afterMedia = () => { tab.sleeping = { url: wc.getURL() }; };
check('изменение состояния во время опроса медиа отменяет повторный сон', await candidate(), false);
afterMedia = () => {}; tab.sleeping = null;
check('после снятия всех защит кандидат снова подходит', await candidate(), true);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
