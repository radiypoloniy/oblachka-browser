// Виджет календаря не мерцает ни на одной высоте плитки. Не *-check.mjs — поднимает приложение.
//
// ⚠️ Случай из жизни, 31.08.2026: «календарь мерцает». Причина — замкнутый круг в раскладке.
// Решение «показывать ли строку года» принималось по высоте СЕТКИ дней, а сетка сама зависела от
// этого решения: без года ей достаётся больше места, с годом меньше. На плитке высотой 260…300 px
// круг не сходился, и год появлялся-исчезал сотни раз в секунду. Замер тогда: 2000+ перерисовок
// за 0,7 с внутри полосы и ровно ноль вне её.
//
// ⚠️ Почему ЖИВОЙ прогон, а не проверка чистой логики. Мерцание — свойство РАСКЛАДКИ: оно
// возникает из того, как настоящий браузер считает проценты, зазоры и высоту строки года.
// Ни `tsc`, ни `npm test` такого не видят по построению, и никакая арифметика в отрыве от DOM
// не докажет, что круг разомкнут.
//
// ⚠️ Полоса взята не с потолка: плитка календаря в ДВА РЯДА — это 234…248 px на мелком масштабе,
// 254…268 на среднем и 294…308 на крупном (клетка 110/120/140, зазор 14…24, см. computeGrid).
// То есть мерцало на крупном всегда, на среднем при широком окне, а на мелком не мерцало вовсе —
// поэтому баг и жил незамеченным. Прогон идёт с запасом по обе стороны от всех трёх.
//
// ⚠️ Календарь на столе есть в раскладке по умолчанию (`w-calendar`), поэтому ставить его не
// нужно — профиль стенда чистый и получает стандартный стол.
//
// Запуск: npm run drive -- calendar-flicker
import { withStand, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

// ⚠️ Меряем ПЕРЕРИСОВКИ, а не «правильный ли вид». Мерцание — это не неверная раскладка, а
// раскладка, которая не может остановиться: любой её кадр сам по себе выглядит законно.
const SWEEP = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Календарную сетку узнаём по семи колонкам — другой такой раскладки на столе нет.
  const grids = [...document.querySelectorAll('div')].filter((d) => {
    const c = getComputedStyle(d).gridTemplateColumns;
    return c && c.split(' ').length === 7;
  });
  if (grids.length === 0) return { ошибка: 'виджет календаря не найден на столе' };
  const grid = grids[0];
  const shell = grid.parentElement;
  // Плитка — ближайший предок с высотой, заданной в пикселях (её задаёт сетка стола).
  let frame = shell;
  for (let i = 0; i < 8 && frame && !/px/.test(frame.style.height || ''); i++) frame = frame.parentElement;
  if (!frame) return { ошибка: 'плитка календаря не найдена' };

  const was = frame.style.height;
  const out = [];
  for (let h = 220; h <= 320; h += 4) {
    frame.style.height = h + 'px';
    await sleep(260);            // дать раскладке устояться
    let mutations = 0;
    const mo = new MutationObserver((recs) => { mutations += recs.length; });
    mo.observe(shell, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    await sleep(420);            // окно наблюдения
    mo.disconnect();
    // ⚠️ Заодно РАЗМЕР. Мерцание и растягивание — разные поломки одной природы (раскладка,
    // которая не сходится), и ловить их надо в одном прогоне: высоты уже перебраны, замер стоит
    // ноль. Оболочка обязана в точности совпадать с плиткой, а сетка — помещаться в свою коробку;
    // расхождение здесь и есть «виджет растянулся».
    const f = frame.getBoundingClientRect();
    const sh = shell.getBoundingClientRect();
    const g = grid.getBoundingClientRect();
    out.push({
      h, mutations,
      spill: Math.round(sh.height - f.height),
      over: grid.scrollHeight - Math.round(g.height),
    });
  }
  frame.style.height = was;
  return out;
})()`;


// Плитка стоит на месте, пока её никто не трогает.
//
// ⚠️ ЭТО ДРУГАЯ ПОЛОМКА, чем мерцание, и прежний замер её НЕ ЛОВИЛ. Живая жалоба: календарь
// «медленно растягивался и заезжал под виджет за ним», на чистом профиле, без единого действия
// человека. Сторож размера выше сравнивает ОБОЛОЧКУ с ПЛИТКОЙ — а когда растёт сама плитка,
// оболочка растёт вместе с ней, и расхождения нет. Слепое пятно ровно в форме симптома.
//
// ⚠️ Наблюдение 90 секунд, потому что единственное, что происходит в календаре само, — тик раз в
// минуту (виджет обязан пережить полночь). Окно короче минуты не захватило бы ни одного тика, то
// есть проверяло бы покой там, где покой ничем не нарушается.
//
// ⚠️ Ложных срабатываний у этой проверки нет по построению: неподвижная плитка неподвижна всегда.
// Поймать она может не каждый раз — поломка была «один случай из нескольких», — но когда поймает,
// назовёт и размер, и то, что именно поехало: инлайновый стиль (значит виновата раскладка стола)
// или только фактический размер (значит CSS).
const FIND_TILE = `(() => {
  const grids = [...document.querySelectorAll('div')].filter((d) => {
    const c = getComputedStyle(d).gridTemplateColumns;
    return c && c.split(' ').length === 7;
  });
  if (grids.length === 0) return false;
  let frame = grids[0].parentElement;
  for (let i = 0; i < 8 && frame && !/px/.test(frame.style.height || ''); i++) frame = frame.parentElement;
  if (!frame) return false;
  // ⚠️ Запоминаем не только плитку, но и ОКРУЖЕНИЕ: область сетки (maxWidth 1320, см.
  // DesktopGrid.tsx) и контейнер прокрутки. Когда сторож сработает, по ним сразу видно, что
  // поехало: ширина области — значит виновато измерение, а если область неподвижна, а плитка
  // изменилась — значит переписалась сама раскладка (колонки или масштаб стола).
  let area = frame;
  for (let i = 0; i < 10 && area && area.style.maxWidth !== '1320px'; i++) area = area.parentElement;
  let scroller = frame;
  for (let i = 0; i < 12 && scroller && getComputedStyle(scroller).overflowY !== 'auto'; i++) scroller = scroller.parentElement;
  window.__calTile = { frame, area, scroller };
  return true;
})()`;

const TILE = `(() => {
  const c = window.__calTile;
  if (!c) return null;
  const r = c.frame.getBoundingClientRect();
  const a = c.area ? c.area.getBoundingClientRect().width : -1;
  const s = c.scroller ? c.scroller.getBoundingClientRect().width : -1;
  return {
    style: c.frame.style.height + ' ' + c.frame.style.width,
    w: Math.round(r.width), h: Math.round(r.height),
    area: Math.round(a), scroller: Math.round(s), win: window.innerWidth,
  };
})()`;

await withStand(async (ctx) => {
  console.log('профиль:', ctx.profile, '\n');
  await wait(4000);

  const rows = await ctx.chrome.evaluate(SWEEP, 120000);
  if (!Array.isArray(rows)) {
    check('прогон по высотам выполнен', false, JSON.stringify(rows));
  } else {
    // ⚠️ Порог не ноль: за 0,42 с в плитке законно случается пара мутаций (обводка хода, смена
    // минуты). Мерцание отличается порядком величины — сотни и тысячи, — а не единицами.
    const noisy = rows.filter((r) => r.mutations > 30);
    check('прогон по высотам выполнен', true, `${rows.length} размеров, 220…320 px`);
    if (noisy.length === 0) {
      ok++;
      console.log('  ok   ни на одной высоте плитка не перерисовывается без остановки');
    } else {
      bad++;
      console.log(` FAIL  плитка мерцает на ${noisy.length} размерах из ${rows.length}`);
      for (const r of noisy.slice(0, 12)) console.log(`         высота ${r.h} px — ${r.mutations} перерисовок за 0,42 с`);
    }
    const worst = rows.reduce((m, r) => Math.max(m, r.mutations), 0);
    check('худший размер укладывается в разумное число перерисовок', worst <= 30, `${worst}`);

    // ⚠️ Порог 2 px, а не 0: getBoundingClientRect отдаёт дробные значения, и округление даёт
    // пиксель туда-сюда законно. Растягивание — это десятки пикселей, а не единицы.
    const spilled = rows.filter((r) => Math.abs(r.spill) > 2);
    check('оболочка виджета не вылезает за плитку', spilled.length === 0,
      spilled.length ? `на ${spilled.length} высотах, худшая ${spilled[0].h} px: ${spilled[0].spill} px` : 'на всех высотах совпадает');
    const overflowed = rows.filter((r) => r.over > 2);
    check('сетка дней помещается в свою коробку', overflowed.length === 0,
      overflowed.length ? `на ${overflowed.length} высотах, худшая ${overflowed[0].h} px: лишку ${overflowed[0].over} px` : 'на всех высотах помещается');
  }

  // ── Плитка не растёт сама ─────────────────────────────────────────────────
  // ⚠️ Опрос идёт СО СТОРОНЫ NODE короткими замерами. Один длинный evaluate на минуты подвешивает
  // CDP-мост стенда намертво — проверено дважды, оба раза приходилось снимать дерево процессов.
  // ⚠️ Пауза обязательна: перебор высот выше СТАВИЛ плитке свои размеры и вернул исходный в самом
  // конце. Без ожидания слежка ловит остаток чужой раскладки и объявляет ростом то, что на деле
  // возврат к норме. Поймано этим же прогоном: старт 320 при инлайновом стиле 264.
  await wait(2500);
  const found = await ctx.chrome.evaluate(FIND_TILE);
  if (!found) {
    check('наблюдение за неподвижностью выполнено', false, 'плитка календаря не найдена');
  } else {
    const first = await ctx.chrome.evaluate(TILE);
    let worst = first;
    for (let i = 0; i < 45; i++) {          // 45 x 2 c = 90 с, минутный тик внутри гарантированно
      await wait(2000);
      const now = await ctx.chrome.evaluate(TILE);
      if (!now) continue;
      if (Math.abs(now.h - first.h) > Math.abs(worst.h - first.h)
        || Math.abs(now.w - first.w) > Math.abs(worst.w - first.w)) worst = now;
    }
    check('наблюдение за неподвижностью выполнено', true, `90 с, старт ${first.w}x${first.h}`);
    const dw = worst.w - first.w;
    const dh = worst.h - first.h;
    check('плитка не растёт сама по себе', Math.abs(dw) <= 1 && Math.abs(dh) <= 1,
      (dw || dh)
        // ⚠️ Печатаем ОКРУЖЕНИЕ вместе с плиткой: если поехала область сетки — виновато измерение
        // ширины, а если область стоит, а плитка изменилась — переписалась сама раскладка стола
        // (колонки или масштаб). Без этих трёх чисел следующий разбор начнётся с нуля.
        ? `поехало на ${dw}x${dh} px, стиль «${first.style}» → «${worst.style}»; `
          + `область ${first.area}→${worst.area}, прокрутка ${first.scroller}→${worst.scroller}, окно ${first.win}→${worst.win}`
        : 'за 90 секунд не сдвинулась');
  }
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
