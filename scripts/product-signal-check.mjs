// Прогон разбора товара из schema.org (shared/productSignal.ts) — без electron, обычным node.
//
// Это слой, решающий, что мы покажем как цену и запишем в историю: ошибка здесь — неверная точка
// на графике и ложное «подешевело». Формы разметки в живой рознице разные, и проверить их можно
// только набором случаев.
//
// Запуск: npm run product-signal-check
import { productFromJsonLd, parsePrice, parseAvailability, jsonLdBlocksFromHtml } from '../shared/productSignal.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  const ok = a === b;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${a}\n         ждали    ${b}`);
}

const ld = (obj) => [JSON.stringify(obj)];
const brief = (p) => (p ? `${p.name} | ${p.price} ${p.currency} | ${p.availability}` : null);

console.log('\n— обычная карточка товара —');
check('простой Product с Offer',
  brief(productFromJsonLd(ld({
    '@type': 'Product', name: 'Выключатель Aqara H2',
    offers: { '@type': 'Offer', price: '4592', priceCurrency: 'RUB', availability: 'https://schema.org/InStock' },
  }))),
  'Выключатель Aqara H2 | 4592 RUB | InStock');

check('Product внутри @graph (частая обёртка)',
  brief(productFromJsonLd(ld({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', name: 'Каталог' },
      { '@type': 'Product', name: 'Умный выключатель', offers: { price: 5121, priceCurrency: 'RUB', availability: 'InStock' } },
    ],
  }))),
  'Умный выключатель | 5121 RUB | InStock');

check('массив офферов — берём первый с ценой',
  brief(productFromJsonLd(ld({
    '@type': 'Product', name: 'Товар',
    offers: [{ '@type': 'Offer', priceCurrency: 'RUB' }, { '@type': 'Offer', price: '999', priceCurrency: 'RUB' }],
  }))),
  'Товар | 999 RUB | ');

check('AggregateOffer — берём нижнюю границу диапазона',
  brief(productFromJsonLd(ld({
    '@type': 'Product', name: 'Товар',
    offers: { '@type': 'AggregateOffer', lowPrice: '1200', highPrice: '1800', priceCurrency: 'RUB' },
  }))),
  'Товар | 1200 RUB | ');

check('@type массивом',
  brief(productFromJsonLd(ld({
    '@type': ['Product', 'Thing'], name: 'Товар', offers: { price: 10, priceCurrency: 'RUB' },
  }))),
  'Товар | 10 RUB | ');

console.log('\n— опознавательные знаки для будущей склейки —');
{
  const p = productFromJsonLd(ld({
    '@type': 'Product', name: 'Товар', sku: 'WS-K07D', gtin13: '6970504215955',
    brand: { '@type': 'Brand', name: 'Aqara' },
    offers: { price: 100, priceCurrency: 'RUB' },
  }));
  check('sku / gtin / бренд объектом', [p.sku, p.gtin, p.brand], ['WS-K07D', '6970504215955', 'Aqara']);
}

console.log('\n— форматы цены из живой разметки —');
check('целое числом', parsePrice(5121), 5121);
check('строка с копейками', parsePrice('5121.00'), 5121);
check('разряды пробелом и запятая десятичная', parsePrice('5 121,50'), 5121.5);
check('неразрывный пробел в разрядах', parsePrice('5 121'), 5121);
check('запятая как разделитель разрядов', parsePrice('1,234'), 1234);
check('ноль ценой не считается', parsePrice('0'), 0);
check('мусор вместо цены', parsePrice('по запросу'), 0);

console.log('\n— наличие —');
check('полный URL схемы', parseAvailability('https://schema.org/InStock'), 'InStock');
check('короткая форма', parseAvailability('OutOfStock'), 'OutOfStock');
check('ограниченное наличие — отдельный сигнал', parseAvailability('http://schema.org/LimitedAvailability'), 'LimitedAvailability');
check('мусор', parseAvailability('да'), '');

console.log('\n— когда товара НЕТ (самый частый ответ) —');
check('обычная страница без разметки', productFromJsonLd([]), null);
check('разметка есть, но это статья',
  productFromJsonLd(ld({ '@type': 'Article', name: 'Как выбрать выключатель' })), null);
check('Product без цены — отслеживать нечего',
  productFromJsonLd(ld({ '@type': 'Product', name: 'Товар', offers: { priceCurrency: 'RUB' } })), null);
check('Product без названия',
  productFromJsonLd(ld({ '@type': 'Product', offers: { price: 100, priceCurrency: 'RUB' } })), null);
check('битый JSON не роняет разбор', productFromJsonLd(['{ это не json ']), null);
check('пустая строка', productFromJsonLd(['']), null);

console.log('\n— блоки из сырого HTML (самый дешёвый путь фоновой проверки) —');
{
  const html = '<html><head>'
    + '<script type="application/ld+json">{"@type":"Product","name":"Товар","offers":{"price":"777","priceCurrency":"RUB"}}</script>'
    + '<script>var x = 1;</script>'
    + '</head><body>текст</body></html>';
  check('вытаскивается только ld+json, обычный script не трогается', jsonLdBlocksFromHtml(html).length, 1);
  check('и он разбирается в товар', brief(productFromJsonLd(jsonLdBlocksFromHtml(html))), 'Товар | 777 RUB | ');
}
check('атрибуты в другом порядке и одинарные кавычки',
  jsonLdBlocksFromHtml(`<script id="a" type='application/ld+json'>{"a":1}</script>`).length, 1);
check('страница без разметки', jsonLdBlocksFromHtml('<html><body>ничего</body></html>'), []);
check('пустой ответ сервера', jsonLdBlocksFromHtml(''), []);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
