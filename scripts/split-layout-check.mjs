// Геометрия split-панелей (shared/layout.ts) — без electron, обычным node.
//
// ⚠️ Ошибка тут видна глазом и выглядит как брак: страница уезжает на несколько пикселей мимо
// своего канта, из-под неё торчит подложка. Формула ОДНА на всех потребителей именно потому, что
// раньше стояла двумя копиями и разъезжалась при каждой правке.
//
// ⚠️ SHELL_MARGIN этой проверкой НЕ держится и держаться не может — единственный выживший мутант
// после прогона 31.08.2026, и он честный. Константа не участвует ни в одной формуле `layout.ts`:
// её напрямую импортируют `App.tsx` и `aipanel.tsx` как отступ в вёрстке. Проверить её значение
// можно только глазом на экране, а тавтологический ассерт `SHELL_MARGIN === 12` ничего не
// охраняет — он лишь заставит поправить две строки вместо одной. Не заводить.
//
// Запуск: npm test -- split-layout
import {
  splitPaneBounds, clampSplitRatio, SPLIT_RATIO_MIN, SPLIT_RATIO_MAX,
  ISLAND_GAP, SPLIT_HEADER_HEIGHT, SPLIT_PANE_INSET, SPLIT_PANE_RADIUS,
} from '../shared/layout.ts';
import { SPLIT_RATIO_MIN as SESSION_MIN, SPLIT_RATIO_MAX as SESSION_MAX } from '../shared/sessionTree.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

// Область контента: остров во весь экран под тулбаром.
const CONTENT = { x: 100, y: 50, width: 1000, height: 800 };

console.log('\n— две панели делят область без нахлёста и без щели —');
{
  const left = splitPaneBounds(CONTENT, 'left', 0.5);
  const right = splitPaneBounds(CONTENT, 'right', 0.5);
  // Между кантами панелей должен остаться ровно ISLAND_GAP — ни больше, ни меньше.
  const gap = right.x - (left.x + left.width);
  check('зазор между панелями равен ISLAND_GAP', gap, ISLAND_GAP + SPLIT_PANE_INSET * 2);
  check('правая панель кончается там же, где область контента',
    right.x + right.width + SPLIT_PANE_INSET, CONTENT.x + CONTENT.width);
  check('левая начинается от края области', left.x, CONTENT.x + SPLIT_PANE_INSET);
  check('высота у обеих одинаковая', left.height, right.height);
  check('обе начинаются под полосой заголовка',
    [left.y, right.y], [CONTENT.y + SPLIT_HEADER_HEIGHT + SPLIT_PANE_INSET, CONTENT.y + SPLIT_HEADER_HEIGHT + SPLIT_PANE_INSET]);
}
{
  // Ширины при любой доле обязаны в сумме давать всю область минус зазор и канты.
  for (const ratio of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const l = splitPaneBounds(CONTENT, 'left', ratio);
    const r = splitPaneBounds(CONTENT, 'right', ratio);
    const total = l.width + r.width + ISLAND_GAP + SPLIT_PANE_INSET * 4;
    check(`ширины сходятся при доле ${ratio}`, total, CONTENT.width);
  }
}

console.log('\n— доля управляет размером —');
{
  const narrow = splitPaneBounds(CONTENT, 'left', 0.2);
  const wide = splitPaneBounds(CONTENT, 'left', 0.8);
  check('при большей доле левая панель шире', wide.width > narrow.width, true);
  check('высота от доли не зависит', narrow.height, wide.height);
}

console.log('\n— узкое окно не даёт отрицательных размеров —');
{
  // ⚠️ Отрицательные размеры вьюхи — это не «маленькая панель», а мусор в раскладке.
  // Сравниваем с нулём точно, а не через `>= 0`: зажим `Math.max(0, …)` спокойно менялся на
  // `Math.max(1, …)`, и нестрогое сравнение этого не замечало (мутационный прогон).
  const tiny = { x: 0, y: 0, width: 10, height: 10 };
  const l = splitPaneBounds(tiny, 'left', 0.5);
  const r = splitPaneBounds(tiny, 'right', 0.5);
  check('вырожденная панель схлопывается ровно в ноль, а не в минус и не в единицу',
    [l.width, r.width, l.height, r.height], [0, 0, 0, 0]);
}

