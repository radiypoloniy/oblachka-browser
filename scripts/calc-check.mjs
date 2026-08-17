// Прогон разбора вставленного в калькулятор числа (shared/calc.ts) — без electron, обычным node.
//
// Ctrl+V по калькулятору — это в первую очередь «скопировал цену и посчитал»: в буфер вместе с
// числом попадает всё, чем сайт его окружил. Случаи ниже собраны из того, как реально выглядят
// суммы на страницах — валюта, процент, разряды неразрывным пробелом, английская и русская
// запись дробной части.
//
// Запуск: npm run calc-check
import { parsePastedNumber } from '../shared/calc.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = Object.is(actual, expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

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
