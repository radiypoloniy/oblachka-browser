// Прогон склейки товаров (shared/productMatch.ts) — без electron, обычным node.
//
// Ошибка здесь — разные товары, слипшиеся в одну карточку с общим графиком цен, то есть враньё в
// самой сути фичи. Поэтому отрицательных проверок тут больше, чем положительных.
//
// Запуск: npm run product-match-check
import { sameProductByCodes, worthAsking } from '../shared/productMatch.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const item = (o = {}) => ({ gtin: '', mpn: '', brand: '', title: '', ...o });

console.log('\n— склеиваем сами: коды совпали —');
check('одинаковый штрихкод',
  sameProductByCodes(item({ gtin: '6970504215955' }), item({ gtin: '6970504215955' })), true);
check('артикул производителя вместе с брендом',
  sameProductByCodes(item({ mpn: 'WS-K07D', brand: 'Aqara' }), item({ mpn: 'ws-k07d', brand: 'aqara' })), true);

console.log('\n— НЕ склеиваем: тут легко слепить разное —');
check('пустые коды у обоих',
  sameProductByCodes(item({ title: 'Выключатель' }), item({ title: 'Выключатель' })), false);
check('разные штрихкоды', sameProductByCodes(item({ gtin: '111111111' }), item({ gtin: '222222222' })), false);
// ⚠️ Главная ловушка: короткий «штрихкод» — это чей-то внутренний номер, а не GTIN.
check('короткий «штрихкод» совпал — не повод', sameProductByCodes(item({ gtin: '12' }), item({ gtin: '12' })), false);
check('артикул совпал, а бренд другой',
  sameProductByCodes(item({ mpn: '100', brand: 'Aqara' }), item({ mpn: '100', brand: 'Xiaomi' })), false);
check('артикул есть, бренда нет ни у кого',
  sameProductByCodes(item({ mpn: 'WS-K07D' }), item({ mpn: 'WS-K07D' })), false);
check('слишком короткий артикул', sameProductByCodes(item({ mpn: '10', brand: 'A' }), item({ mpn: '10', brand: 'A' })), false);
// sku в склейке не участвует вовсе — он у каждого магазина свой.
check('совпавший sku ничего не значит',
  sameProductByCodes(item({ sku: 'ABC123' }), item({ sku: 'ABC123' })), false);

console.log('\n— стоит ли спрашивать модель —');
check('одно и то же разными словами — спросить стоит',
  worthAsking('Ноутбук CHUWI Corebook Air 14" IPS AMD Ryzen 5 6600H 16ГБ 512ГБ',
              'CHUWI Corebook Air ноутбук 14 дюймов Ryzen 5'), true);
check('короткое название внутри длинного',
  worthAsking('Умный выключатель Aqara H2 WS-K07D белый двухклавишный', 'Выключатель Aqara H2 WS-K07D'), true);
check('совсем разные товары — не спрашиваем',
  worthAsking('Ноутбук CHUWI Corebook Air', 'Биты для шуруповёрта магнитные торсионные'), false);
check('пересеклись одним общим словом — не спрашиваем',
  worthAsking('Выключатель Aqara умный', 'Выключатель автоматический ABB трёхполюсный сорок ампер'), false);
check('слишком короткое название — сравнивать нечего', worthAsking('Ноутбук', 'Ноутбук'), false);
check('пустые названия', worthAsking('', ''), false);
check('служебные слова не считаются совпадением',
  worthAsking('Кабель для ноутбука 100 см', 'Мышь для компьютера 100 шт'), false);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
