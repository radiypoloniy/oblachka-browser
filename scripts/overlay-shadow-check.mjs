// Сторож геометрии оверлеев: тень обязана помещаться в запас вью, а запас — в зазор от якоря.
//
// ⚠️ Ловит класс поломок, который глазами диагностируется неделями, потому что выглядит не как
// баг, а как «некрасиво»: прозрачная WebContentsView обрезает всё за своей границей, поэтому
// тень с вылетом больше запаса срезается ровно по нижней кромке — мягкий скат превращается в
// резкий обрыв. Живые случаи: буфер обмена и история («тень слишком грубая и резкая»).
//
// Второе правило — про мышь: прозрачное поле под тень ХИТ-ТЕСТИТСЯ целиком, и если зазор от
// кнопки-якоря меньше запаса, верх вью наезжает на кнопку и та перестаёт нажиматься.
//
// Запуск: npm run overlay-shadow-check (или npm test -- overlay)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OVERLAY_SHADOW_MARGIN, OVERLAY_GAP, OVERLAY_FIELD_MAX_SHIFT, anchoredCardX } from '../shared/overlayMetrics.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/**
 * Максимальный вылет тени за границу элемента, отдельно по каждой стороне.
 * Ступень `Xpx Ypx Bpx` достаёт вниз на Y+B, вверх на B−Y, вбок на B±X. Разлёт (spread) в наших
 * тенях используется только кольцом (0 0 0 1px) и учитывается как прибавка к радиусу.
 */
function reach(shadow) {
  const steps = shadow.split(/,(?![^(]*\))/);
  let down = 0;
  let up = 0;
  let side = 0;
  for (const step of steps) {
    if (/inset/.test(step)) continue;
    // ⚠️ Нули в CSS пишутся БЕЗ единиц («0 8px 16px»), поэтому единица здесь необязательна:
    // регулярка только на «px» теряла первое число и считала вылет нулевым — то есть проверка
    // молча проходила бы на любой тени.
    // ⚠️ Цвет вырезается ДО разбора: числа внутри rgba(40,30,80,0.07) иначе читаются как
    // геометрия и дают выдуманный разлёт в 40 px.
    const geom = step.replace(/rgba?\([^)]*\)/g, ' ');
    const px = [...geom.matchAll(/(-?[\d.]+)(?:px)?(?=[\s,]|$)/g)].map((m) => parseFloat(m[1]));
    if (px.length < 3) continue;
    const [x, y, blur, spread = 0] = px;
    down = Math.max(down, y + blur + spread);
    up = Math.max(up, blur + spread - y);
    side = Math.max(side, Math.abs(x) + blur + spread);
  }
  return { down, up, side };
}

