// Прогон разбора ответа Travelpayouts (shared/travelpayouts.ts) — без electron, обычным node.
//
// Запуск: npm test -- travelpayouts
import {
  parsePricesForDates, cheapestOffer, findOffer, offersForMenu, sameFlight,
} from '../shared/travelpayouts.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  const ok = a === b;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${a}\n         ждали    ${b}`);
}

const brief = (o) => (o ? `${o.airline}${o.flightNumber} ${o.price} ${o.currency}` : null);

const sample = {
  success: true,
  currency: 'rub',
  data: [
    {
      origin: 'MOW', destination: 'LED', origin_airport: 'SVO', destination_airport: 'LED',
      price: 4500, airline: 'SU', flight_number: 1234,
      departure_at: '2026-10-01T08:30:00+03:00', transfers: 0, link: '/search/x',
    },
    {
      origin: 'MOW', destination: 'LED', price: 3900, airline: 'U6', flight_number: '42',
      departure_at: '2026-10-01T06:00:00+03:00', transfers: 1, link: '/search/y',
    },
    {
      origin: 'MOW', destination: 'LED', price: 4500, airline: 'SU', flight_number: '1234',
      departure_at: '2026-10-01T18:00:00+03:00', transfers: 0, link: '/search/z',
    },
  ],
};

console.log('\n— обычный ответ —');
{
  const offers = parsePricesForDates(sample);
  check('два уникальных рейса, дубль SU схлопнут в меню', offersForMenu(offers).map(brief), [
    'U642 3900 RUB', 'SU1234 4500 RUB',
  ]);
  check('самый дешёвый', brief(cheapestOffer(offers)), 'U642 3900 RUB');
  check('конкретный рейс по номеру-числу', brief(findOffer(offers, 'su', '1234')), 'SU1234 4500 RUB');
  check('нет такого рейса', findOffer(offers, 'SU', '999'), null);
}

console.log('\n— когда цен НЕТ —');
check('success: false', parsePricesForDates({ success: false, data: [] }), null);
check('не JSON-объект', parsePricesForDates('nope'), null);
check('пустой data — кэш молчит, это не ошибка разбора', parsePricesForDates({ success: true, data: [] }), []);
check('data объектом, как у части методов',
  brief(cheapestOffer(parsePricesForDates({
    success: true,
    data: { a: { price: 10, airline: 'SU', flight_number: '1' } },
  }))),
  'SU1 10 RUB');
check('строка без цены', parsePricesForDates({ success: true, data: [{ airline: 'SU', flight_number: '1' }] }), []);

console.log('\n— номер рейса —');
check('ведущие нули не различают рейс', sameFlight({ airline: 'SU', flightNumber: '012' }, 'SU', '12'), true);
check('другая авиакомпания', sameFlight({ airline: 'SU', flightNumber: '1' }, 'U6', '1'), false);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
