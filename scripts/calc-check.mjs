// Прогон чистой логики калькулятора (shared/calc.ts) — без electron, обычным node.
//
// Два узла, каждый из которых уже стоил жалобы. ПРАВИЛО ПРОЦЕНТА: «50 + 10 %» это 55, а не 50,1,
// но «50 × 10 %» это 5 — правило разное для разных действий, и оба края надо держать сразу.
// РАЗБОР ВСТАВЛЕННОГО (Ctrl+V): в буфер вместе с числом попадает всё, чем сайт его окружил —
// валюта, процент, разряды неразрывным пробелом, английская и русская запись дробной части.
//
// Запуск: npm run calc-check
import { computeCalc, fmtCalc, calcDisp, resolvePercent, parsePastedNumber } from '../shared/calc.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = Object.is(actual, expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

console.log('\n— арифметика —');
check('сложение', computeCalc(2, 3, '+'), 5);
check('вычитание', computeCalc(2, 3, '−'), -1);
check('умножение', computeCalc(2, 3, '×'), 6);
check('деление', computeCalc(6, 3, '÷'), 2);
check('деление на ноль — не число', isFinite(computeCalc(1, 0, '÷')), false);

console.log('\n— формат числа —');
// Хвосты двоичной арифметики: без toPrecision(12) на дисплее было бы 0.30000000000000004.
check('0,1 + 0,2 без хвоста', fmtCalc(computeCalc(0.1, 0.2, '+')), '0.3');
check('целое без завершающих нулей', fmtCalc(5.0), '5');
check('бесконечность — «Ошибка»', fmtCalc(computeCalc(1, 0, '÷')), 'Ошибка');
check('NaN — «Ошибка»', fmtCalc(NaN), 'Ошибка');
check('в строке выражения запятая', calcDisp(1.5), '1,5');

console.log('\n— процент: правило разное для разных действий —');
// ⚠️ Это и есть тот случай, из-за которого была жалоба «проценты не работают»: при сложении и
// вычитании процент берётся ОТ ПЕРВОГО ОПЕРАНДА, при умножении и делении остаётся долей.
check('50 + 10 % → прибавляем 5', resolvePercent(10, 50, '+'), 5);
check('50 − 10 % → вычитаем 5', resolvePercent(10, 50, '−'), 5);
check('50 × 10 % → множим на 0,1', resolvePercent(10, 50, '×'), 0.1);
check('50 ÷ 10 % → делим на 0,1', resolvePercent(10, 50, '÷'), 0.1);
check('без начатого действия — просто доля', resolvePercent(10, null, null), 0.1);
check('действие есть, первого операнда нет — доля', resolvePercent(10, null, '+'), 0.1);

console.log('\n— процент: результат целиком —');
check('50 + 10 % = 55', computeCalc(50, resolvePercent(10, 50, '+'), '+'), 55);
check('50 − 10 % = 45', computeCalc(50, resolvePercent(10, 50, '−'), '−'), 45);
check('50 × 10 % = 5', computeCalc(50, resolvePercent(10, 50, '×'), '×'), 5);
check('200 + 15 % = 230', computeCalc(200, resolvePercent(15, 200, '+'), '+'), 230);
check('процент от нуля — ноль', resolvePercent(10, 0, '+'), 0);

console.log('\n— простое число —');
check('целое', parsePastedNumber('1234'), 1234);
check('с точкой', parsePastedNumber('12.5'), 12.5);
check('с запятой (русская запись)', parsePastedNumber('12,5'), 12.5);
check('лишние пробелы по краям', parsePastedNumber('  42  '), 42);
check('ноль', parsePastedNumber('0'), 0);

console.log('\n— разряды: ровно то, как цены выглядят на страницах —');
check('обычный пробел', parsePastedNumber('1 234'), 1234);
check('неразрывный пробел U+00A0', parsePastedNumber('1 234,56'), 1234.56);
check('узкий неразрывный U+202F', parsePastedNumber('1 234,56'), 1234.56);
check('запятая как разряды, точка как дробь', parsePastedNumber('1,234.56'), 1234.56);
check('точка как разряды, запятая как дробь', parsePastedNumber('1.234,56'), 1234.56);
check('несколько запятых — все разрядные', parsePastedNumber('1,234,567'), 1234567);
check('несколько точек — все разрядные', parsePastedNumber('1.234.567'), 1234567);

console.log('\n— мусор вокруг числа —');
check('рубль после суммы', parsePastedNumber('1 234,56 ₽'), 1234.56);
check('доллар перед суммой', parsePastedNumber('$1,234.56'), 1234.56);
check('процент', parsePastedNumber('45%'), 45);
check('единицы измерения', parsePastedNumber('12,5 кг'), 12.5);

console.log('\n— знак —');
check('минус-дефис', parsePastedNumber('-42'), -42);
check('типографский минус U+2212', parsePastedNumber('−42'), -42);
check('минус с пробелом и валютой', parsePastedNumber('- 1 200 ₽'), -1200);
check('минус в середине знаком не считается', parsePastedNumber('10-20'), 1020);

console.log('\n— когда числа нет —');
check('пустая строка', parsePastedNumber(''), null);
check('только пробелы', parsePastedNumber('   '), null);
check('слово', parsePastedNumber('привет'), null);
check('валюта без цифр', parsePastedNumber('₽'), null);
check('одни разделители', parsePastedNumber(',.,'), null);

console.log('\n— граничные случаи разбора —');
check('дробь без целой части', parsePastedNumber('.5'), 0.5);
check('целая часть без дроби', parsePastedNumber('5.'), 5);
// ⚠️ Осознанный выбор, а не недосмотр: «1,234» в английской записи это тысяча двести тридцать
// четыре, а в русской — одна целая двести тридцать четыре тысячных. Обе трактовки верны, различить
// их нечем, и интерфейс у нас русский (см. комментарий в shared/calc.ts).
check('одиночная запятая — всегда дробная часть', parsePastedNumber('1,234'), 1.234);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