/** Значение токена из CSS-файла (последнее объявление выигрывает, как в каскаде). */
function token(file, name) {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const all = [...css.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g'))];
  if (!all.length) throw new Error(`${name} не найден в ${file}`);
  return all[all.length - 1][1].replace(/\s+/g, ' ').trim();
}

console.log('— тень оверлея помещается в запас вью —');
for (const [theme, file] of [['светлая', 'src/styles/tokens/shadows.css'], ['тёмная', 'src/styles/tokens/theme-dark.css']]) {
  const r = reach(token(file, '--shadow-overlay'));
  check(`${theme}: вылет вниз ${r.down} ≤ запас ${OVERLAY_SHADOW_MARGIN}`, r.down <= OVERLAY_SHADOW_MARGIN, true);
  check(`${theme}: вылет вверх ${r.up} ≤ запас`, r.up <= OVERLAY_SHADOW_MARGIN, true);
  check(`${theme}: вылет вбок ${r.side} ≤ запас`, r.side <= OVERLAY_SHADOW_MARGIN, true);
  // ⚠️ Тень, которая помещается с БОЛЬШИМ запасом, — тоже дефект: карточка висит в пустой рамке,
  // а рамка ловит клики. Нижняя граница держит запас честным.
  check(`${theme}: запас не раздут (вылет вниз ${r.down} ≥ половины запаса)`, r.down >= OVERLAY_SHADOW_MARGIN / 2, true);
}

console.log('\n— зазор от якоря не меньше запаса —');
// ⚠️ Именно этот инвариант ломался живьём: вью наезжала на кнопку-якорь, и та переставала
// нажиматься, пока поповер открыт.
check('общие константы: зазор ≥ запас', OVERLAY_GAP >= OVERLAY_SHADOW_MARGIN, true);

// ⚠️ Правило про зазор действует для поповеров, висящих на КНОПКЕ. У поповера перевода и
// дропдауна омнибокса якорь другой: выделенный текст и сама строка, — наезд прозрачного поля на
// них ничего не ломает (дропдаун вдобавок неактивируемое окно и фокус не забирает), и зазор там
// намеренно 8 при запасе 40. Заносим их исключением явно, а не смягчаем правило для всех.
const ANCHORLESS = ['TranslatePopoverManager.ts', 'SuggestDropdownManager.ts'];
const managers = fs.readdirSync(path.join(ROOT, 'electron'))
  .filter((f) => /PopoverManager\.ts$/.test(f) && !ANCHORLESS.includes(f));
for (const file of managers) {
  const src = read(`electron/${file}`);
  const gap = /^const GAP = (\d+)/m.exec(src);
  const margin = /^const SHADOW_MARGIN = (\d+)/m.exec(src);
  if (!gap || !margin) continue; // менеджер живёт на общих константах — они проверены выше
  check(`${file}: зазор ${gap[1]} ≥ запас ${margin[1]}`, Number(gap[1]) >= Number(margin[1]), true);
}

console.log('\n— запас не продублирован руками —');
// ⚠️ Дубль числа в main и renderer с припиской «держать в синхроне» — это и есть механизм, которым
// они расходятся. Пять якорных поповеров уже разъезжались так: 16 против 20, 24 и 40 у соседей.
const handWritten = [];
for (const dir of ['electron', 'src']) {
  for (const file of fs.readdirSync(path.join(ROOT, dir))) {
    if (!/\.tsx?$/.test(file)) continue;
    const src = read(`${dir}/${file}`);
    const own = /const SHADOW_MARGIN = \d+/.test(src);
    const anchored = /Popover/i.test(file) && !/translate/i.test(file);
    if (own && anchored) handWritten.push(`${dir}/${file}`);
  }
}
check('якорные поповеры берут запас из shared/overlayMetrics', handWritten, []);

console.log('\n— тени не тонированы чужим цветом —');
// ⚠️ Фиолетовый заходил в систему ТРИЖДЫ, и тень — самый незаметный из путей: цвет тени никто не
// называет, его видят как «серую грязь». Здесь стояли rgba(30,25,60) и rgba(40,30,80) (синий канал
// вдвое выше красного) и rgba(12,30,22) (зелёный с уклоном в циан) — одинаковые во всех шести
// палитрах. Тон обязан ВЫВОДИТЬСЯ из --shadow-tint, то есть из чернил земли.
for (const file of ['src/styles/tokens/shadows.css', 'src/styles/tokens/colors.css', 'src/styles/tokens/theme-dark.css']) {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const tinted = [];
  for (const [, name, value] of css.matchAll(/(--(?:shadow|ring|inner)[\w-]*)\s*:\s*([^;]+);/g)) {
    if (name === '--shadow-tint') continue;
    for (const [, r, g, b] of value.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) {
      const [R, G, B] = [r, g, b].map(Number);
      // Чёрный и белый законны: это отсутствие света и сам свет. Всё остальное — чужой тон.
      if (!(R === G && G === B)) tinted.push(`${name}: rgba(${R},${G},${B})`);
    }
  }
  check(`${file}: цветных литералов в тенях нет`, tinted, []);
}

console.log('\n— карточка над полем формы —');
// ⚠️ Правило Chrome, принятое по измеренной причине: карточка ЦЕНТРИРУЕТСЯ на поле, а не жмётся к
// его краю, иначе она накрывает подписи полей (они прижаты влево) и человек не видит, что за поле
// идёт следующим. У нас до этого карточка паролей жалась к ПРАВОМУ краю поля — над широким полем
// она появлялась где угодно, только не там, куда кликнули (живая жалоба).
const W = 280;   // ширина карточки паролей
const M = 8;     // поле окна
check('узкое поле: карточка центрируется по нему',
  anchoredCardX(100, 200, W, 1200, M) + W / 2, 100 + 200 / 2);
check('поле шириной с карточку: край в край', anchoredCardX(100, W, W, 1200, M), 100);
// ⚠️ Широкое поле — единственное место, где мы от Chrome сознательно отступаем: честный центр
// поля во всю колонку уводит карточку на сотни пикселей от клика.
check(`широкое поле: сдвиг не больше ${OVERLAY_FIELD_MAX_SHIFT}`,
  anchoredCardX(100, 900, W, 1600, M) - 100, OVERLAY_FIELD_MAX_SHIFT);
check('поле у правого края: карточка не вылезает за окно',
  anchoredCardX(1000, 150, W, 1200, M) + W <= 1200 - M, true);
check('поле у левого края: карточка не левее поля окна',
  anchoredCardX(4, 100, W, 1200, M), M);
// Окно уже карточки (узкое лёгкое окно) — деление на отрицательный остаток не должно давать
// отрицательный x: карточка просто прижимается к левому полю.
check('окно уже карточки: x не отрицательный', anchoredCardX(10, 100, W, 200, M), M);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
