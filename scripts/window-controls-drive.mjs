// Кнопки окна на месте и работают. Не *-check.mjs — поднимает настоящее приложение.
//
// ⚠️ ЗАВЕДЕНО ПОТОМУ, ЧТО ЭТО ЕДИНСТВЕННЫЙ ВЫХОД ИЗ ОКНА. С `frame: false` системную рамку рисуем
// мы: если кнопка закрытия не нарисовалась или её нажатие не доехало до main, человек не сможет
// закрыть браузер вообще — ни мышью, ни привычным углом экрана. Цена поломки тут выше, чем у любой
// другой кнопки в интерфейсе, а `tsc` про неё ничего не знает: разорвётся проводка IPC, а не типы.
//
// ⚠️ Проверяется и ГЛИФ средней кнопки. Он единственный носит состояние: квадрат — «развернуть»,
// два наложенных — «вернуть». Состояние приходит из ОС отдельным событием (window:maximized), и
// именно этот путь легко забыть подключить — окно при этом разворачивается, а кнопка врёт.
//
// ⚠️ И РАЗМЕТКА ПЕРЕТАСКИВАНИЯ: полоса тянет окно (`-webkit-app-region: drag`), а кнопки обязаны
// быть `no-drag`. Забыть второе — значит получить кнопки, которые не нажимаются вовсе: нажатие
// превращается в перенос окна. Проверка дешёвая, а симптом выглядит как «кнопки мёртвые».
//
// Запуск: npm run drive -- window-controls
import { withStand, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

const BTNS = `(() => {
  const names = ['Свернуть', 'Закрыть'];
  const all = [...document.querySelectorAll('button[aria-label]')];
  const find = (n) => all.find((b) => b.getAttribute('aria-label') === n) || null;
  const mid = all.find((b) => /Развернуть|Вернуть размер/.test(b.getAttribute('aria-label') || ''));
  const info = (b) => b && {
    label: b.getAttribute('aria-label'),
    w: Math.round(b.getBoundingClientRect().width),
    h: Math.round(b.getBoundingClientRect().height),
    drag: getComputedStyle(b).webkitAppRegion || '',
    // ⚠️ Глиф сравниваем по САМОМУ РИСУНКУ (атрибут d), а не по числу элементов path: оба глифа
    // нарисованы одним path, и счётчик показывал 1 в обоих состояниях — проверка молчала бы.
    d: (b.querySelector('svg path') || {}).getAttribute ? b.querySelector('svg path').getAttribute('d') : '',
  };
  return { min: info(find(names[0])), mid: info(mid), close: info(find(names[1])) };
})()`;

const CLICK_MID = `(() => {
  const b = [...document.querySelectorAll('button[aria-label]')]
    .find((x) => /Развернуть|Вернуть размер/.test(x.getAttribute('aria-label') || ''));
  if (!b) return false;
  b.click();
  return true;
})()`;

const E = "process.mainModule.require('electron')";

await withStand(async (ctx) => {
  await wait(5000);

  const b = await ctx.chrome.evaluate(BTNS);
  check('все три кнопки окна нарисованы', !!(b?.min && b?.mid && b?.close),
    `${b?.min?.label ?? '—'} / ${b?.mid?.label ?? '—'} / ${b?.close?.label ?? '—'}`);
  if (!b?.min || !b?.mid || !b?.close) return;

  // ⚠️ 46 px — ширина системной кнопки Windows. Держим её не ради похожести, а ради мышечной
  // памяти: человек попадает в кнопку броском в угол, и другая ширина сбивает прицел.
  check('ширина как у системной кнопки', [b.min.w, b.mid.w, b.close.w].every((w) => w === 46),
    `${b.min.w}/${b.mid.w}/${b.close.w} px`);
  check('высота во всю полосу', [b.min.h, b.mid.h, b.close.h].every((h) => h >= 40),
    `${b.min.h}/${b.mid.h}/${b.close.h} px`);
  check('кнопки помечены no-drag, иначе нажатие уедет в перенос окна',
    [b.min.drag, b.mid.drag, b.close.drag].every((d) => d === 'no-drag'),
    [b.min.drag, b.mid.drag, b.close.drag].join('/') || 'пусто');

  // ── Разворот и глиф ───────────────────────────────────────────────────────
  const before = await ctx.evalMain(`${E}.BrowserWindow.getAllWindows()[0].isMaximized()`);
  check('окно поднялось не развёрнутым', before === false, String(before));

  check('нажатие на среднюю кнопку доходит', (await ctx.chrome.evaluate(CLICK_MID)) === true);
  await wait(900);
  const after = await ctx.evalMain(`${E}.BrowserWindow.getAllWindows()[0].isMaximized()`);
  check('окно развернулось', after === true, String(after));

  const b2 = await ctx.chrome.evaluate(BTNS);
  check('глиф сменился на «вернуть размер»', b2?.mid?.label === 'Вернуть размер', String(b2?.mid?.label));
  // ⚠️ Не только подпись, но и сам рисунок: подпись могла бы смениться, а глиф остаться квадратом —
  // человек читает картинку, а не aria-label.
  check('и рисунок глифа стал другим', !!b2?.mid?.d && b2.mid.d !== b.mid.d,
    `${(b.mid.d || '').slice(0, 18)}… → ${(b2?.mid?.d || '').slice(0, 18)}…`);

  await ctx.chrome.evaluate(CLICK_MID);
  await wait(900);
  const back = await ctx.evalMain(`${E}.BrowserWindow.getAllWindows()[0].isMaximized()`);
  check('и вернулось обратно', back === false, String(back));
  const b3 = await ctx.chrome.evaluate(BTNS);
  check('глиф вернулся к «развернуть»', b3?.mid?.label === 'Развернуть', String(b3?.mid?.label));
}, { main: true });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
