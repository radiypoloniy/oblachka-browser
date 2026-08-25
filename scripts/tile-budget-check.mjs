// Бюджет плитки стола (shared/tileBudget.ts) — без electron, обычным node.
//
// ⚠️ Случаи взяты из разбора «узкое окно» (25.08.2026), а не выдуманы. Клетка стола зависит от
// ширины области: 132 (потолок) шире 862 px, 122 при 800, 105 при 700, 95 при 640 — это минимум
// окна (900 px за вычетом сайдбара). Раньше блоки погоды включались по порогу `box.height > 150`,
// и на клетке 105 почасовому ряду не хватало 26 px — низ ряда срезался `overflow: hidden`.
//
// Главный инвариант здесь один и он проверяется на каждом размере: СУММА ЯРУСОВ НЕ ПРЕВЫШАЕТ
// ВЫСОТУ КОРОБКИ. Всё остальное — следствия.
//
// Запуск: npm test -- tile-budget
import {
  densityOf, padOf, fromCell, fitsBlock, weatherFit, musicFit, tileGridCell, CELL_REF,
} from '../shared/tileBudget.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

/** Плитка 2×2 при данной клетке — зазор сетки 14 px (GRID_GAP). */
const tile2x2 = (cell) => ({ width: cell * 2 + 14, height: cell * 2 + 14 });

/**
 * Сколько плитка погоды займёт по вёрстке при таком решении. Числа те же, что в tileBudget.ts:
 * если они разъедутся, разъедется и вёрстка — поэтому дублируются здесь намеренно, как ожидание.
 */
function weatherUsed(fit, cell) {
  const pad = padOf(densityOf(cell));
  return pad * 2 + 19 + 4 + fit.tempSize + 20
    + (fit.showAir ? 22 : 0)
    + (fit.hours > 0 ? 45 + fit.hourIcon : 0);
}

console.log('\n— плотность идёт за клеткой —');
{
  check('потолок клетки — просторно', densityOf(132), 'roomy');
  check('окно поджали (105) — тесновато', densityOf(105), 'snug');
  check('минимум окна (95) — тесновато', densityOf(95), 'snug');
  check('клетка 91 — тесно', densityOf(91), 'tight');
  check('граница 92 — уже не тесно', densityOf(92), 'snug');
  check('граница 116 — уже просторно', densityOf(116), 'roomy');
  check('поля по плотности', [padOf('tight'), padOf('snug'), padOf('roomy')], [10, 12, 16]);
}

console.log('\n— абсолютные размеры ужимаются вместе с клеткой —');
{
  check('на потолке клетки размер не меняется', fromCell(30, CELL_REF), 30);
  check('клетка 105 — значок часа мельче', fromCell(30, 105, 20), 24);
  check('клетка 95 — ещё мельче', fromCell(30, 95, 20), 22);
  check('нижний предел соблюдается', fromCell(30, 40, 20), 20);
  // ⚠️ Клетка выше потолка не бывает (см. computeGrid), но если бы стала — размер не должен расти:
  // иконка в 40 px на плитке ломала бы ряд по ширине.
  check('выше потолка не растёт', fromCell(30, 200), 30);
  check('ячейка топ-сайтов на потолке — прежние 76×80', tileGridCell(CELL_REF), { w: 76, h: 80 });
  check('ячейка топ-сайтов на клетке 95', tileGridCell(95), { w: 58, h: 62 });
}

console.log('\n— погода: широкое окно, всё влезает —');
{
  const cell = 132;
  const box = tile2x2(cell);
  const fit = weatherFit(box, cell, false, { air: true, hours: 6 });
  check('строка воздуха показана', fit.showAir, true);
  check('почасовой ряд — три столбца (плитка не широкая)', fit.hours, 3);
  check('значок часа в полную величину', fit.hourIcon, 30);
  check('сумма ярусов влезает в коробку', weatherUsed(fit, cell) <= box.height, true);
}

console.log('\n— погода: клетка 105 — тот самый случай со срезом 26 px —');
{
  const cell = 105;
  const box = tile2x2(cell); // 224×224
  const fit = weatherFit(box, cell, false, { air: true, hours: 6 });
  check('коробка та самая', box.height, 224);
  check('число прижато потолком плотности', fit.tempSize, 56);
  check('строка воздуха осталась', fit.showAir, true);
  check('почасовой ряд остался — ради него и жали число', fit.hours, 3);
  check('значок часа ужат до 24', fit.hourIcon, 24);
  check('сумма ярусов влезает в коробку', weatherUsed(fit, cell) <= box.height, true);
  // ⚠️ Раньше здесь было ровно наоборот: порог 150 включал ряд, а места не было — низ срезался.
  check('запас не отрицательный', box.height - weatherUsed(fit, cell) >= 0, true);
}

