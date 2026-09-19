// Прогон разбора адреса поиска Aviasales (shared/aviasalesUrl.ts) — без electron, обычным node.
//
// Это слой, решающий, на какие даты встанут часы: ошибка здесь — уведомление о чужом рейсе.
// Запуск: npm test -- aviasales
import {
  parseAviasalesUrl, buildAviasalesSignature, formatAviasalesTitle, resolveYmd,
} from '../shared/aviasalesUrl.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  const ok = a === b;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${a}\n         ждали    ${b}`);
}

const NOW = new Date('2026-09-19T12:00:00+03:00');
const brief = (s) => (s
  ? `${s.origin}>${s.destination} ${s.depart}/${s.returnDate || '-'} a${s.adults}c${s.children}i${s.infants} ${s.cabin}`
  : null);

console.log('\n— год в сигнатуре не кодируется —');
check('октябрь ещё впереди в сентябре', resolveYmd(1, 10, '2026-09-19'), '2026-10-01');
check('январь уже прошёл — следующий год', resolveYmd(5, 1, '2026-09-19'), '2027-01-05');
check('возврат в следующем календарном году', resolveYmd(25, 1, '2026-12-24'), '2027-01-25');

console.log('\n— круговой поиск из живого адреса —');
check('MOW 1 окт → LED 15 окт, 1 взрослый',
  brief(parseAviasalesUrl('https://www.aviasales.ru/search/MOW0110LED15101', NOW)),
  'MOW>LED 2026-10-01/2026-10-15 a1c0i0 Y');

console.log('\n— в одну сторону —');
check('без даты возврата',
  brief(parseAviasalesUrl('https://www.aviasales.ru/search/MOW0110LED1', NOW)),
  'MOW>LED 2026-10-01/- a1c0i0 Y');

console.log('\n— регистр, зеркало .com, www —');
check('нижний регистр на .com',
  brief(parseAviasalesUrl('https://aviasales.com/search/mow0110led1', NOW)),
  'MOW>LED 2026-10-01/- a1c0i0 Y');

console.log('\n— класс и пассажиры —');
check('бизнес',
  brief(parseAviasalesUrl('https://www.aviasales.ru/search/MOW0110LED15101C', NOW)),
  'MOW>LED 2026-10-01/2026-10-15 a1c0i0 C');
check('двое взрослых, перенос года на возврате',
  brief(parseAviasalesUrl('https://www.aviasales.ru/search/LED2412MOW25012', NOW)),
  'LED>MOW 2026-12-24/2027-01-25 a2c0i0 Y');
check('взрослый и ребёнок, в одну сторону',
  brief(parseAviasalesUrl('https://www.aviasales.ru/search/MOW0110LED12', NOW)),
  'MOW>LED 2026-10-01/- a1c2i0 Y');

console.log('\n— когда поиска НЕТ (самый частый ответ) —');
check('чужой сайт с похожим путём', parseAviasalesUrl('https://example.com/search/MOW0110LED1', NOW), null);
check('главная Aviasales', parseAviasalesUrl('https://www.aviasales.ru/', NOW), null);
check('календарь', parseAviasalesUrl('https://www.aviasales.ru/calendar', NOW), null);
check('битый месяц', parseAviasalesUrl('https://www.aviasales.ru/search/MOW0113LED1', NOW), null);
check('пустая строка', parseAviasalesUrl('', NOW), null);

console.log('\n— query params —');
check('params= как у части редиректов',
  brief(parseAviasalesUrl('https://www.aviasales.ru/search?params=MOW0110LED1', NOW)),
  'MOW>LED 2026-10-01/- a1c0i0 Y');
check('origin_iata + depart_date',
  brief(parseAviasalesUrl('https://www.aviasales.ru/search?origin_iata=MOW&destination_iata=LED&depart_date=2026-10-01&adults=1', NOW)),
  'MOW>LED 2026-10-01/- a1c0i0 Y');

console.log('\n— круг сигнатуры и подпись —');
{
  const s = parseAviasalesUrl('https://www.aviasales.ru/search/MOW0110LED15101', NOW);
  check('собрали ту же сигнатуру', buildAviasalesSignature(s), 'MOW0110LED15101');
  check('openUrl канонический', s.openUrl, 'https://www.aviasales.ru/search/MOW0110LED15101');
  check('подпись маршрута', formatAviasalesTitle(s), 'MOW → LED · 1.10–15.10.2026');
  check('подпись рейса', formatAviasalesTitle(s, 'SU', '1234'), 'MOW → LED, SU 1234 · 1.10–15.10.2026');
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
