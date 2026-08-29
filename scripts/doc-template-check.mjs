// Сторож шаблонов документа Студии (src/components/notebook/doc/*).
//
// ⚠️ Проверка СТАТИЧЕСКАЯ, по тексту файлов, а не прогоном — и это вынужденно: модули шаблонов
// импортируют друг друга относительными путями без расширения, а голый node такое не резолвит
// (ровно та причина, по которой в shared/sessionTree.ts нельзя значимых импортов). Зато главный
// инвариант здесь именно текстовый.
//
// ⚠️ ГЛАВНЫЙ ИНВАРИАНТ — экранирование. Шаблоны собирают HTML строками, а текст в них пришёл от
// модели ПО МАТЕРИАЛАМ ЧУЖИХ СТРАНИЦ: забытый esc() — это чужая разметка в нашем документе,
// который человек потом кому-то отправит. Ошибка тихая: документ выглядит целым, пока в
// источнике не встретится угловая скобка. Глазами на ревью такое не ловится, регулярка ловит.
//
// Запуск: npm test -- doc-template
import fs from 'node:fs';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const DIR = 'src/components/notebook/doc';
const TEMPLATES = ['report', 'spread', 'cards'];
const read = (f) => fs.readFileSync(f, 'utf8');

// ── экранирование ───────────────────────────────────────────────────────────
// Всё, что несёт текст модели, обязано попадать в разметку только через esc(...).
// Правильная форма всегда `${esc(...)}`; голая подстановка — ошибка.
const FIELD = '(?:b\.(?:title|text)|p\.(?:label|value)|spec\.title|cover\.(?:title|text)'
  + '|hero\.(?:label|value)|chip\.(?:label|value)|g\.head|meta)';
// Голая подстановка поля в разметку. Хвост «не ? и не .» отсекает ТЕСТ тернарника
// (`${p.value ? … : ''}`) — там поле только проверяется на пустоту, а печатается в ветке.
const RAW = new RegExp('\\$\\{\\s*' + FIELD + '(?!\\s*[?.])', 'g');
// А вот ВЕТКА тернарника, печатающая поле напрямую, — настоящая дыра.
const RAW_BRANCH = new RegExp('\\?\\s*' + FIELD + '\\s*[:}]', 'g');

for (const t of TEMPLATES) {
  const src = read(`${DIR}/${t}.ts`);
  const raw = [...src.matchAll(RAW), ...src.matchAll(RAW_BRANCH)].map((m) => m[0].trim());
  check(`${t}: текст модели не попадает в HTML мимо esc()`, raw, []);
  check(`${t}: экспортирует CSS`, /export const CSS/.test(src), true);
  check(`${t}: экспортирует body()`, /export function body\(/.test(src), true);
}

// Список пунктов — отдельный случай: там подставляется элемент цикла, а не поле блока.
for (const t of TEMPLATES) {
  const src = read(`${DIR}/${t}.ts`);
  const listLines = src.split('\n').filter((l) => l.includes('items ?? []'));
  const bad = listLines.filter((l) => !l.includes('esc('));
  check(`${t}: пункты списка экранируются`, bad, []);
}

// ── все три заведены и подключены ───────────────────────────────────────────
const index = read(`${DIR}/index.ts`);
for (const t of TEMPLATES) {
  check(`index: шаблон ${t} есть в DOC_TEMPLATES`, index.includes(`id: '${t}'`), true);
  check(`index: шаблон ${t} есть в RENDER`, (index.split('RENDER = {')[1] || '').split('}')[0].includes(t), true);
  check(`index: у ${t} решена пригодность`, new RegExp(`'${t}'`).test(index), true);
}
check('index: тип DocTemplate перечисляет ровно три', (index.match(/export type DocTemplate = ([^;]+);/) || [])[1],
  "'report' | 'spread' | 'cards'");

// ── предпросмотр показывает ТО ЖЕ, что сохраняется ──────────────────────────
// ⚠️ Смысл затеи: один рендерер на шаблон. Если предпросмотр, сохранение и открытие начнут
// брать разные строки, человек сохранит не то, что видел, — а заметит это только у получателя.
const view = read('src/components/notebook/DocumentView.tsx');
check('вид: предпросмотр берёт html', /srcDoc=\{html\}/.test(view), true);
check('вид: сохранение берёт тот же html', /saveNotebookDoc\(spec\.title, html\)/.test(view), true);
check('вид: открытие вкладкой берёт тот же html', /openStudioDoc\(spec\.title, html\)/.test(view), true);
// ⚠️ sandbox="" — ни скриптов, ни форм, ни навигации. Атрибут снимается одним движением и
// молча включает исполнение всего, что модель принесла с чужих страниц.
check('вид: предпросмотр в песочнице', /sandbox=""/.test(view), true);

// ── общая оболочка ──────────────────────────────────────────────────────────
const shell = read(`${DIR}/shell.ts`);
check('оболочка: esc закрывает &', /replace\(\/&\/g, '&amp;'\)/.test(shell), true);
check('оболочка: esc закрывает угловые скобки', /&lt;/.test(shell) && /&gt;/.test(shell), true);
check('оболочка: esc закрывает кавычку', /&quot;/.test(shell), true);
// Документ уезжает туда, где наших шрифтов нет.
check('оболочка: у гарнитур есть системный запас', /system-ui/.test(shell), true);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
