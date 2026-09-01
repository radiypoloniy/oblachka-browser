// Конверт экспорта паролей (electron/vaultEnvelope.ts) — без electron, обычным node.
//
// ⚠️ ЗАЧЕМ ПРОВЕРЯТЬ ЗАПУСКОМ. Файл экспорта — единственное, что уносит пароли ЗА ПРЕДЕЛЫ машины:
// в облако, на флешку, в почту. Там он оказывается у того, кто может перебирать фразу сколько
// угодно, без «трёх попыток и блокировки». Ошибка в этом файле не даёт ни падения, ни красного
// экрана — она даёт слабый ключ, о котором никто не узнает.
//
// ⚠️ И вторая половина цены: сломанное ЧТЕНИЕ старых конвертов — это потеря паролей, а не
// «повышение безопасности». Экспорты, сделанные до перехода на v2, лежат у людей на дисках, и
// отказаться их открыть нельзя. Поэтому обратная совместимость проверяется наравне со стойкостью.
//
// Запуск: npm test -- vault-envelope
import {
  encryptWithPassphrase, decryptWithPassphrase, encryptV1ForTest,
  SCRYPT_N, SCRYPT_R, SCRYPT_P,
} from '../electron/vaultEnvelope.ts';

let passed = 0;
let failed = 0;
function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}
const throws = (what, fn) => {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(what, threw, true);
};

const SECRET = 'логин\tпароль\nвторая строка — с юникодом ✓';
const PHRASE = 'моя длинная парольная фраза';

console.log('\n── стойкость: параметры новых конвертов ──');
// ⚠️ Эталон ЛИТЕРАЛЬНЫМИ числами: сравнение константы с самой собой держало бы форму и было бы
// слепо к тому, что кто-то вернул умолчания Node. Разбор приёма — в CLAUDE.md, мутационный прогон.
check('N = 2^17, а не умолчание Node 2^14', SCRYPT_N, 131072);
check('r = 8', SCRYPT_R, 8);
check('p = 1', SCRYPT_P, 1);

console.log('\n── круг: зашифровали, расшифровали, получили то же ──');
const blob = encryptWithPassphrase(PHRASE, SECRET);
check('расшифровка возвращает исходный текст', decryptWithPassphrase(PHRASE, blob), SECRET);

const env = JSON.parse(blob);
check('конверт помечен второй версией', env.v, 2);
// ⚠️ Главное в формате v2 — не число N, а то, что оно ЛЕЖИТ В ФАЙЛЕ. Пока параметры зашиты в
// код, любое их изменение делает нечитаемыми все прежние экспорты.
check('параметры вывода ключа записаны в сам конверт', env.kdf, { N: 131072, r: 8, p: 1 });
check('соль у каждого конверта своя',
  JSON.parse(encryptWithPassphrase(PHRASE, SECRET)).salt !== env.salt, true);

console.log('\n── отказы: чужая фраза и порча файла ──');
throws('неверная парольная фраза — отказ, а не мусор', () => decryptWithPassphrase('другая фраза', blob));
throws('подменённый шифротекст — отказ (GCM ловит подделку)', () => {
  const bad = { ...env, ciphertext: Buffer.from('подмена', 'utf8').toString('base64') };
  decryptWithPassphrase(PHRASE, JSON.stringify(bad));
});
throws('неизвестная версия формата — отказ', () =>
  decryptWithPassphrase(PHRASE, JSON.stringify({ ...env, v: 99 })));

console.log('\n── обратная совместимость: конверты первой версии ──');
const old = encryptV1ForTest(PHRASE, SECRET);
check('старый конверт по-прежнему читается', decryptWithPassphrase(PHRASE, old), SECRET);
check('в старом конверте параметров нет — берутся умолчания', JSON.parse(old).kdf, undefined);

console.log('\n── параметры из файла — недоверенный ввод ──');
// ⚠️ Конверт приносит человек, и параметры в нём может выставить кто угодно. N = 2^30 — это
// 128·2^30·8 байт памяти и минуты счёта: приложение просто повисло бы, открывая «чужой экспорт».
throws('N за верхней границей — отказ, а не попытка считать',
  () => decryptWithPassphrase(PHRASE, JSON.stringify({ ...env, kdf: { N: 1 << 30, r: 8, p: 1 } })));
throws('N ниже разумного — отказ (иначе конверт с N=2 «расшифровался» бы мгновенно и слабо)',
  () => decryptWithPassphrase(PHRASE, JSON.stringify({ ...env, kdf: { N: 2, r: 8, p: 1 } })));
throws('r за границей — отказ',
  () => decryptWithPassphrase(PHRASE, JSON.stringify({ ...env, kdf: { N: 131072, r: 999, p: 1 } })));
throws('дробное N — отказ',
  () => decryptWithPassphrase(PHRASE, JSON.stringify({ ...env, kdf: { N: 1.5, r: 8, p: 1 } })));
throws('параметров нет вовсе, а версия вторая — отказ',
  () => decryptWithPassphrase(PHRASE, JSON.stringify({ ...env, kdf: undefined })));

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