console.log('\n— эталонная геометрия: конкретные числа, а не инварианты —');
{
  // ⚠️ Случаи добавлены по итогам мутационного прогона (npm run mutate -- layout).
  // Инварианты выше — «ширины сходятся», «зазор равен ISLAND_GAP» — проверяют формулу ЧЕРЕЗ ТЕ ЖЕ
  // константы, из которых она собрана. Поэтому они держат форму, но слепы к самим числам: сдвиг
  // ISLAND_GAP с 10 на 11 двигает обе стороны равенства, а замена `content.width - ISLAND_GAP` на
  // `+ ISLAND_GAP` вообще сокращается в сумме — панели разъезжались бы на экране, а прогон
  // оставался зелёным. Лечится единственным способом: эталон с ЛИТЕРАЛЬНЫМИ числами.
  //
  // ⚠️ Это осознанный детектор изменений. Меняешь SPLIT_PANE_INSET или ISLAND_GAP — эти четыре
  // строки обязаны покраснеть и быть пересчитаны руками. В том и смысл: тюнинговое число не
  // должно уезжать молча (тот же приём, что golden-инвентарь каналов в contract-check).
  const half = [splitPaneBounds(CONTENT, 'left', 0.5), splitPaneBounds(CONTENT, 'right', 0.5)];
  check('доля 0.5 — левая панель', half[0], { x: 106, y: 92, width: 483, height: 752 });
  check('доля 0.5 — правая панель', half[1], { x: 611, y: 92, width: 483, height: 752 });

  // Несимметричная доля отдельно: при 0.5 умножение на splitRatio даёт то же, что деление
  // пополам, и часть арифметических промахов на симметричном случае не проявляется.
  const skew = [splitPaneBounds(CONTENT, 'left', 0.35), splitPaneBounds(CONTENT, 'right', 0.35)];
  check('доля 0.35 — левая панель', skew[0], { x: 106, y: 92, width: 334, height: 752 });
  check('доля 0.35 — правая панель', skew[1], { x: 462, y: 92, width: 632, height: 752 });
}

console.log('\n— зажим доли —');
{
  check('слишком узкая доля подтягивается', clampSplitRatio(0.01), SPLIT_RATIO_MIN);
  check('слишком широкая обрезается', clampSplitRatio(0.99), SPLIT_RATIO_MAX);
  check('нормальная не трогается', clampSplitRatio(0.42), 0.42);
  // ratio может прийти ИЗ ФАЙЛА сессии — то есть быть каким угодно.
  check('отрицательная из файла', clampSplitRatio(-5), SPLIT_RATIO_MIN);
  check('на границах остаётся собой', [clampSplitRatio(SPLIT_RATIO_MIN), clampSplitRatio(SPLIT_RATIO_MAX)],
    [SPLIT_RATIO_MIN, SPLIT_RATIO_MAX]);
}

console.log('\n— пределы доли в двух модулях обязаны совпадать —');
{
  // ⚠️ shared/sessionTree.ts держит свои копии этих чисел: значимых импортов между shared-модулями
  // быть не может (проверки гоняются голым node, а он требует расширения в пути, которого tsc с
  // эмитом не примет). Копия — риск расхождения, поэтому равенство проверяется машиной, а не
  // комментарием «не забудь поправить оба места».
  check('минимум совпадает с копией в sessionTree', SESSION_MIN, SPLIT_RATIO_MIN);
  check('максимум совпадает с копией в sessionTree', SESSION_MAX, SPLIT_RATIO_MAX);
}

console.log('\n— кант концентричен острову —');
{
  // Радиус карточки задают ОБЕ стороны: main — самой вьюхе, renderer — канту вокруг неё.
  check('радиус панели = радиус острова минус кант', SPLIT_PANE_RADIUS, 20 - SPLIT_PANE_INSET);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
