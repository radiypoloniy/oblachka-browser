// Живая проводка IPC: обработчики, объявленные в исходниках, ДЕЙСТВИТЕЛЬНО зарегистрированы.
// Не *-check.mjs — поднимает настоящее приложение, в npm test не входит.
//
// ⚠️ Ради чего заведена, если есть contract-check. Тот сторож разбирает ИСХОДНИКИ и отвечает на
// вопрос «написан ли где-то ipcMain.handle для этого канала». Он не отвечает на другой вопрос:
// «а этот handle вообще выполнился». Между ними помещается целый класс поломок, и все они молчат
// при сборке и при `npm test`:
//   • регистратор не вызван из main.ts (файл добавили, строчку забыли);
//   • исключение в середине setup — всё, что регистрировалось ПОСЛЕ него, тихо не зарегистрировано;
//   • регистрация под условием, которое на самом деле не выполняется;
//   • собранный dist отстал от исходников, и живёт вчерашний набор каналов. Ровно так проект уже
//     полгода молча работал по контракту из осиротевшего `shared/ipc.js` — самая дорогая поломка
//     в истории репозитория, и статический сторож её по построению не видит.
// Человек ловит такое одним способом: нажимает кнопку и получает «No handler registered for X».
//
// ⚠️ Модель контракта НЕ дублируется. Разбор исходников берётся у самого contract-check
// (`--json`): две расходящиеся модели одного контракта — это ровно та болезнь, от которой сторож
// и лечит.
//
// ⚠️ Живой реестр читается из MAIN-процесса через инспектор: `ipcMain._invokeHandlers` — поле
// ВНУТРЕННЕЕ, публичного способа перечислить обработчики у Electron нет. Здесь это допустимо:
// диагностический скрипт, в поставку не идёт. Если Electron однажды его переименует, проверка
// покраснеет громко и сразу, а не начнёт молча пропускать (пустой реестр = все каналы потеряны).
//
// ⚠️ Каналы, зарегистрированные на КОНКРЕТНОМ WebContents (`wc.ipc.on` в TabManager), здесь не
// проверяются и не должны: в глобальном реестре Electron их нет. contract-check их в handlerSites
// тоже не кладёт, поэтому обе стороны сравнения говорят об одном и том же множестве.
//
// ⚠️ Профиль изолированный (withStand), боевые данные не открываются.
//
// Запуск: npm run drive -- ipc-wiring
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withStand, wait } from './isolated-stand.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};
const list = (what, items, hint) => {
  if (items.length === 0) { ok++; console.log(`  ok   ${what}`); return; }
  bad++;
  console.log(` FAIL  ${what} — ${items.length} шт.${hint ? ` (${hint})` : ''}`);
  for (const x of items.slice(0, 25)) console.log(`         ${x}`);
  if (items.length > 25) console.log(`         … и ещё ${items.length - 25}`);
};

// ── контракт из исходников ──────────────────────────────────────────────────────────────────

const r = spawnSync(process.execPath, [path.join(HERE, 'contract-check.mjs'), '--json'], {
  encoding: 'utf8', windowsHide: true,
});
if (r.status !== 0 || !r.stdout) {
  console.log(' FAIL  contract-check не отдал контракт — сначала почините его: npm test -- contract');
  console.log(`\nИтого: 0 прошло, 1 не прошло\n`);
  process.exit(1);
}
const contract = JSON.parse(r.stdout);
const OURS = new Set(Object.values(contract.channels));

// ⚠️ Каналы, которых в глобальном реестре сразу после старта НЕТ ЗАКОННО. Список именной и с
// причиной у каждого: «не зарегистрирован» и «зарегистрирован лениво» выглядят в реестре
// одинаково, и без разбора проверка либо врала бы красным навсегда, либо молчала бы про всё.
// Новый канал в этом списке — осознанное решение, а не способ погасить красное.
const LAZY = {
  'chrome:ui-ready': 'слушатель снимается сразу после показа окна (window/showWhenReady.ts) — он одноразовый по смыслу',
  'password-popover:close': 'ensureIpcRegistered() в PasswordPopoverManager — при первом появлении карточки пароля',
  'suggest-dropdown:recommend': 'ensureIpcRegistered() в SuggestDropdownManager — при первом показе подсказок омнибокса',
  'suggest-dropdown:site-info': 'там же',
};

