// Прогон разбора документа Студии (shared/notebookDoc.ts) — без electron, обычным node.
//
// ⚠️ Проверяется не «валидный JSON» — его гарантирует грамматика на каждом токене. Проверяется
// то, чего грамматика НЕ гарантирует: наполнение. Модель вправе прислать блок правильной формы
// и совершенно пустой («kind»:"list" без единого пункта), и пустая рамка в документе выглядит
// поломкой, а не задумкой. Каждый случай ниже — про это.
//
// Запуск: npm test -- notebook-doc
import { normalizeDoc, DOC_BLOCKS } from '../shared/notebookDoc.ts';

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
check('list без пунктов не рисуется', normalizeDoc({ blocks: [{ kind: 'list' }] }), null);
check('text без текста не рисуется', normalizeDoc({ blocks: [{ kind: 'text', title: 'Только заголовок' }] }), null);
check('metrics без пар не рисуется', normalizeDoc({ blocks: [{ kind: 'metrics', title: 'Числа' }] }), null);
check('cover без заголовка не рисуется', normalizeDoc({ blocks: [{ kind: 'cover', text: 'подпись' }] }), null);
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
check(
  'блоков не больше двенадцати',
  normalizeDoc({ blocks: Array.from({ length: 20 }, (_, i) => ({ kind: 'text', text: `а${i}` })) })?.blocks.length,
  12,
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

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
