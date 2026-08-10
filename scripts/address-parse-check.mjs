// Прогон разбора адреса (shared/addressParts.ts) — без electron, обычным node.
//
// Проверяется НЕ модель, а наш разбор её ответа: что мы вытащим из помеченных строк, что
// отбракуем проверками и когда откажемся предлагать. Это слой, решающий, что ляжет в форму
// доставки, — ошибка здесь уводит посылку по чужому индексу, и заметить её человеку почти нечем.
//
// Запуск: npm run address-parse-check
import { partsFromModelOutput, cleanPostal, cleanPhone, cleanEmail } from '../shared/addressParts.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  const ok = a === b;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${a}\n         ждали    ${b}`);
}

// Удобное представление разбора: «ключ=значение» через запятую.
const flat = (out) => partsFromModelOutput(out).map((p) => `${p.key}=${p.value}`);

console.log('\n— обычный ответ модели —');
check('полная строка разбирается по частям',
  flat([
    'NAME: Иванов Иван Петрович',
    'POSTAL: 123456',
    'CITY: Москва',
    'STREET: ул. Ленина 1 кв. 5',
    'PHONE: +7 900 123-45-67',
    'EMAIL: -',
  ].join('\n')),
  ['fullName=Иванов Иван Петрович', 'postalCode=123456', 'city=Москва',
   'street=ул. Ленина 1 кв. 5', 'phone=+7 900 123-45-67']);

check('прочерк — это «части не было», а не значение',
  flat('NAME: Пётр Смирнов\nPOSTAL: -\nCITY: Казань\nSTREET: -\nPHONE: -\nEMAIL: -'),
  ['fullName=Пётр Смирнов', 'city=Казань']);

check('кавычки вокруг значения снимаются',
  flat('NAME: "Анна Кузнецова"\nCITY: «Тверь»\nPOSTAL: -\nSTREET: -\nPHONE: -\nEMAIL: -'),
  ['fullName=Анна Кузнецова', 'city=Тверь']);

console.log('\n— вольности модели, которые нельзя пускать в форму —');
check('вступление перед метками не мешает разбору',
  flat('Вот части адреса:\nNAME: Олег Белов\nCITY: Омск\nPOSTAL: -\nSTREET: -\nPHONE: -\nEMAIL: -'),
  ['fullName=Олег Белов', 'city=Омск']);
check('индекс не из шести цифр отбрасывается (посылка уехала бы не туда)',
  flat('NAME: Олег Белов\nPOSTAL: 1234\nCITY: Омск\nSTREET: -\nPHONE: -\nEMAIL: -'),
  ['fullName=Олег Белов', 'city=Омск']);
check('«индекс» словами — тоже не индекс',
  flat('NAME: Олег Белов\nPOSTAL: не указан\nCITY: Омск\nSTREET: -\nPHONE: -\nEMAIL: -'),
  ['fullName=Олег Белов', 'city=Омск']);
check('обрезанный телефон отбрасывается',
  flat('NAME: Олег Белов\nCITY: Омск\nPHONE: 900-12\nPOSTAL: -\nSTREET: -\nEMAIL: -'),
  ['fullName=Олег Белов', 'city=Омск']);
check('битая почта отбрасывается',
  flat('NAME: Олег Белов\nCITY: Омск\nEMAIL: oleg(собака)mail\nPOSTAL: -\nSTREET: -\nPHONE: -'),
  ['fullName=Олег Белов', 'city=Омск']);

console.log('\n— когда не предлагаем вовсе —');
check('одна часть — это не разбор, предлагать нечего',
  flat('NAME: Олег Белов\nPOSTAL: -\nCITY: -\nSTREET: -\nPHONE: -\nEMAIL: -'), []);
check('модель ответила не по формату',
  flat('Я не смог разобрать эту строку.'), []);
check('пустой ответ', flat(''), []);

console.log('\n— проверки по отдельности —');
check('индекс: ровно шесть цифр', cleanPostal('123456'), '123456');
check('индекс: цифры с пробелом внутри — тоже шесть', cleanPostal('12 34 56'), '123456');
check('индекс: семь цифр — отказ', cleanPostal('1234567'), '');
check('телефон: возвращается как написан (человек узнаёт его глазами)',
  cleanPhone('+7 (900) 123-45-67'), '+7 (900) 123-45-67');
check('телефон: слишком много цифр — отказ', cleanPhone('12345678901234567890'), '');
check('почта: обычная проходит', cleanEmail('ivan@mail.ru'), 'ivan@mail.ru');
check('почта: без домена — отказ', cleanEmail('ivan@mail'), '');

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
