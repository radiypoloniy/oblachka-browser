// Прогон разбора ASN.1/DER из хранилища паролей Firefox (shared/firefoxAsn1.ts) — обычным node.
//
// Почему под проверкой. Это единственное место импорта Firefox, где ошибка МОЛЧИТ: неверно взятая
// соль или обрезанный IV не дают исключения, они дают мусор на выходе, неотличимый от «человек
// ввёл не тот мастер-пароль». Расшифровка поверх — три вызова node:crypto, там ошибка громкая.
//
// ⚠️ Структуры заданы ЛИТЕРАЛЬНЫМИ БАЙТАМИ, а не собраны нашим же кодировщиком. Круговой прогон
// «закодировали → разобрали» здесь бесполезен: кодировщик и разборщик сойдутся друг с другом и оба
// будут неправы, если я неверно понял формат. Это ровно тавтологический ассерт из разбора мутаций
// в CLAUDE.md — «проверка сравнивала результат с ТЕМИ ЖЕ константами, из которых он собран».
// Байты ниже расписаны по слоям вручную и держат моё понимание формата зафиксированным: разойдётся
// живой Firefox — разойдётся с чем-то проверяемым, а не с догадкой.
//
// Запуск: npm run firefox-asn1-check  (или общий npm test)
import { parseDer, oidToString, derInteger, parseEncryptedItem, parseLoginItem, stripPkcs7, toHex, OID, LOGIN_KEY_ID } from '../shared/firefoxAsn1.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

/** '30 66 06' → Uint8Array. Пробелы и переводы строк для читаемости слоёв. */
const b = (hex) => Uint8Array.from(hex.trim().split(/\s+/).map((h) => parseInt(h, 16)));

console.log('\n— идентификаторы алгоритмов —');
// ⚠️ Первый байт кодирует ДВА первых числа (40·a + b). Отдельным случаем, потому что это самое
// частое место, где самописный разбор OID ломается.
check('PBES2', oidToString(b('2a 86 48 86 f7 0d 01 05 0d')), OID.PBES2);
check('PBKDF2', oidToString(b('2a 86 48 86 f7 0d 01 05 0c')), OID.PBKDF2);
check('3DES-PBE', oidToString(b('2a 86 48 86 f7 0d 01 0c 05 01 03')), OID.PBE_SHA1_3DES);
check('des-ede3-cbc', oidToString(b('2a 86 48 86 f7 0d 03 07')), OID.DES_EDE3_CBC);
// У aes256-CBC первое число 2, а не 1 — 40·2+16 = 96 = 0x60, другая ветка той же формулы.
check('aes256-CBC', oidToString(b('60 86 48 01 65 03 04 01 2a')), OID.AES256_CBC);
// Многобайтовая группа: 113549 занимает три байта со старшим битом «продолжение».
check('длинная группа', oidToString(b('2a 86 48 86 f7 0d')), '1.2.840.113549');

console.log('\n— целые —');
check('одно­байтное', derInteger({ tag: 0x02, content: b('20'), children: [] }), 32);
check('двух­байтное', derInteger({ tag: 0x02, content: b('27 10'), children: [] }), 10000);
check('не INTEGER', derInteger({ tag: 0x04, content: b('20'), children: [] }), null);
check('нет узла', derInteger(undefined), null);

console.log('\n— длина в длинной форме —');
{
  // 0x81 0x80 = «длина занимает 1 байт дальше», значение 128. Короткой формой это не выразить, а
  // в живых key4.db так закодировано почти всё: шифротексты длиннее 127 байт.
  // 04 81 80 + 128 байт = 131 байт содержимого SEQUENCE, то есть 30 81 83.
  const long = b('30 81 83 04 81 80' + ' 41'.repeat(128));
  const node = parseDer(long);
  check('SEQUENCE длинной формы разобран', node?.children.length, 1);
  check('содержимое на месте', node?.children[0].content.length, 128);
  // 0x80 — неопределённая длина: законна в BER, ЗАПРЕЩЕНА в DER. Принять её значило бы читать
  // файл, которого NSS не пишет, по правилам, которых мы не проверяли.
  check('неопределённая длина отвергнута', parseDer(b('30 80 04 01 41 00 00')), null);
}

