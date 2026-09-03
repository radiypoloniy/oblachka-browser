// Вложения в ответе модели: разбор data-URL, размер, имена, порог «предлагать файлом».
//
// ⚠️ Почему это проверяется машиной, а не глазом. Разбор data-URL — единственное место, где чужая
// строка превращается в БАЙТЫ НА ДИСКЕ, и ошибка там тихая: неверно снятый префикс даёт файл,
// который откроется битым через неделю, когда его уже не с чем сверить.
import {
  parseDataUrl, base64Size, extForMime, isImageMime, attachmentName, savable, blockFileName,
} from '../shared/aiAttachments.ts';

let passed = 0;
let failed = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ok   ${what}`); }
  else { failed++; console.log(` FAIL  ${what}\n         получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`); }
};

console.log('\n— разбор data-URL —');
check('обычная картинка', parseDataUrl('data:image/png;base64,iVBORw0KGgo='),
  { mime: 'image/png', base64: 'iVBORw0KGgo=' });
// ⚠️ Шлюзы вставляют параметры между типом и base64 — их надо пропустить, а не отвергнуть ответ.
check('с параметром перед base64', parseDataUrl('data:image/jpeg;charset=utf-8;base64,AAAA'),
  { mime: 'image/jpeg', base64: 'AAAA' });
check('регистр типа приводится', parseDataUrl('data:IMAGE/PNG;base64,AAAA')?.mime, 'image/png');
// ⚠️ Перенос строки внутри base64 законен и встречается: без вычистки на диск уедет битый файл.
check('переносы внутри base64 вычищены', parseDataUrl('data:image/png;base64,AA\nAA\r\n')?.base64, 'AAAA');
check('обычный http-адрес — не наш случай', parseDataUrl('https://example.com/a.png'), null);
// ⚠️ Не-base64 data-URL мы НЕ берём: гадать по процент-кодированию значит записать мусор под png.
check('data-URL без base64 отвергается', parseDataUrl('data:image/png,%89PNG'), null);
check('пустое тело отвергается', parseDataUrl('data:image/png;base64,'), null);
check('мусор отвергается', parseDataUrl('не адрес вовсе'), null);
check('пробелы по краям не мешают', parseDataUrl('  data:image/png;base64,AAAA  ')?.mime, 'image/png');

console.log('\n— размер по base64 —');
check('без добивки', base64Size('AAAA'), 3);
check('одна добивка', base64Size('AAA='), 2);
check('две добивки', base64Size('AA=='), 1);
check('пустая строка', base64Size(''), 0);
check('переносы не считаются', base64Size('AA\nAA'), 3);

console.log('\n— расширение по типу —');
check('png', extForMime('image/png'), 'png');
check('jpeg → jpg', extForMime('image/jpeg'), 'jpg');
// ⚠️ Открытый разбор «после слэша» дал бы файл «Рисунок.svg+xml» — поэтому таблица закрытая.
check('svg+xml → svg', extForMime('image/svg+xml'), 'svg');
check('с параметром', extForMime('text/csv; charset=utf-8'), 'csv');
check('неизвестный тип', extForMime('application/octet-stream'), 'bin');

console.log('\n— картинка ли —');
check('png да', isImageMime('image/png'), true);
check('IMAGE/PNG да', isImageMime('IMAGE/PNG'), true);
check('json нет', isImageMime('application/json'), false);

console.log('\n— имена —');
check('первая картинка', attachmentName('image/png', 0), 'Изображение 1.png');
check('вторая картинка', attachmentName('image/webp', 1), 'Изображение 2.webp');
check('не картинка', attachmentName('application/pdf', 0), 'Файл 1.pdf');

console.log('\n— предлагать ли фрагмент файлом —');
// ⚠️ Живой случай: модель постоянно берёт в фенс одну строку. Кнопка «сохранить» у такого — шум.
check('однострочная команда — нет', savable('bash', 'npm install'), false);
check('короткий json — нет', savable('json', '{"a":1}'), false);
check('пусто — нет', savable('csv', '   \n  '), false);
check('пять строк — да', savable('csv', 'a,b\n1,2\n3,4\n5,6\n7,8'), true);
check('длинный однострочный csv — да', savable('csv', 'a,'.repeat(120)), true);
check('без языка, но длинный — да', savable(null, 'x'.repeat(250)), true);
// ⚠️ Незнакомый язык не предлагаем: расширения для него нет, а «.txt» соврало бы про содержимое.
check('незнакомый язык — нет', savable('brainfuck', 'x'.repeat(250)), false);

console.log('\n— имя фрагмента —');
check('csv', blockFileName('csv', 0), 'Таблица 1.csv');
check('python', blockFileName('python', 2), 'Код 3.py');
check('markdown', blockFileName('md', 0), 'Документ 1.md');
check('без языка', blockFileName(null, 0), 'Фрагмент 1.txt');
check('регистр языка не важен', blockFileName('JSON', 0), 'JSON 1.json');

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