console.log('\n— погода: минимум окна (клетка 95) — ряд гаснет, число забирает место —');
{
  const cell = 95;
  const box = tile2x2(cell); // 204×204
  const fit = weatherFit(box, cell, false, { air: true, hours: 6 });
  check('коробка та самая', box.height, 204);
  check('почасовому ряду места нет', fit.hours, 0);
  // Ряда нет — держать число прижатым больше незачем, иначе внизу пустая дыра.
  check('число выросло до потолка', fit.tempSize, 64);
  check('строка воздуха уцелела', fit.showAir, true);
  check('сумма ярусов влезает в коробку', weatherUsed(fit, cell) <= box.height, true);
}

console.log('\n— погода: низкая широкая плитка (4×1) —');
{
  const cell = 132;
  const box = { width: cell * 4 + 42, height: cell };
  const fit = weatherFit(box, cell, true, { air: true, hours: 6 });
  check('ни воздуха, ни ряда — место только на главное', [fit.showAir, fit.hours], [false, 0]);
  check('сумма ярусов влезает в коробку', weatherUsed(fit, cell) <= box.height, true);
}

console.log('\n— погода: широкая высокая плитка берёт шесть столбцов —');
{
  const cell = 132;
  const box = { width: cell * 4 + 42, height: cell * 2 + 14 };
  const fit = weatherFit(box, cell, true, { air: true, hours: 6 });
  check('шесть столбцов', fit.hours, 6);
  check('сумма ярусов влезает в коробку', weatherUsed(fit, cell) <= box.height, true);
}

console.log('\n— погода: узкая плитка не рисует ряд, который не помещается по ширине —');
{
  const cell = 95;
  const box = { width: cell, height: cell * 3 + 28 };
  const fit = weatherFit(box, cell, false, { air: true, hours: 6 });
  check('в ширину 95 px влезло бы два столбца', fit.hours, 2);
  check('сумма ярусов влезает в коробку', weatherUsed(fit, cell) <= box.height, true);
}

console.log('\n— погода: данных нет — блоки не рисуются на пустом месте —');
{
  const cell = 132;
  const fit = weatherFit(tile2x2(cell), cell, false, { air: false, hours: 0 });
  check('нет воздуха — нет строки', fit.showAir, false);
  check('нет прогноза — нет ряда', fit.hours, 0);
}

console.log('\n— музыка: две кнопки переносились на две строки и лезли под подпись —');
{
  // Плитка 2×1 на клетке 95: ровно та, что на снимке.
  const cell = 95;
  const box = { width: cell * 2 + 14, height: cell };
  const fit = musicFit(box, cell);
  check('на такой высоте кнопка одна', fit.services, 1);
  check('поясняющей строки нет', fit.hint, false);
  const rowH = fromCell(28, cell, 24);
  check('одна кнопка в высоту влезает',
    padOf(densityOf(cell)) * 2 + 13 + 18 + 8 + rowH <= box.height, true);
}

console.log('\n— музыка: просторная плитка показывает всё —');
{
  const cell = 132;
  const box = { width: cell * 2 + 14, height: cell * 2 + 14 };
  const fit = musicFit(box, cell);
  check('обе кнопки', fit.services, 2);
  check('поясняющая строка на месте', fit.hint, true);
  check('кнопки транспорта в полную величину', [fit.primary, fit.secondary], [38, 30]);
}

console.log('\n— музыка: кнопки транспорта ужимаются, но не исчезают —');
{
  const fit = musicFit({ width: 204, height: 95 }, 95);
  check('главная не мельче 30', fit.primary >= 30, true);
  check('боковые не мельче 24', fit.secondary >= 24, true);
}

console.log('\n— fitsBlock: голая арифметика остатка —');
{
  check('ровно впритык — влезает', fitsBlock(200, 130, 70), true);
  check('не хватает одного пикселя', fitsBlock(200, 131, 70), false);
  check('занято больше коробки', fitsBlock(100, 120, 10), false);
}

console.log(`\nИтого: ${passed} ок, ${failed} провалено\n`);
process.exit(failed === 0 ? 0 : 1);
