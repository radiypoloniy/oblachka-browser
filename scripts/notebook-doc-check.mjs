// Прогон разбора документа Студии (shared/notebookDoc.ts) — без electron, обычным node.
//
// ⚠️ Проверяется не «валидный JSON» — его гарантирует грамматика на каждом токене. Проверяется
// то, чего грамматика НЕ гарантирует: наполнение. Модель вправе прислать блок правильной формы
// и совершенно пустой («kind»:"list" без единого пункта), и пустая рамка в документе выглядит
// поломкой, а не задумкой. Каждый случай ниже — про это.
//
// Запуск: npm test -- notebook-doc
import fs from 'node:fs';
import { normalizeDoc, DOC_BLOCKS, DOC_MAX_BLOCKS, HEADING_MAX_CHARS } from '../shared/notebookDoc.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

// ── мусор на входе ──────────────────────────────────────────────────────────
check('null → нечего рисовать', normalizeDoc(null), null);
check('не объект → нечего рисовать', normalizeDoc('текст'), null);
check('нет блоков → нечего рисовать', normalizeDoc({ title: 'Есть', blocks: [] }), null);
check('блоки не массив → нечего рисовать', normalizeDoc({ blocks: 'списком' }), null);

// ── неизвестный тип блока ───────────────────────────────────────────────────
check(
  'выдуманный тип блока выбрасывается, остальное живёт',
  normalizeDoc({ title: 'Д', blocks: [{ kind: 'video', text: 'x' }, { kind: 'text', text: 'Абзац' }] })?.blocks,
  [{ kind: 'text', text: 'Абзац' }],
);

// ── ПУСТЫЕ ПО СВОЕМУ ТИПУ ───────────────────────────────────────────────────
// Форму даёт грамматика, наполнение — нет. Это и есть главный класс случаев.
//
// ⚠️ Два случая здесь ПЕРЕВЁРНУТЫ 29.08.2026, и это не послабление проверки. Раньше они
// утверждали, что блок с текстом в соседнем поле выбрасывается, — и ровно это оказалось
// багом, стоившим человеку документа из семи пустых разделов (разбор ниже, «содержимое в
// соседнем поле»). Пустой теперь значит ПО-НАСТОЯЩЕМУ пустой: ни text, ни title.
check('list без пунктов не рисуется', normalizeDoc({ blocks: [{ kind: 'list' }] }), null);
check('text вовсе без содержимого не рисуется', normalizeDoc({ blocks: [{ kind: 'text' }] }), null);
check('metrics без пар не рисуется', normalizeDoc({ blocks: [{ kind: 'metrics', title: 'Числа' }] }), null);
check('cover вовсе без содержимого не рисуется', normalizeDoc({ blocks: [{ kind: 'cover' }] }), null);
check(
  'quote живёт текстом, а не заголовком',
  normalizeDoc({ blocks: [{ kind: 'quote', text: 'Мысль' }] })?.blocks,
  [{ kind: 'quote', text: 'Мысль' }],
);

// ── пробелы ─────────────────────────────────────────────────────────────────
check('строка из пробелов считается пустой', normalizeDoc({ blocks: [{ kind: 'text', text: '   ' }] }), null);
check(
  'пункты из пробелов вычищаются',
  normalizeDoc({ blocks: [{ kind: 'list', items: ['Раз', '  ', '', 'Два'] }] })?.blocks[0].items,
  ['Раз', 'Два'],
);
check(
  'пара без подписи И без значения выбрасывается',
  normalizeDoc({ blocks: [{ kind: 'table', pairs: [{ label: '', value: '' }, { label: 'Вес', value: '2 кг' }] }] })?.blocks[0].pairs,
  [{ label: 'Вес', value: '2 кг' }],
);

// ── потолки ─────────────────────────────────────────────────────────────────
// ⚠️ Потолок читается из DOC_MAX_BLOCKS, а не зашит числом: он уже менялся (12 -> 24, когда
// оказалось, что на 12 блоках исследование обрывается на середине), и проверка не должна
// падать от осознанной правки. Общей схемы документа больше нет — документ собирается фазами
// (electron/NotebookDocument.ts), и потолок остался только у разбора.
check(
  'блоков не больше потолка',
  normalizeDoc({ blocks: Array.from({ length: DOC_MAX_BLOCKS + 8 }, (_, i) => ({ kind: 'text', text: `а${i}` })) })?.blocks.length,
  DOC_MAX_BLOCKS,
);
check(
  'потолок рассчитан на исследование, а не на заметку',
  DOC_MAX_BLOCKS >= 18,
  true,
);
check(
  'пунктов не больше восьми',
  normalizeDoc({ blocks: [{ kind: 'list', items: Array.from({ length: 20 }, (_, i) => `п${i}`) }] })?.blocks[0].items.length,
  8,
);
check(
  'пар не больше шести',
  normalizeDoc({ blocks: [{ kind: 'metrics', pairs: Array.from({ length: 20 }, (_, i) => ({ label: `л${i}`, value: `${i}` })) }] })?.blocks[0].pairs.length,
  6,
);

