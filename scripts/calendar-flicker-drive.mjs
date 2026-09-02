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
// ⚠️ ПЕРЕБОР ВЫСОТ ИДЁТ СО СТОРОНЫ NODE, короткими замерами, а не одним длинным evaluate с
// циклом внутри страницы. Длинный evaluate подвешивает CDP-мост стенда намертво — это уже третий
// раз в этом драйвере: сперва на четырёхминутной слежке, потом на минутной, теперь на переборе,
// который сам по себе работал, но перестал после того, как перед ним появилась долгая слежка.
// Правило простое и без исключений: через мост ходим часто и коротко.
const PREPARE = `(() => {
  const grids = [...document.querySelectorAll('div')].filter((d) => {
    const c = getComputedStyle(d).gridTemplateColumns;
    return c && c.split(' ').length === 7;
  });
  if (grids.length === 0) return { ошибка: 'виджет календаря не найден на столе' };
  const grid = grids[0];
  const shell = grid.parentElement;
  let frame = shell;
  for (let i = 0; i < 8 && frame && !/px/.test(frame.style.height || ''); i++) frame = frame.parentElement;
  if (!frame) return { ошибка: 'плитка календаря не найдена' };
  window.__sweep = { grid, shell, frame, was: frame.style.height, mutations: 0, mo: null };
  return { ok: true };
})()`;

const setHeight = (h) => `(() => { window.__sweep.frame.style.height = '${h}px'; return true; })()`;

// ⚠️ Меряем ПЕРЕРИСОВКИ, а не «правильный ли вид». Мерцание — это не неверная раскладка, а
// раскладка, которая не может остановиться: любой её кадр сам по себе выглядит законно.
const WATCH_START = `(() => {
  const s = window.__sweep;
  s.mutations = 0;
  s.mo = new MutationObserver((recs) => { s.mutations += recs.length; });
  s.mo.observe(s.shell, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  return true;
})()`;

const WATCH_STOP = `(() => {
  const s = window.__sweep;
  s.mo.disconnect();
  const f = s.frame.getBoundingClientRect();
  const sh = s.shell.getBoundingClientRect();
  const g = s.grid.getBoundingClientRect();
  return {
    mutations: s.mutations,
    // ⚠️ Заодно РАЗМЕР. Мерцание и растягивание — разные поломки одной природы (раскладка, которая
    // не сходится), и ловить их надо в одном прогоне: высоты уже перебраны, замер стоит ноль.
    spill: Math.round(sh.height - f.height),
    over: s.grid.scrollHeight - Math.round(g.height),
  };
})()`;

const RESTORE = `(() => { window.__sweep.frame.style.height = window.__sweep.was; return true; })()`;

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

  // ── Плитка не растёт сама ─────────────────────────────────────────────────
  // ⚠️ Опрос идёт СО СТОРОНЫ NODE короткими замерами. Один длинный evaluate на минуты подвешивает
  // CDP-мост стенда намертво — проверено дважды, оба раза приходилось снимать дерево процессов.
  const found = await ctx.chrome.evaluate(FIND_TILE);
  if (!found) {
    check('наблюдение за неподвижностью выполнено', false, 'плитка календаря не найдена');
  } else {
    const first = await ctx.chrome.evaluate(TILE);
    let worst = first;
    let skipped = 0;
    for (let i = 0; i < 32; i++) {          // 32 x 2 c = 64 с: минутный тик в такое окно попадает
      // гарантированно, а прогон укладывается в общий предел драйвера (180 с).
      await wait(2000);
      const now = await ctx.chrome.evaluate(TILE);
      if (!now) continue;
      // ⚠️ Два замера, которые НЕ считаются ростом, и оба пойманы живым прогоном.
      //  • Элемент отцепился (область 0) — стол пересобрался, и мы держим ссылку на мёртвый узел.
      //  • Изменилось окно — тогда плитка обязана измениться, это и есть правильная работа сетки.
      // Без этих двух отказов сторож краснел бы на ровном месте и обесценил бы сам себя.
      if (now.area === 0 || now.win !== first.win) { skipped++; continue; }
      if (Math.abs(now.h - first.h) > Math.abs(worst.h - first.h)
        || Math.abs(now.w - first.w) > Math.abs(worst.w - first.w)) worst = now;
    }
    check('наблюдение за неподвижностью выполнено', true,
      `64 с, старт ${first.w}x${first.h}${skipped ? `, пропущено замеров ${skipped}` : ''}`);
    const dw = worst.w - first.w;
    const dh = worst.h - first.h;
    check('плитка не растёт сама по себе', Math.abs(dw) <= 1 && Math.abs(dh) <= 1,
      (dw || dh)
        // ⚠️ Печатаем ОКРУЖЕНИЕ вместе с плиткой: если поехала область сетки — виновато измерение
        // ширины, а если область стоит, а плитка изменилась — переписалась сама раскладка стола
        // (колонки или масштаб). Без этих трёх чисел следующий разбор начнётся с нуля.
        ? `поехало на ${dw}x${dh} px, стиль «${first.style}» → «${worst.style}»; `
          + `область ${first.area}→${worst.area}, прокрутка ${first.scroller}→${worst.scroller}, окно ${first.win}→${worst.win}`
        : 'за 64 секунды не сдвинулась');
  }
  // ⚠️ ПОРЯДОК ВАЖЕН: неподвижность меряется ПЕРВОЙ, по нетронутому столу. Перебор высот ниже сам
  // ставит плитке размеры, и его восстановление исходного React не видит — на следующем рендере
  // раскладка возвращает своё. После перебора любое шевеление нельзя честно назвать
  // самопроизвольным. Поймано живым прогоном: слежка стартовала с 320 px (последняя высота
  // перебора) и «обнаруживала» возврат к настоящим 264 как рост на 56 px.
  const prepared = await ctx.chrome.evaluate(PREPARE);
  const rows = [];
  if (prepared?.ok) {
    for (let h = 220; h <= 320; h += 4) {
      await ctx.chrome.evaluate(setHeight(h));
      await wait(200);                      // дать раскладке устояться
      await ctx.chrome.evaluate(WATCH_START);
      await wait(420);                      // окно наблюдения
      const r = await ctx.chrome.evaluate(WATCH_STOP);
      if (r) rows.push({ h, ...r });
    }
    await ctx.chrome.evaluate(RESTORE);
  }
  if (rows.length === 0) {
    check('прогон по высотам выполнен', false, JSON.stringify(prepared));
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

});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