console.log('\n— key4.db, новое поколение (Firefox 75+): PBES2 + AES-256-CBC —');
{
  // Слои, сверху вниз:
  //   30 66                                  SEQUENCE (102 байта)
  //     30 52                                  SEQUENCE algid (82)
  //       06 09 …05 0d                           OID PBES2
  //       30 45                                  SEQUENCE параметры (69)
  //         30 26                                  SEQUENCE algid KDF (38)
  //           06 09 …05 0c                           OID PBKDF2
  //           30 19                                  SEQUENCE параметры PBKDF2 (25)
  //             04 04 aa bb cc dd                      OCTET соль
  //             02 02 27 10                            INTEGER 10000 итераций
  //             02 01 20                               INTEGER длина ключа 32
  //             30 0a 06 08 …02 09                     SEQUENCE hmacWithSHA256
  //         30 1b                                  SEQUENCE algid шифра (27)
  //           06 09 60 …01 2a                        OID aes256-CBC
  //           04 0e 00…0d                            OCTET IV — ЧЕТЫРНАДЦАТЬ байт, см. ниже
  //     04 10 f0…ff                            OCTET шифротекст
  const item = b(`
    30 66
      30 52
        06 09 2a 86 48 86 f7 0d 01 05 0d
        30 45
          30 26
            06 09 2a 86 48 86 f7 0d 01 05 0c
            30 19
              04 04 aa bb cc dd
              02 02 27 10
              02 01 20
              30 0a 06 08 2a 86 48 86 f7 0d 02 09
          30 1b
            06 09 60 86 48 01 65 03 04 01 2a
            04 0e 00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d
      04 10 f0 f1 f2 f3 f4 f5 f6 f7 f8 f9 fa fb fc fd fe ff
  `);
  const parsed = parseEncryptedItem(item);
  check('схема', parsed?.scheme, 'aes');
  check('соль', parsed && toHex(parsed.entrySalt), 'aabbccdd');
  check('итерации', parsed?.iterations, 10000);
  check('длина ключа', parsed?.keyLength, 32);
  // ⚠️ IV в файле лежит УРЕЗАННЫМ до 14 байт: два ведущих байта (04 0e — заголовок OCTET STRING)
  // NSS подразумевает и не пишет. Проверка держит именно 14, потому что «исправить» это на 16
  // здесь — самый вероятный способ сломать расшифровку первого блока каждого пароля.
  check('IV — четырнадцать байт', parsed?.iv.length, 14);
  check('IV', parsed && toHex(parsed.iv), '000102030405060708090a0b0c0d');
  check('шифротекст', parsed && toHex(parsed.ciphertext), 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');
}

console.log('\n— key4.db, старое поколение (до Firefox 75): 3DES —');
{
  // Профиль, заведённый до 2020 года, при обновлении браузера сам не мигрирует — эта ветка живая.
  const item = b(`
    30 3c
      30 28
        06 0b 2a 86 48 86 f7 0d 01 0c 05 01 03
        30 19
          04 14 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10 11 12 13 14
          02 01 01
      04 10 f0 f1 f2 f3 f4 f5 f6 f7 f8 f9 fa fb fc fd fe ff
  `);
  const parsed = parseEncryptedItem(item);
  check('схема', parsed?.scheme, '3des');
  check('соль — двадцать байт', parsed?.entrySalt.length, 20);
  check('соль', parsed && toHex(parsed.entrySalt), '0102030405060708090a0b0c0d0e0f1011121314');
  check('шифротекст', parsed && toHex(parsed.ciphertext), 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');
}

console.log('\n— logins.json, одно зашифрованное поле —');
{
  const item = b(`
    30 3a
      04 10 f8 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01
      30 14
        06 08 2a 86 48 86 f7 0d 03 07
        04 08 11 22 33 44 55 66 77 88
      04 10 f0 f1 f2 f3 f4 f5 f6 f7 f8 f9 fa fb fc fd fe ff
  `);
  const parsed = parseLoginItem(item);
  check('идентификатор ключа', parsed?.keyId, LOGIN_KEY_ID);
  check('шифр — 3DES', parsed?.cipher, '3des');
  check('IV — восемь байт (блок 3DES)', parsed?.iv.length, 8);
  check('IV', parsed && toHex(parsed.iv), '1122334455667788');
  check('шифротекст', parsed && toHex(parsed.ciphertext), 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');
}

console.log('\n— logins.json современного Firefox: поле зашифровано AES-256-CBC —');
{
  // ⚠️ Байты СНЯТЫ С ЖИВОГО ПРОФИЛЯ (Firefox 2026 года, 225 записей — все такие), только шифротекст
  // и IV заменены на узнаваемые. Случай заведён потому, что здесь я ошибся: ходовые описания формата
  // (firefox_decrypt и его пересказы) знают только 3DES, и по ним на современном профиле не
  // расшифровывается НИЧЕГО. Ошибка была молчаливой — импорт отрабатывал и переносил ноль.
  const item = b(`
    30 43
      04 10 f8 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01
      30 1d
        06 09 60 86 48 01 65 03 04 01 2a
        04 10 11 22 33 44 55 66 77 88 99 aa bb cc dd ee ff 00
      04 10 f0 f1 f2 f3 f4 f5 f6 f7 f8 f9 fa fb fc fd fe ff
  `);
  const parsed = parseLoginItem(item);
  check('идентификатор ключа', parsed?.keyId, LOGIN_KEY_ID);
  check('шифр — AES', parsed?.cipher, 'aes');
  // ⚠️ Шестнадцать, а не четырнадцать: урезанный IV — особенность ТОЛЬКО key4.db, у полей логина
  // он записан полностью. Перепутать эти два места — готовый способ сломать первый блок пароля.
  check('IV — шестнадцать байт (блок AES)', parsed?.iv.length, 16);
  check('IV', parsed && toHex(parsed.iv), '112233445566778899aabbccddeeff00');
  check('шифротекст', parsed && toHex(parsed.ciphertext), 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');
}

console.log('\n— отказы: битое и чужое —');
{
  // Обрезанный файл: длина обещает больше, чем есть. Разобрать «сколько получилось» здесь значит
  // расшифровывать обрывок вместо честного отказа.
  check('обрезанное содержимое', parseDer(b('30 20 04 04 aa bb')), null);
  // Хвост после верхней структуры — признак, что это не то поле (или склеены два).
  check('лишние байты в хвосте', parseDer(b('30 03 02 01 05 ff')), null);
  check('пустой вход', parseDer(b('')), null);
  // Незнакомый алгоритм (здесь RSA вместо PBE) — не догадываемся, отказываем.
  check('чужой алгоритм', parseEncryptedItem(b('30 15 30 0f 06 09 2a 86 48 86 f7 0d 01 01 01 05 00 04 02 aa bb')), null);
  // Поле логина с шифром, которого у Firefox не бывает (здесь RC2): шифра ровно два, и третий
  // означает не «новый формат», а испорченный файл.
  check('логин с чужим шифром', parseLoginItem(b(`
    30 3a
      04 10 f8 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01
      30 14
        06 08 2a 86 48 86 f7 0d 03 02
        04 08 11 22 33 44 55 66 77 88
      04 10 f0 f1 f2 f3 f4 f5 f6 f7 f8 f9 fa fb fc fd fe ff
  `)), null);
}

console.log('\n— снятие набивки PKCS#7 —');
{
  // Контрольная строка key4.db: 'password-check' это 14 байт, добитые двумя байтами 0x02.
  const checkBlock = new Uint8Array([...Buffer.from('password-check', 'latin1'), 2, 2]);
  check('контрольная строка', Buffer.from(stripPkcs7(checkBlock, 8)).toString('latin1'), 'password-check');
  check('набивка на целый блок', stripPkcs7(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8]), 8)?.length, 8);
  // ⚠️ Главный случай. Расшифровка НЕВЕРНЫМ ключом даёт случайные байты, и последний из них с
  // вероятностью 1/256 окажется правдоподобной длиной набивки. Проверяли бы только его — вернули
  // бы обрезанный мусор как пароль, и человек узнал бы об этом, не сумев войти на сайт.
  check('последний байт правдоподобен, остальные нет', stripPkcs7(Uint8Array.from([1, 2, 3, 4, 5, 6, 0, 3]), 8), null);
  check('набивка длиннее блока', stripPkcs7(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 9]), 8), null);
  check('нулевая набивка', stripPkcs7(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 0]), 8), null);
  check('длина не кратна блоку', stripPkcs7(Uint8Array.from([1, 2, 3]), 8), null);
  check('пусто', stripPkcs7(Uint8Array.from([]), 8), null);
}

console.log(`\nИтого: ${passed} ок, ${failed} провалено`);
process.exit(failed === 0 ? 0 : 1);