// ── СОДЕРЖИМОЕ В СОСЕДНЕМ ПОЛЕ ──────────────────────────────────────────────
// ⚠️ Случай из жизни (29.08.2026): модель выдала 6 000 знаков, а документ вышел из одних
// заголовков — семь подряд, между ними пустота. В схеме и title, и text необязательны у
// любого блока, грамматика их не различает, и модель клала абзацы в title. Всё это молча
// выбрасывалось как «пустой блок». Терять текст нельзя ни при каком раскладе.
check(
  'абзац, положенный в title, не теряется',
  normalizeDoc({ blocks: [{ kind: 'text', title: 'Связный абзац про дело' }] })?.blocks,
  [{ kind: 'text', text: 'Связный абзац про дело' }],
);
check(
  'цитата, положенная в title, не теряется',
  normalizeDoc({ blocks: [{ kind: 'quote', title: 'Мысль на память' }] })?.blocks,
  [{ kind: 'quote', text: 'Мысль на память' }],
);
check(
  'заголовок, положенный в text, не теряется',
  normalizeDoc({ blocks: [{ kind: 'heading', text: 'Как выглядит атака' }] })?.blocks,
  [{ kind: 'heading', title: 'Как выглядит атака' }],
);
check(
  'обложка, положенная в text, не теряется',
  normalizeDoc({ blocks: [{ kind: 'cover', text: 'Название документа' }] })?.blocks,
  [{ kind: 'cover', title: 'Название документа' }],
);
check(
  'правильно заполненный блок не трогаем',
  normalizeDoc({ blocks: [{ kind: 'text', title: 'Подпись', text: 'Абзац' }] })?.blocks,
  [{ kind: 'text', title: 'Подпись', text: 'Абзац' }],
);
// Обратный перекос: целый абзац в heading ломает и вёрстку, и оглавление.
check(
  'длинный «заголовок» становится абзацем',
  normalizeDoc({ blocks: [{ kind: 'heading', title: 'а'.repeat(HEADING_MAX_CHARS + 1) }] })?.blocks[0].kind,
  'text',
);
check(
  'настоящий заголовок раздела остаётся заголовком',
  normalizeDoc({ blocks: [{ kind: 'heading', title: 'Как выглядит атака' }] })?.blocks[0].kind,
  'heading',
);

// ── заголовок документа ─────────────────────────────────────────────────────
check(
  'заголовок берётся из своего поля',
  normalizeDoc({ title: 'Своё имя', blocks: [{ kind: 'cover', title: 'С обложки' }] })?.title,
  'Своё имя',
);
check(
  'нет своего — берём с обложки: документ ещё выгружать файлом',
  normalizeDoc({ blocks: [{ kind: 'cover', title: 'С обложки' }] })?.title,
  'С обложки',
);
check(
  'нет ни того ни другого — запасное имя, а не пустота',
  normalizeDoc({ blocks: [{ kind: 'text', text: 'Абзац' }] })?.title,
  'Документ',
);

// ── каталог закрыт ──────────────────────────────────────────────────────────
check('каталог блоков не разросся', DOC_BLOCKS.length, 9);

// ── ЗАМОК ФАЗОВОЙ СБОРКИ ────────────────────────────────────────────────────
// ⚠️ Проверяется по тексту, а не прогоном: модуль тянет electron. Зато проверяется самое ценное,
// что в нём есть, — ФОРМА ЗАПРОСА на фазе наполнения.
//
// Схема раздела обязана оставаться МАССИВОМ СТРОК с minItems. Именно это делает «план вместо
// документа» физически недостижимым: в массив строк нельзя положить структуру, только прозу.
// Стоит кому-нибудь «обобщить» её обратно до объекта с необязательными полями — и вернётся тот
// самый баг, ради которого затевались фазы: обложка и семь пустых заголовков подряд.
const doc = fs.readFileSync('electron/NotebookDocument.ts', 'utf8');
const section = (doc.match(/const SECTION_SCHEMA = [\s\S]*?as const;/) || [''])[0];
check('фазы: у раздела схема — массив', /type: 'array'/.test(section), true);
check('фазы: элементы раздела — строки', /items: \{ type: 'string' \}/.test(section), true);
check('фазы: у раздела есть minItems', /minItems: [1-9]/.test(section), true);
check('фазы: в разделе нет вложенных объектов', /items:[\s\S]*type: 'object'/.test(section), false);

// План и наполнение — РАЗНЫЕ прогоны. Один общий прогон и был причиной пустых разделов.
check('фазы: план отдельной схемой', /const PLAN_SCHEMA/.test(doc), true);
check('фазы: разделы пишутся по одному', /for \(let i = 0; i < sections\.length/.test(doc), true);
check('фазы: пустой раздел не ставится', /if \(paragraphs\.length === 0\) continue;/.test(doc), true);

// Источники — наши. Подвал документа единственное место, где выдуманный адрес выглядит фактом.
check('фазы: источники берутся из аргумента', /\.map\(\(s\) => \(\{ label: s\.title/.test(doc), true);

// Общая схема документа не должна вернуться.
check('общей схемы документа нет', /DOC_SCHEMA/.test(fs.readFileSync('shared/notebookDoc.ts', 'utf8')), false);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
