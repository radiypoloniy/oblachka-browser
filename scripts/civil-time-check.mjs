// Гражданские часы в поясе (shared/civilTime.ts).
//
// Зачем: конвертер «если у меня 18:45, сколько у него» обязан попадать в минуту, включая
// Индию с получасом. Край шкалы не имеет права переносить дату: курсор у 24:00 накручивал дни.
//   npm test -- civil-time
import {
  parseClock, formatHm, formatClock, formatOffset, offsetMinutes, wallParts,
  instantFromCivil, instantWithClock, snapClockMinutes, hmFromMinutes,
  minutesOfDay, maskClockInput, DAY_MINUTES, DAY_MAX_MINUTES, CLOCK_STEP_MIN,
} from '../shared/civilTime.ts';

let passed = 0;
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  ✗ ${name}\n      получили ${JSON.stringify(got)}\n      ждали    ${JSON.stringify(want)}`); }
  else { passed++; console.log(`  ✓ ${name}`); }
};
const checkTrue = (name, got) => check(name, !!got, true);

console.log('\n── разбор набора ──');
check('18:45', parseClock('18:45'), { h: 18, m: 45 });
check('1845 без двоеточия', parseClock('1845'), { h: 18, m: 45 });
check('18.45 точкой', parseClock('18.45'), { h: 18, m: 45 });
check('голое 18 — ноль минут', parseClock('18'), { h: 18, m: 0 });
check('9:05', parseClock('9:05'), { h: 9, m: 5 });
check('24:00 — последний слот, не следующие сутки', parseClock('24:00'), { h: 23, m: 45 });
check('2400', parseClock('2400'), { h: 23, m: 45 });
check('11:45pm', parseClock('11:45pm'), { h: 23, m: 45 });
check('11:45 pm с пробелом', parseClock('11:45 pm'), { h: 23, m: 45 });
check('12am полночь', parseClock('12:00am'), { h: 0, m: 0 });
check('12pm полдень', parseClock('12pm'), { h: 12, m: 0 });
check('4:45pm', parseClock('4:45pm'), { h: 16, m: 45 });
check('13pm нет', parseClock('13pm'), null);
check('пробелы', parseClock('  18:45 '), { h: 18, m: 45 });
check('25:00 нет', parseClock('25:00'), null);
check('18:99 нет', parseClock('18:99'), null);
check('мусор', parseClock('вечером'), null);

console.log('\n── автодвоеточие в поле ──');
check('одна цифра', maskClockInput('1'), '1');
check('два часа — двоеточие сами', maskClockInput('18'), '18:');
check('третья цифра уже минуты', maskClockInput('184', '18:'), '18:4');
check('четыре цифры', maskClockInput('1845', '18:4'), '18:45');
check('вставка 1845', maskClockInput('1845'), '18:45');
check('стёрли двоеточие — не возвращаем', maskClockInput('18', '18:'), '18');
check('11:45pm', maskClockInput('1145pm'), '11:45 pm');
check('с двоеточием и pm', maskClockInput('11:45pm'), '11:45 pm');

console.log('\n── формат и шаг ──');
check('formatHm', formatHm(9, 5), '09:05');
check('12-часовой вечер', formatClock(23, 45, true), '11:45 pm');
check('12-часовой полночь', formatClock(0, 0, true), '12:00 am');
check('12-часовой полдень', formatClock(12, 0, true), '12:00 pm');
check('24-часовой не трогает', formatClock(9, 5, false), '09:05');
check('шаг 15', CLOCK_STEP_MIN, 15);
check('сутки', DAY_MINUTES, 1440);
check('край шкалы 23:45', DAY_MAX_MINUTES, 1425);
check('22 мин → 15', snapClockMinutes(22), 15);
check('23 мин → 30', snapClockMinutes(23), 30);
check('за край — 23:45, не 24:00', snapClockMinutes(1500), 1425);
check('минуты 18:45', minutesOfDay(18, 45), 18 * 60 + 45);
check('1440 → 23:45', hmFromMinutes(1440), { h: 23, m: 45 });
check('555 → 9:15', hmFromMinutes(555), { h: 9, m: 15 });

console.log('\n── смещение ──');
check('ноль', formatOffset(0), 'как у вас');
check('целый час', formatOffset(180), '+3 ч');
check('Индия', formatOffset(150), '+2:30 ч');
check('назад с минутами', formatOffset(-30), '−0:30 ч');

console.log('\n── круг «стена → момент → стена» ──');
{
  const t = instantFromCivil('Europe/Moscow', 2026, 9, 13, 18, 45);
  const msk = wallParts('Europe/Moscow', new Date(t));
  check('Москва осталась 18:45', { h: msk.h, m: msk.m, d: msk.d, mo: msk.mo }, { h: 18, m: 45, d: 13, mo: 9 });
  const ny = wallParts('America/New_York', new Date(t));
  // 13.09.2026 — летнее на востоке США (UTC−4), Москва UTC+3, разница 7 часов.
  check('Нью-Йорк в тот же момент 11:45', { h: ny.h, m: ny.m, d: ny.d }, { h: 11, m: 45, d: 13 });
  check('смещение −7 ч', offsetMinutes('America/New_York', 'Europe/Moscow', new Date(t)), -420);
}

console.log('\n── вечер 13.09 как у savvytime ──');
{
  // Живой кадр: 23:45 в Москве = 16:45 EDT, не 16:00 EST 3 декабря.
  const t = instantFromCivil('Europe/Moscow', 2026, 9, 13, 23, 45);
  const ny = wallParts('America/New_York', new Date(t));
  check('Нью-Йорк 16:45 того же дня', { h: ny.h, m: ny.m, d: ny.d, mo: ny.mo }, { h: 16, m: 45, d: 13, mo: 9 });
}

console.log('\n── полночь не значит минус 17 часов ──');
{
  // Живой кадр: 00:00 пн в Москве и 17:00 вс в Нью-Йорке читались как 17 часов.
  // Это один момент: EDT −7 ч, календарь уже перескочил у Москвы.
  const t = instantFromCivil('Europe/Moscow', 2026, 9, 14, 0, 0);
  const ny = wallParts('America/New_York', new Date(t));
  check('Нью-Йорк всё ещё 13-е 17:00', { h: ny.h, m: ny.m, d: ny.d, mo: ny.mo }, { h: 17, m: 0, d: 13, mo: 9 });
  check('смещение −7, не −17', offsetMinutes('America/New_York', 'Europe/Moscow', new Date(t)), -420);
}

console.log('\n── поставить часы, не меняя день пояса ──');
{
  const t0 = instantFromCivil('Europe/Moscow', 2026, 9, 13, 14, 0);
  const t1 = instantWithClock('America/New_York', t0, 11, 45);
  const ny = wallParts('America/New_York', new Date(t1));
  const msk = wallParts('Europe/Moscow', new Date(t1));
  check('NY стал 11:45', { h: ny.h, m: ny.m }, { h: 11, m: 45 });
  check('Москва поехала на 18:45', { h: msk.h, m: msk.m }, { h: 18, m: 45 });
}

console.log('\n── край шкалы не переносит сутки ──');
{
  const t0 = instantFromCivil('Europe/Moscow', 2026, 9, 13, 23, 0);
  const t1 = instantWithClock('Europe/Moscow', t0, 24, 0);
  const msk = wallParts('Europe/Moscow', new Date(t1));
  check('день тот же', msk.d, 13);
  check('23:45, не полночь 14-го', { h: msk.h, m: msk.m }, { h: 23, m: 45 });
  let t = t1;
  for (let i = 0; i < 40; i++) t = instantWithClock('Europe/Moscow', t, 24, 0);
  const stuck = wallParts('Europe/Moscow', new Date(t));
  check('сорок раз на краю — всё ещё 13-е', stuck.d, 13);
}

console.log('\n── Индия +5:30 ──');
{
  const india = ['Asia/Kolkata', 'Asia/Calcutta'].find((id) => {
    try { new Intl.DateTimeFormat('en', { timeZone: id }); return true; } catch { return false; }
  });
  checkTrue('ICU знает Дели', !!india);
  if (india) {
    const t = instantFromCivil('Europe/Moscow', 2026, 9, 13, 12, 0);
    check('Дели на 2:30 впереди Москвы', offsetMinutes(india, 'Europe/Moscow', new Date(t)), 150);
  }
}

console.log('\n── дыра летнего времени не роняет ──');
{
  // США, 8 марта 2026, 02:00 → 03:00. 02:30 на стене нет.
  const t = instantFromCivil('America/New_York', 2026, 3, 8, 2, 30);
  checkTrue('момент конечный', Number.isFinite(t));
  const p = wallParts('America/New_York', new Date(t));
  checkTrue('час не застрял в дыре', p.h !== 2);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