// ⚠️ Каналы AI-панели живут МИМО shared/ipc: строка зашита руками с обеих сторон
// (electron/preload-aipanel.ts ↔ electron/AiPanelManager.ts). Это не поломка, но и не бесплатно —
// на них не действует ничего из contract-check: ни поиск мёртвых каналов, ни сверка арности, ни
// golden-инвентарь. Список закрытый: любой НОВЫЙ канал мимо контракта здесь покраснеет.
const OUTSIDE_CONTRACT = new Set([
  'ai-panel:model-state',
  'ai-panel:currency-rates',
  'ai-panel:weather',
]);

console.log(`\nконтракт: ${OURS.size} каналов, из них с ipcMain.handle — ${contract.handle.length}, с ipcMain.on — ${contract.on.length}\n`);

// ── живой реестр ────────────────────────────────────────────────────────────────────────────

// { main: true } — этой проверке нужен ещё и отладочный порт main-процесса (isolated-stand.mjs).
await withStand(async (ctx) => {
  console.log('профиль:', ctx.profile, '\n');
  // ⚠️ Ждём ВЕСЬ каскад прогрева, а не «пока поднимется окно». Поповеры (зоны перетаскивания,
  // AI-панель, карточка сайта, загрузки) греются отложенно — самый поздний через 3600 мс после
  // показа окна, — и вместе с собой поднимают свою проводку IPC. На трёх секундах проверка
  // краснела на пяти каналах, которые через секунду регистрируются сами.
  await wait(7500);

  const E = "process.mainModule.require('electron')";
  const liveHandle = await ctx.evalMain(`${E}.ipcMain._invokeHandlers ? [...${E}.ipcMain._invokeHandlers.keys()] : null`);
  const liveOn = await ctx.evalMain(`${E}.ipcMain.eventNames().filter((n) => typeof n === 'string')`);

  // ⚠️ Первым делом — что внутреннее поле вообще на месте. Иначе пустой реестр выглядел бы как
  // «все каналы потеряны», и человек чинил бы проводку вместо переезда на новый Electron.
  check('реестр invoke-обработчиков читается', Array.isArray(liveHandle) && liveHandle.length > 0,
    Array.isArray(liveHandle) ? `${liveHandle.length} шт.` : 'ipcMain._invokeHandlers недоступен');
  if (!Array.isArray(liveHandle)) return;

  const gotHandle = new Set(liveHandle);
  const gotOn = new Set(liveOn ?? []);

  console.log(`  живьём: invoke-обработчиков ${gotHandle.size}, слушателей ${gotOn.size}\n`);

  console.log('— каждый объявленный обработчик поднялся —');
  list('все ipcMain.handle зарегистрированы',
    contract.handle.filter((c) => !gotHandle.has(c)),
    'в рантайме это «No handler registered», tsc и npm test такого не видят');
  list('все ipcMain.on зарегистрированы',
    contract.on.filter((c) => !gotOn.has(c) && !(c in LAZY)),
    'отправка уйдёт в пустоту молча — без ошибки и без эффекта');

  const lazyStillLazy = Object.keys(LAZY).filter((c) => !gotOn.has(c) && !gotHandle.has(c));
  console.log(`         ленивых, поднимающихся по требованию: ${lazyStillLazy.length} из ${Object.keys(LAZY).length} — ${lazyStillLazy.join(', ') || 'все успели'}`);

  console.log('\n— в реестре нет наших каналов мимо контракта —');
  // ⚠️ Обратная сторона: канал зарегистрирован строкой, которой в контракте нет. Так выглядит
  // опечатка в зашитой строке и так же выглядит отставший dist. Чужие каналы (Electron
  // регистрирует свои, и они не по нашей схеме) отсеиваем по разделителю и по префиксу.
  const looksOurs = (c) => c.includes(':') && !c.startsWith('ELECTRON') && c === c.toLowerCase();
  const outside = [...gotHandle].filter((c) => looksOurs(c) && !OURS.has(c));
  list('нет НОВЫХ каналов мимо контракта',
    outside.filter((c) => !OUTSIDE_CONTRACT.has(c)),
    'строка канала разошлась с shared/ipc или собранный dist отстал');
  check('известные каналы вне контракта на месте и не размножились',
    outside.length === OUTSIDE_CONTRACT.size, `${outside.length} шт. — ${outside.join(', ')}`);

  console.log('\n— вменяемость окружения —');
  const windows = await ctx.evalMain(`${E}.BrowserWindow.getAllWindows().length`);
  check('окно ровно одно', windows === 1, String(windows));
  // Тот же вопрос с другой стороны: настоящий вызов через настоящий preload доходит до main.
  const themeViaApi = await ctx.chrome.evaluate('window.oblako.getTheme()');
  check('вызов через window.oblako доходит до обработчика', themeViaApi !== undefined && themeViaApi !== null,
    JSON.stringify(themeViaApi));
}, { main: true });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
