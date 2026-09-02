// Прогон моста «наша схема ↔ чужой провайдер» (shared/aiSchema.ts) — без electron, обычным node.
//
// ⚠️ Главный случай здесь один, и он же главная причина, по которой модуль вообще существует:
// СТРОГИЕ РЕЖИМЫ ОБЛАКА ТЕРЯЮТ ГРАНИЦЫ. `json_schema strict` у OpenAI не принимает maxLength и
// minItems — их приходится снимать, иначе запрос отвергнут целиком. Форму провайдер после этого
// держит, а «не длиннее 24 символов» и «от 6 до 16 элементов» — нет. У нас на этих числах стоит
// вёрстка: список на сорок элементов разъедет плитку стола ровно так же, как разъехал бы битый
// JSON. Поэтому проверка идёт по ИСХОДНОЙ схеме, а не по той, что ушла провайдеру, — и случаи ниже
// сторожат именно стык: диалект выбросил, валидатор поймал.
//
// ⚠️ Второй узел: у нас все перечисленные свойства ОБЯЗАТЕЛЬНЫ. `required` в схемах проекта не
// пишется нигде (см. shared/genSpec.ts), потому что грамматика llama.cpp иначе не умеет — поле не
// может не прийти. Диалект обязан выписать required явно, а валидатор — требовать того же: иначе
// облачный ответ с пропущенным полем прошёл бы там, где локальный был физически невозможен.
//
// Запуск: npm run ai-schema-check
import { toDialect, validateAgainst, describeSchema, extractJson } from '../shared/aiSchema.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

// Схемы срисованы с боевых: GEN_KIND_SCHEMA и genDataSchema('list') из shared/genSpec.ts.
const KIND = {
  type: 'object',
  properties: {
    kind: { enum: ['list', 'dice', 'timer'] },
    title: { type: 'string', maxLength: 24 },
  },
};

const ITEM = { type: 'object', properties: { main: { type: 'string', maxLength: 40 }, sub: { type: 'string', maxLength: 60 } } };
const DATA = { type: 'object', properties: { items: { type: 'array', items: ITEM, minItems: 6, maxItems: 16 } } };

console.log('\n— перевод в диалект OpenAI (strict) —');
check('enum без типа получает тип, границы сняты, все поля обязательны',
  toDialect(KIND, 'openai'),
  {
    type: 'object',
    properties: { kind: { enum: ['list', 'dice', 'timer'], type: 'string' }, title: { type: 'string' } },
    required: ['kind', 'title'],
    additionalProperties: false,
  });
check('вложенный массив: размеры сняты, элемент переведён рекурсивно',
  toDialect(DATA, 'openai'),
  {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { main: { type: 'string' }, sub: { type: 'string' } },
          required: ['main', 'sub'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  });

console.log('\n— перевод в диалект Gemini (OpenAPI-подмножество) —');
check('размеры массива живут, длина строки — нет, additionalProperties не появляется',
  toDialect(DATA, 'gemini'),
  {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        minItems: 6,
        maxItems: 16,
        items: { type: 'object', properties: { main: { type: 'string' }, sub: { type: 'string' } }, required: ['main', 'sub'] },
      },
    },
    required: ['items'],
  });

console.log('\n— перевод в диалект Anthropic (обычная JSON Schema) —');
check('здесь не теряется ничего',
  toDialect(KIND, 'anthropic'),
  {
    type: 'object',
    properties: { kind: { enum: ['list', 'dice', 'timer'], type: 'string' }, title: { type: 'string', maxLength: 24 } },
    required: ['kind', 'title'],
    additionalProperties: false,
  });

console.log('\n— то, что диалект выбросил, ловит валидатор —');
check('длина строки: 24 можно', validateAgainst(KIND, { kind: 'list', title: 'а'.repeat(24) }), []);
check('длина строки: 25 нельзя',
  validateAgainst(KIND, { kind: 'list', title: 'а'.repeat(25) }),
  ['title: длина 25, максимум 24']);
check('элементов меньше нижней границы',
  validateAgainst(DATA, { items: Array(5).fill({ main: 'a', sub: 'b' }) }),
  ['items: элементов 5, нужно не меньше 6']);
check('элементов больше верхней границы',
  validateAgainst(DATA, { items: Array(17).fill({ main: 'a', sub: 'b' }) }),
  ['items: элементов 17, нужно не больше 16']);
