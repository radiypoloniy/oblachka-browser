// Прогон форматов документов и картинок (shared/documentFormats.ts) — обычным node.
//
// Кнопка «Назвать» и кадр превью смотрят в один список с main. Разъехались бы — в поповере
// предложение имени у PDF пропало бы, а HEIC пытались бы декодировать в пустой nativeImage.
import { isDocumentFile, isImageFile } from '../shared/documentFormats.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

console.log('— документы (имя по содержимому) —');
check('pdf', isDocumentFile('report.PDF'), true);
check('docx', isDocumentFile('letter.docx'), true);
check('exe — не документ', isDocumentFile('Setup.exe'), false);
check('без расширения', isDocumentFile('readme'), false);

console.log('');
console.log('— кадр картинки —');
check('jpg', isImageFile('moscow.JPG'), true);
check('webp', isImageFile('a.webp'), true);
check('двойное расширение — последнее', isImageFile('foo.bar.png'), true);
check('heic — значок Проводника, не кадр', isImageFile('IMG.heic'), false);
check('pdf — не картинка', isImageFile('report.pdf'), false);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
