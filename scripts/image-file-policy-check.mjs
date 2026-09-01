// Сторож политики чтения файлов ради превью (shared/imageFilePolicy.ts).
//
// ⚠️ Случаи — из аудита 21.08 (находка 9): канал превью читал любой путь от хрома, то есть XSS в
// нашем интерфейсе означал бы выдачу паролей и ключей пользователя. Ниже записаны и законные
// пути (чтобы правило не сломало функцию), и ровно те файлы, ради которых барьер и ставился.
//
// Запуск: npm test -- image-file (или node scripts/image-file-policy-check.mjs)
import { isReadableImagePath } from '../shared/imageFilePolicy.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

console.log('— картинки читаются (функция цела) —');
check('png из папки человека', isReadableImagePath('C:\\Users\\user\\Pictures\\shot.png'), true);
check('jpeg', isReadableImagePath('C:\\photos\\a.jpeg'), true);
check('svg (nativeImage его не декодирует, читаем как есть)', isReadableImagePath('C:\\icons\\logo.svg'), true);
check('unix-путь', isReadableImagePath('/home/user/pic.webp'), true);
check('регистр расширения не важен', isReadableImagePath('C:\\x\\PHOTO.PNG'), true);
check('точки в имени', isReadableImagePath('C:\\x\\my.photo.2026.png'), true);

console.log('\n— данные пользователя закрыты —');
check('база паролей', isReadableImagePath('C:\\Users\\user\\AppData\\Roaming\\oblako-browser\\passwords.sqlite'), false);
check('конфиг VPN с учёткой', isReadableImagePath('C:\\Users\\user\\AppData\\Roaming\\oblako-browser\\xray-config.json'), false);
check('сессия вкладок', isReadableImagePath('C:\\Users\\user\\AppData\\Roaming\\oblako-browser\\session.json'), false);
// ⚠️ У ключа расширения нет вовсе — именно поэтому барьер стоит по расширению, а не по
// чёрному списку имён.
check('SSH-ключ (без расширения)', isReadableImagePath('C:\\Users\\user\\.ssh\\id_rsa'), false);
check('скрытый файл без расширения', isReadableImagePath('/home/user/.bashrc'), false);
check('исполняемый файл', isReadableImagePath('C:\\Windows\\System32\\cmd.exe'), false);

console.log('\n— обходы проверки —');
// ⚠️ NUL обрывает строку в системных вызовах: для проверки путь кончается на .png, для файловой
// системы — раньше. Классический обход фильтра по расширению.
check('NUL-байт перед настоящим путём', isReadableImagePath('C:\\secret\\id_rsa\u0000.png'), false);
check('обход каталогом вверх', isReadableImagePath('C:\\pics\\..\\..\\secrets\\key.png'), false);
check('unix-обход каталогом вверх', isReadableImagePath('/home/user/pics/../../etc/shadow.png'), false);
check('пустая строка', isReadableImagePath(''), false);
check('не строка', isReadableImagePath(null), false);
check('расширение без имени', isReadableImagePath('C:\\x\\.png'), false);
check('картиночное слово в каталоге, а не в имени', isReadableImagePath('C:\\png\\passwords.sqlite'), false);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
