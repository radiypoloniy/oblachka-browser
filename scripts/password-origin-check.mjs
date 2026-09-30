// Матчинг сохранённых входов между корнем сайта и поддоменами — обычный Node, без Electron.
// Запуск: node --experimental-strip-types scripts/password-origin-check.mjs
import {
  dedupeAnonymousPasswordMatches, passwordMatchesForOrigin, passwordOriginMatch,
} from '../electron/passwordOriginMatching.ts';

let passed = 0;
let failed = 0;
function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

const entries = [
  { id: 1, origin: 'https://my.senko.digital', username: '' },
  { id: 2, origin: 'https://senko.digital', username: 'sadlapant@yandex.ru' },
];

console.log('\n— корень сайта и поддомен —');
check('senko.digital подходит my.senko.digital только как same-site',
  passwordOriginMatch('https://my.senko.digital', 'https://senko.digital'), 'same-site');
check('точный origin остаётся exact',
  passwordOriginMatch('https://my.senko.digital', 'https://my.senko.digital'), 'exact');
check('по одному сайту доступны и логин, и самостоятельная password-only запись',
  passwordMatchesForOrigin(entries, 'https://my.senko.digital').map(({ id }) => id), [1, 2]);
check('безымянный дубль того же секрета скрывается',
  dedupeAnonymousPasswordMatches(entries, (id) => id === 1 || id === 2 ? 'same-password' : null)
    .map(({ id }) => id), [2]);
check('безымянный ДРУГОЙ пароль остаётся в списке',
  dedupeAnonymousPasswordMatches(entries, (id) => id === 1 ? 'caddy-password' : 'account-password')
    .map(({ id }) => id), [1, 2]);

console.log('\n— границы безопасности —');
check('чужой registrable domain не подходит',
  passwordOriginMatch('https://my.senko.digital', 'https://senko.example'), null);
check('разные private-suffix арендаторы не подходят',
  passwordOriginMatch('https://a.github.io', 'https://b.github.io'), null);
check('HTTPS-пароль не отдаётся HTTP-странице',
  passwordOriginMatch('http://my.senko.digital', 'https://senko.digital'), null);
check('без полноценного аккаунта запись без логина остаётся доступна',
  passwordMatchesForOrigin([entries[0]], 'https://my.senko.digital').map(({ id }) => id), [1]);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
