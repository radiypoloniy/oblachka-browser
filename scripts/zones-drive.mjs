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

  check('приложение открылось (есть «Сейчас»)', has('Сейчас'));
  check('ряды поясов отрисованы', /\d{2}:\d{2}/.test(text), (text.match(/\d{2}:\d{2}/g) || []).slice(0, 4).join(' '));
  check('есть смещение относительно своего пояса', has('как у вас') || /[+−]\d+ ч/.test(text));
  check('кнопка добавления на месте', has('Добавить пояс'));

  // Ползунок: двигаем и смотрим, изменилось ли показанное время.
  const before = (text.match(/\d{2}:\d{2}/g) || [])[0] ?? '';
  const moved = await panel.evaluate(`(function(){
    var r = document.querySelector('input[type=range]');
    if (!r) return 'нет ползунка';
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(r, '180');
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
    return 'подвинул';
  })()`);
  check('ползунок есть', moved === 'подвинул', String(moved));
  await wait(600);

  const after = String(await panel.evaluate('document.body.innerText || ""'));
  const afterFirst = (after.match(/\d{2}:\d{2}/g) || [])[0] ?? '';
  check('сдвиг на 3 часа поменял время', before !== '' && afterFirst !== '' && before !== afterFirst,
    `${before} → ${afterFirst}`);
  check('подпись сдвига появилась', after.includes('3 ч'), after.split('\n').slice(0, 3).join(' | '));
  check('кнопка возврата «Сейчас» появилась', (after.match(/Сейчас/g) || []).length >= 1);

  console.log('\n— что видно на экране —');
  console.log(after.split('\n').filter(Boolean).slice(0, 14).map((l) => '   ' + l).join('\n'));
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
