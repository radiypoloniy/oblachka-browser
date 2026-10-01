// Чистая часть k-anonymity проверки: хеширование и разбор padded range-ответа без сети/Electron.
// Запуск: node --experimental-strip-types scripts/password-breach-check.mjs
import { parsePasswordRange } from '../shared/passwordBreach.ts';
import { passwordRangeHash } from '../electron/passwordRangeHash.ts';
import { passwordChangeUrl } from '../shared/passwordChange.ts';

let passed = 0;
let failed = 0;
function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

console.log('\n— k-anonymity hash —');
const known = passwordRangeHash('password');
check('SHA-1 prefix содержит ровно 5 символов', known.prefix, '5BAA6');
check('полный хеш не входит в отправляемый prefix', known.suffix.length, 35);
check('UTF-8 хешируется детерминированно', passwordRangeHash('пароль'), passwordRangeHash('пароль'));

console.log('\n— padded range response —');
const parsed = parsePasswordRange([
  `${known.suffix}:3861493`,
  '00000000000000000000000000000000000:0',
  'BROKEN:12',
  'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:not-a-number',
].join('\r\n'));
check('реальное совпадение прочитано', parsed.get(known.suffix), 3861493);
check('padding с count=0 отброшен', parsed.has('00000000000000000000000000000000000'), false);
check('битые строки отброшены', parsed.size, 1);

console.log('\n— переход к смене пароля —');
check('HTTPS открывает стандартный well-known URL',
  passwordChangeUrl('https://example.com', 'https://example.com/login'),
  'https://example.com/.well-known/change-password');
check('HTTP не получает чувствительный well-known маршрут',
  passwordChangeUrl('http://example.com', 'http://example.com/login'),
  'http://example.com/login');
check('localhost разрешён как доверенный origin',
  passwordChangeUrl('http://localhost:3000', 'http://localhost:3000/login'),
  'http://localhost:3000/.well-known/change-password');

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
