// Поиск часового пояса по тому, как его называет человек (shared/timeZones.ts).
//
// Зачем: живой случай 22.08 — поиск по «edt» не находил НИЧЕГО, потому что такой строки
// в списке ICU нет вовсе. Аббревиатура — ярлык, а не идентификатор.
//   npm test -- timezones
import { searchTimeZones, zoneAbbrev, zoneCity, resolveZone, ZONE_ALIASES } from '../shared/timeZones.ts';

let passed = 0;
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  ✗ ${name}\n      получили ${JSON.stringify(got)}\n      ждали    ${JSON.stringify(want)}`); }
  else { passed++; console.log(`  ✓ ${name}`); }
};
const checkTrue = (name, got) => check(name, !!got, true);

// Настоящий список ICU — искать надо в том же, в чём ищет приложение.
const ALL = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [];

console.log('\n── список поясов вообще есть ──');
checkTrue('ICU отдал пояса', ALL.length > 100);
checkTrue('в нём есть America/New_York', ALL.includes('America/New_York'));

console.log('\n── аббревиатуры (живой случай «edt») ──');
{
  // ⚠️ То, с чего всё началось: человек пишет EDT, а такого пояса не существует.
  check('edt → Нью-Йорк', searchTimeZones('edt', ALL)[0], 'America/New_York');
  check('EDT в верхнем регистре', searchTimeZones('EDT', ALL)[0], 'America/New_York');
  // ⚠️ Летний и зимний ярлык ведут в ОДИН пояс: пояс один, меняется только подпись.
  check('est ведёт туда же', searchTimeZones('est', ALL)[0], 'America/New_York');
  check('pst → Лос-Анджелес', searchTimeZones('pst', ALL)[0], 'America/Los_Angeles');
  check('jst → Токио', searchTimeZones('jst', ALL)[0], 'Asia/Tokyo');
  check('msk → Москва', searchTimeZones('msk', ALL)[0], 'Europe/Moscow');
  check('мск по-русски', searchTimeZones('мск', ALL)[0], 'Europe/Moscow');
  // ⚠️ Точное совпадение идёт ПЕРВЫМ: иначе «ist» тонет среди десятка «...Istanbul...».
  // ⚠️ Ждём не конкретное имя, а РАЗРЕШЁННОЕ: node здесь знает Asia/Calcutta, Chromium —
  // Asia/Kolkata. Проверка обязана пережить обе сборки, иначе она врёт про половину из них.
  check('ist не тонет среди Стамбулов', searchTimeZones('ist', ALL)[0], resolveZone('Asia/Kolkata', ALL));
  checkTrue('но Стамбул из выдачи не пропал', searchTimeZones('ist', ALL).includes('Europe/Istanbul'));
}

console.log('\n── русские имена городов ──');
{
  check('москва', searchTimeZones('москва', ALL)[0], 'Europe/Moscow');
  check('нью-йорк', searchTimeZones('нью-йорк', ALL)[0], 'America/New_York');
  check('токио', searchTimeZones('токио', ALL)[0], 'Asia/Tokyo');
  check('владивосток', searchTimeZones('владивосток', ALL)[0], 'Asia/Vladivostok');
  // Набрали половину — подсказка всё равно приходит.
  check('«мос» предлагает Москву', searchTimeZones('мос', ALL)[0], 'Europe/Moscow');
}

console.log('\n── обычный поиск по идентификатору ──');
{
  check('berlin', searchTimeZones('berlin', ALL)[0], 'Europe/Berlin');
  check('new york через пробел', searchTimeZones('new york', ALL)[0], 'America/New_York');
  check('мусор ничего не находит', searchTimeZones('щщщ', ALL), []);
  const already = searchTimeZones('tokyo', ALL, ['Asia/Tokyo']);
  checkTrue('уже добавленный пояс не предлагается', !already.includes('Asia/Tokyo'));
  checkTrue('выдача ограничена', searchTimeZones('a', ALL).length <= 40);
  checkTrue('пустой запрос отдаёт начало списка', searchTimeZones('', ALL).length > 0);
}

console.log('\n── подпись пояса ──');
{
  const winter = new Date('2026-01-15T12:00:00Z');
  const summer = new Date('2026-07-15T12:00:00Z');
  check('зимой Нью-Йорк — EST', zoneAbbrev('America/New_York', winter), 'EST');
  check('летом он же — EDT', zoneAbbrev('America/New_York', summer), 'EDT');
  // ⚠️ Буквенный ярлык есть НЕ у всех поясов: en-US знает EDT, но для Токио отдаёт «GMT+9».
  // Это и есть причина, по которой пустая строка — штатный ответ, а не сбой.
  checkTrue('у Токио ярлык либо буквенный, либо его нет',
    ['JST', ''].includes(zoneAbbrev('Asia/Tokyo', summer)));
  // ⚠️ У Москвы ярлыка нет — Intl отдаёт «GMT+3». Показывать это рядом с уже посчитанным
  // смещением значит дважды сказать одно и то же, поэтому здесь пусто.
  check('у Москвы ярлыка нет', zoneAbbrev('Europe/Moscow', summer), '');
  check('битый пояс не роняет', zoneAbbrev('Mars/Olympus', summer), '');
}

console.log('\n── имя города из идентификатора ──');
check('подчёркивания заменены', zoneCity('America/New_York'), 'New York');
check('без слэша — как есть', zoneCity('UTC'), 'UTC');
check('глубокий путь', zoneCity('America/Argentina/Buenos_Aires'), 'Buenos Aires');

console.log('\n── таблица ярлыков цела ──');
{
  // ⚠️ Ярлык, ведущий в несуществующий пояс, — это молча пустая выдача у человека.
  const broken = Object.entries(ZONE_ALIASES).filter(([, id]) => !resolveZone(id, ALL));
  check('все ярлыки ведут в настоящие пояса', broken.map(([k, v]) => `${k}→${v}`), []);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