check('ровно на границах — молчит',
  [validateAgainst(DATA, { items: Array(6).fill({ main: 'a', sub: 'b' }) }).length,
   validateAgainst(DATA, { items: Array(16).fill({ main: 'a', sub: 'b' }) }).length],
  [0, 0]);

console.log('\n— обязательность полей —');
check('пропущенное поле — ошибка', validateAgainst(KIND, { kind: 'list' }), ['ответ: нет обязательного поля "title"']);
check('лишнее поле не мешает', validateAgainst(KIND, { kind: 'list', title: 'ок', extra: 1 }), []);
check('пропуск во ВЛОЖЕННОМ объекте виден с путём',
  validateAgainst(DATA, { items: Array(6).fill({ main: 'a' }) }).slice(0, 1),
  ['items[0]: нет обязательного поля "sub"']);

console.log('\n— типы и перечисления —');
check('значение вне enum', validateAgainst(KIND, { kind: 'снежинка', title: 'т' }),
  ['kind: ожидалось одно из "list", "dice", "timer", пришло "снежинка"']);
check('строка вместо объекта', validateAgainst(KIND, 'привет'), ['ответ: ожидался объект, пришло "привет"']);
check('объект вместо массива', validateAgainst(DATA, { items: { main: 'a' } }),
  ['items: ожидался массив, пришло {"main":"a"}']);
check('число вместо строки', validateAgainst(KIND, { kind: 'list', title: 7 }), ['title: ожидалась строка, пришло 7']);
check('целое', validateAgainst({ type: 'integer' }, 2.5), ['ответ: ожидалось целое, пришло 2.5']);
check('целое настоящее проходит', validateAgainst({ type: 'integer' }, 3), []);
check('дробное там, где просто число, — норма', validateAgainst({ type: 'number' }, 2.5), []);
// ⚠️ NaN приходит из JSON.parse не может, зато приходит от разбора текстового ответа в режиме
// `none`. Число, которым нельзя пользоваться, — это не число.
check('NaN числом не считается', validateAgainst({ type: 'number' }, NaN), ['ответ: ожидалось число, пришло null']);
check('да/нет', validateAgainst({ type: 'boolean' }, 'да'), ['ответ: ожидалось да/нет, пришло "да"']);
check('настоящее да/нет проходит', validateAgainst({ type: 'boolean' }, false), []);
check('минимальная длина', validateAgainst({ type: 'string', minLength: 3 }, 'ок'), ['ответ: длина 2, минимум 3']);
// ⚠️ Схема с полями, но без слова «object»: грамматика такую понимает, значит и валидатор обязан —
// иначе объект проехал бы вообще без проверки полей.
check('объект узнаётся по наличию полей, а не по слову type',
  validateAgainst({ properties: { a: { type: 'string' } } }, {}),
  ['ответ: нет обязательного поля "a"']);
check('правильный ответ не даёт ни одной претензии', validateAgainst(KIND, { kind: 'dice', title: 'Жребий' }), []);

console.log('\n— схема словами: для подключений без структурного режима —');
check('перечисление читается как перечисление',
  describeSchema({ enum: ['list', 'dice'] }), 'одно из: "list", "dice"');
check('длина строки попадает в текст', describeSchema({ type: 'string', maxLength: 24 }), 'string не длиннее 24 символов');
check('размеры массива попадают в текст',
  describeSchema({ type: 'array', items: { type: 'string' }, minItems: 6, maxItems: 16 }),
  'массив (6–16 шт.), элемент — string');

console.log('\n— достать объект из текстового ответа —');
check('чистый JSON', extractJson('{"kind":"list"}'), { ok: true, value: { kind: 'list' } });
check('в заборе из ``` и с болтовнёй вокруг',
  extractJson('Конечно! ```json\n{"kind":"dice"}\n```\nГотово.'), { ok: true, value: { kind: 'dice' } });
check('вложенные скобки не обрезаются по первой закрывающей',
  extractJson('шум {"a":{"b":1}} хвост'), { ok: true, value: { a: { b: 1 } } });
check('объекта нет вовсе', extractJson('извините, не могу'), { ok: false, error: 'в ответе нет объекта JSON' });
check('битый JSON не чинится', extractJson('{"kind": }').ok, false);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
