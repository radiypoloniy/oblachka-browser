// Прогон санитайзера имени файла (shared/fileNameSafety.ts) — без electron, обычным node.
//
// Зачем отдельный прогон: это единственное место цепочки «имя по содержимому», которое решает,
// что ляжет на диск. Ответ придумывает модель, а ошибка здесь — испорченный или затёртый файл
// человека, поэтому проверяется прогоном, а не чтением (тот же приём, что bookmarks-schema-check).
//
// Запуск: npm run filename-check
import { sanitizeFileNameBase } from '../shared/fileNameSafety.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

console.log('\n— обычные ответы модели —');
check('чистое имя проходит как есть',
  sanitizeFileNameBase('Договор аренды — ООО Ромашка — 2026-08', '.pdf'),
  'Договор аренды — ООО Ромашка — 2026-08');
check('кавычки снимаются',
  sanitizeFileNameBase('«Счёт на оплату №451 — Ситилинк»', '.pdf'),
  'Счёт на оплату №451 — Ситилинк');
check('подпись «Имя файла:» снимается',
  sanitizeFileNameBase('Имя файла: Справка 2-НДФЛ — 2025', '.pdf'),
  'Справка 2-НДФЛ — 2025');
check('пояснение со второй строки отбрасывается',
  sanitizeFileNameBase('Отчёт по продажам — 2025\nЭто квартальный отчёт компании.', '.pdf'),
  'Отчёт по продажам — 2025');
check('дописанное расширение снимается (иначе вышло бы «.pdf.pdf»)',
  sanitizeFileNameBase('Договор поставки.pdf', '.pdf'),
  'Договор поставки');

console.log('\n— то, из-за чего fs.rename упал бы или файл лёг бы не туда —');
check('двоеточие заменяется пробелом',
  sanitizeFileNameBase('Договор: аренда помещения', '.pdf'),
  'Договор аренда помещения');
check('слеши в дате не создают путь',
  sanitizeFileNameBase('Акт от 01/02/2026', '.pdf'),
  'Акт от 01 02 2026');
check('попытка уйти вверх по дереву не оставляет каталогов',
  sanitizeFileNameBase('../../Windows/system32/важное', '.pdf'),
  'Windows system32 важное');
check('точки в конце срезаются (Windows срезал бы их молча)',
  sanitizeFileNameBase('Инструкция по сборке...', '.pdf'),
  'Инструкция по сборке');
check('управляющие символы вырезаются',
  sanitizeFileNameBase(`Счёт${String.fromCharCode(9)}№12${String.fromCharCode(0)}`, '.pdf'),
  'Счёт №12');

console.log('\n— отказы: лучше оставить старое имя —');
check('зарезервированное имя устройства DOS',
  sanitizeFileNameBase('CON', '.pdf'), null);
check('зарезервированное имя в другом регистре',
  sanitizeFileNameBase('aux', '.txt'), null);
check('слишком длинное имя не режется, а отбраковывается',
  sanitizeFileNameBase('Договор '.repeat(20), '.pdf'), null);
check('слишком короткое имя ничего не называет',
  sanitizeFileNameBase('Ок', '.pdf'), null);
check('пустой ответ',
  sanitizeFileNameBase('   ', '.pdf'), null);
check('ответ из одних запрещённых символов',
  sanitizeFileNameBase('///:::', '.pdf'), null);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
