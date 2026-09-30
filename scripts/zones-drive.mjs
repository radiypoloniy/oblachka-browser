// Живой прогон приложения «Пояса» на ИЗОЛИРОВАННОМ профиле (правило CLAUDE.md).
// Не *-check.mjs — в npm test не входит, поднимает приложение.
import { withStand, connectCdp, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

await withStand(async (ctx) => {
  console.log('профиль:', ctx.profile, '\n');

  await ctx.chrome.evaluate('window.oblako.toggleAiPanel().then(function(){return 1})', 15000);
  await wait(1500);

  const panelT = await ctx.findTarget((t) => String(t.url).includes('aipanel'), 40);
  check('панель поднялась', !!panelT, panelT ? String(panelT.url).slice(0, 60) : 'таргета нет');
  if (!panelT) return;

  const panel = connectCdp(panelT);
  await panel.ready;
  await wait(800);

  // Панель открывается на вкладке «AI» — сперва переходим в «Приложения».
  // ⚠️ Подпись вкладки лежит ВНУТРИ кнопки (там ещё значок), поэтому ищем по кнопке, а не по
  // листовому узлу: первый вариант драйвера искал лист и вкладку не находил.
  const tab = await panel.evaluate(`(function(){
    var n = Array.prototype.slice.call(document.querySelectorAll('button, [role=tab]'))
      .filter(function(x){ return (x.textContent||'').trim() === 'Приложения'; })[0];
    if (!n) return 'нет вкладки';
    n.click();
    return 'ок';
  })()`);
  check('вкладка «Приложения» нажата', tab === 'ок', String(tab));
  await wait(900);

  // Приложение открывается кликом по своей плитке — клик всплывает до обработчика React.
  const opened = await panel.evaluate(`(function(){
    var n = Array.prototype.slice.call(document.querySelectorAll('*'))
      .filter(function(x){ return (x.textContent||'').trim() === 'Пояса' && x.children.length === 0; })[0];
    if (!n) return 'нет плитки';
    n.click();
    return 'кликнул';
  })()`);
  check('плитка «Пояса» нажата', opened === 'кликнул', String(opened));
  await wait(1400);

  const text = String(await panel.evaluate('document.body.innerText || ""'));
  const has = (s) => text.includes(s);
  // Часы живут в <input>, не в тексте карточки: innerText их не видит.
  const clocks = await panel.evaluate(`(function(){
    return Array.prototype.slice.call(document.querySelectorAll('input[aria-label^="Время"]'))
      .map(function(i){ return i.value; });
  })()`);

  check('приложение открылось (есть «Сейчас»)', has('Сейчас'));
  check('ряды поясов отрисованы', Array.isArray(clocks) && clocks.some((v) => /\d{1,2}:\d{2}/.test(String(v))),
    Array.isArray(clocks) ? clocks.slice(0, 4).join(' ') : String(clocks));
  check('есть смещение относительно своего пояса', has('как у вас') || /[+−]\d+ ч/.test(text));
  check('кнопка добавления на месте', has('Добавить пояс'));

  // ⚠️ Живой случай: поиск по «edt» не находил ничего — такой строки в списке ICU нет вовсе.
  await panel.evaluate(`(function(){
    var b = Array.prototype.slice.call(document.querySelectorAll('button'))
      .filter(function(x){ return (x.textContent||'').indexOf('Добавить пояс') >= 0; })[0];
    if (b) b.click();
    return 1;
  })()`);
  await wait(500);
  await panel.evaluate(`(function(){
    var i = document.querySelector('input[placeholder]');
    if (!i) return 'нет поля';
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'edt');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ввёл';
  })()`);
  await wait(600);
  const search = String(await panel.evaluate('document.body.innerText || ""'));
  check('поиск по «edt» находит Нью-Йорк', search.includes('New York'),
    search.split(String.fromCharCode(10)).filter(Boolean).slice(-4).join(' | '));

  // Полоса суток — div[role=slider]. Синтетический pointer часто не доходит до setPointerCapture,
  // поэтому сдвиг часов подтверждаем ещё и полем времени: это тот же onClock.
  const before = Array.isArray(clocks) ? String(clocks[0] ?? '') : '';
  const moved = await panel.evaluate(`(function(){
    var r = document.querySelector('[role=slider][aria-label="Сутки"]');
    if (!r) return 'нет полосы суток';
    var i = document.querySelector('input[aria-label^="Время"]');
    if (!i) return 'нет поля времени';
    var parts = String(i.value).split(':');
    var h = (Number(parts[0]) + 3) % 24;
    var next = String(h).padStart(2, '0') + ':' + (parts[1] || '00');
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, next);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.blur();
    return 'подвинул';
  })()`);
  check('полоса суток есть', moved === 'подвинул', String(moved));
  await wait(600);

  const afterClocks = await panel.evaluate(`(function(){
    return Array.prototype.slice.call(document.querySelectorAll('input[aria-label^="Время"]'))
      .map(function(i){ return i.value; });
  })()`);
  const afterFirst = Array.isArray(afterClocks) ? String(afterClocks[0] ?? '') : '';
  const after = String(await panel.evaluate('document.body.innerText || ""'));
  check('сдвиг на 3 часа поменял время', before !== '' && afterFirst !== '' && before !== afterFirst,
    `${before} → ${afterFirst}`);
  check('кнопка возврата «Сейчас» на месте', (after.match(/Сейчас/g) || []).length >= 1);

  console.log('\n— что видно на экране —');
  console.log(after.split('\n').filter(Boolean).slice(0, 14).map((l) => '   ' + l).join('\n'));
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
