// Прогон определения событий отслеживания (shared/priceEvents.ts) — без electron, обычным node.
//
// Это слой, решающий, когда человека ДЁРНУТЬ уведомлением. Тост, пришедший зря, обучает закрывать
// тосты не читая — и в нужный раз его тоже закроют. Поэтому проверяем и то, что событие есть, и —
// не менее важно — что его НЕТ на мелочи.
//
// Запуск: npm run price-events-check
import { detectEvent, describeEvent } from '../shared/priceEvents.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  const ok = a === b;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${a}\n         ждали    ${b}`);
}

const obs = (price, availability = 'InStock') => ({ price, availability });
const kind = (prev, next) => detectEvent(prev, next)?.kind ?? null;

console.log('\n— изменения цены —');
check('заметное падение', kind(obs(48990), obs(45990)), 'drop');
check('заметный рост', kind(obs(45990), obs(48990)), 'rise');
check('первое наблюдение событием не является', kind(null, obs(1000)), null);
check('цена не менялась', kind(obs(1000), obs(1000)), null);

console.log('\n— мелочь, из-за которой дёргать нельзя —');
check('падение меньше 3% (дорогой товар)', kind(obs(48990), obs(48000)), null);
check('падение 3%, но всего 7 ₽ (дешёвый товар)', kind(obs(239), obs(232)), null);
check('падение в 1 ₽', kind(obs(5000), obs(4999)), null);
// Порог двойной: и в процентах, и в деньгах. Здесь проходит только процент.
check('60 ₽ на ноутбуке — не новость', kind(obs(48990), obs(48930)), null);
// А здесь проходят оба.
check('1500 ₽ на ноутбуке — новость', kind(obs(48990), obs(47490)), 'drop');

console.log('\n— крупное движение в процентах говорит само за себя —');
// ⚠️ Живой случай: биты за 239 ₽ подешевели до 202 (−15%), и рублёвый порог это проглотил, хотя
// ради такого дешёвый товар и ставят на слежение.
check('−15% на товаре за 239 ₽ — новость, хоть это и 37 ₽', kind(obs(239), obs(202)), 'drop');
check('+20% на дешёвом товаре — тоже новость', kind(obs(200), obs(240)), 'rise');
// Но у процента есть своя дыра: на совсем копеечном товаре крупный процент — это копейки.
check('−15% на товаре за 30 ₽ — это 4 рубля, молчим', kind(obs(30), obs(26)), null);

console.log('\n— наличие важнее цены —');
check('товар кончился', kind(obs(1000, 'InStock'), obs(1000, 'OutOfStock')), 'gone');
check('товар вернулся', kind(obs(1000, 'OutOfStock'), obs(1000, 'InStock')), 'back');
check('осталось мало', kind(obs(1000, 'InStock'), obs(1000, 'LimitedAvailability')), 'ending');
check('«кончилось» сообщаем, даже если цена не менялась',
  kind(obs(1000, 'InStock'), obs(1000, 'OutOfStock')), 'gone');
check('магазин перестал сообщать наличие — не событие',
  kind(obs(1000, 'InStock'), obs(1000, '')), null);
check('«осталось мало» второй раз подряд — не событие',
  kind(obs(1000, 'LimitedAvailability'), obs(1000, 'LimitedAvailability')), null);

console.log('\n— как это прочитает человек —');
// ⚠️ Разряды в русской локали разделяет НЕРАЗРЫВНЫЙ пробел (U+00A0), а не обычный. Это верно и
// менять в коде нечего — но в ожиданиях его глазами не отличить, и прогон падал на строках,
// выглядящих совершенно одинаково. Нормализуем при сравнении.
const say = (e) => describeEvent(e, 'RUB').replace(/ /g, ' ');
check('падение словами',
  say(detectEvent(obs(48990), obs(47490))),
  'Подешевело на 1 500 ₽ (-3%), сейчас 47 490 ₽');
check('рост словами',
  say(detectEvent(obs(47490), obs(48990))),
  'Подорожало на 1 500 ₽ (+3%), сейчас 48 990 ₽');
check('кончилось словами',
  say(detectEvent(obs(1000, 'InStock'), obs(1000, 'OutOfStock'))),
  'Больше нет в наличии');
check('вернулось словами',
  say(detectEvent(obs(1000, 'OutOfStock'), obs(900, 'InStock'))),
  'Снова в наличии — 900 ₽');

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
