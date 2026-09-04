// Прогон списка моделей от провайдера (shared/modelList.ts) — без electron, обычным node.
//
// Три узла, каждый из которых стоит человеку ручного ввода имени модели вместо выпадашки.
//
// АДРЕС СПИСКА кончается по-разному у трёх форм запроса: у OpenAI-совместимого база уже содержит
// `/v1`, у Gemini — `/v1beta`, у Anthropic базой считается голый хост. Слепое `base + /v1/models`
// даёт `/v1/v1/models` ровно там, где человек дописал версию сам — а он её дописывает, потому что
// видел её в документации.
//
// РАЗБОР ОТВЕТА терпимый: за «совместимым» адресом стоит что угодно, и одна кривая запись не имеет
// права уронить весь список. Отдельно проверяется Gemini: там модель называется полным путём
// ресурса (`models/gemini-2.5-flash`), а рядом с рабочими лежат эмбеддинги, которые на первом же
// запросе ответят отказом — то есть выпадашка предлагала бы заведомо нерабочий выбор.
//
// ФИЛЬТР для автодополнения ставит совпадение с начала вперёд. У OpenRouter три сотни имён вида
// `openai/gpt-5`, и «gpt» подстрокой находит десяток чужих, где gpt стоит в середине.
//
// Запуск: node scripts/model-list-check.mjs
import { modelsUrl, parseModelList, filterModels, normalizeBase, looksLikeModelList } from '../shared/modelList.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

console.log('\n— нормализация базы —');
check('хвостовая косая снимается', normalizeBase('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
check('несколько косых тоже', normalizeBase('http://localhost:11434/v1///'), 'http://localhost:11434/v1');
check('пробелы по краям', normalizeBase('  https://api.openai.com/v1  '), 'https://api.openai.com/v1');
check('без косой не трогаем', normalizeBase('https://api.anthropic.com'), 'https://api.anthropic.com');

console.log('\n— адрес списка —');
check('совместимый: база уже с /v1',
  modelsUrl('https://api.openai.com/v1', 'openai-compatible'), 'https://api.openai.com/v1/models');
check('совместимый: локальный раннер',
  modelsUrl('http://localhost:11434/v1', 'openai-compatible'), 'http://localhost:11434/v1/models');
check('совместимый: хвостовая косая не удваивается',
  modelsUrl('http://localhost:1234/v1/', 'openai-compatible'), 'http://localhost:1234/v1/models');
check('anthropic: голый хост получает /v1',
  modelsUrl('https://api.anthropic.com', 'anthropic'), 'https://api.anthropic.com/v1/models');
check('anthropic: версия уже дописана человеком — не удваиваем',
  modelsUrl('https://api.anthropic.com/v1', 'anthropic'), 'https://api.anthropic.com/v1/models');
check('gemini: /v1beta уже в базе',
  modelsUrl('https://generativelanguage.googleapis.com/v1beta', 'gemini'),
  'https://generativelanguage.googleapis.com/v1beta/models');
check('встроенная модель списка не имеет', modelsUrl('', 'local'), null);
check('пустой адрес — некуда идти', modelsUrl('   ', 'openai-compatible'), null);

console.log('\n— разбор ответа: OpenAI-совместимый —');
const openai = { object: 'list', data: [{ id: 'gpt-5', object: 'model' }, { id: 'o3-mini' }] };
check('data[].id', parseModelList(openai, 'openai-compatible'), ['gpt-5', 'o3-mini']);
check('порядок алфавитный, а не как у провайдера',
  parseModelList({ data: [{ id: 'zephyr' }, { id: 'alpha' }] }, 'openai-compatible'), ['alpha', 'zephyr']);
check('дубликаты от шлюза склеиваются',
  parseModelList({ data: [{ id: 'gpt-5' }, { id: 'gpt-5' }] }, 'openai-compatible'), ['gpt-5']);
check('запись без id пропускается, остальные живут',
  parseModelList({ data: [{ id: 'gpt-5' }, { object: 'model' }, { id: 'o3' }] }, 'openai-compatible'),
  ['gpt-5', 'o3']);
check('id не строка — пропускаем',
  parseModelList({ data: [{ id: 42 }, { id: 'gpt-5' }] }, 'openai-compatible'), ['gpt-5']);
check('пустое имя не показываем',
  parseModelList({ data: [{ id: '   ' }, { id: 'gpt-5' }] }, 'openai-compatible'), ['gpt-5']);
check('имя длиннее предела — мусор, не модель',
  parseModelList({ data: [{ id: 'x'.repeat(201) }, { id: 'gpt-5' }] }, 'openai-compatible'), ['gpt-5']);
check('имя ровно на пределе проходит',
  parseModelList({ data: [{ id: 'y'.repeat(200) }] }, 'openai-compatible'), ['y'.repeat(200)]);

console.log('\n— разбор ответа: чужие и битые формы —');
check('data не массив', parseModelList({ data: 'gpt-5' }, 'openai-compatible'), []);
check('нет поля вовсе', parseModelList({ object: 'list' }, 'openai-compatible'), []);
check('null вместо ответа', parseModelList(null, 'openai-compatible'), []);
check('строка вместо ответа', parseModelList('gpt-5', 'openai-compatible'), []);
check('массив вместо объекта', parseModelList([{ id: 'gpt-5' }], 'openai-compatible'), []);
check('элемент не объект', parseModelList({ data: ['gpt-5', null, 7] }, 'openai-compatible'), []);

console.log('\n— разбор ответа: Anthropic —');
const anthropic = { data: [{ type: 'model', id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }], has_more: false };
check('форма та же, что у OpenAI', parseModelList(anthropic, 'anthropic'), ['claude-sonnet-5']);

console.log('\n— разбор ответа: Gemini —');
const gemini = {
  models: [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/aqa', supportedGenerationMethods: ['generateAnswer'] },
  ],
};
check('приставка models/ снимается, эмбеддинги отброшены',
  parseModelList(gemini, 'gemini'), ['gemini-2.5-flash']);
check('нет списка методов — верим, что умеет',
  parseModelList({ models: [{ name: 'models/gemini-3-pro' }] }, 'gemini'), ['gemini-3-pro']);
check('методы не массивом — тоже верим',
  parseModelList({ models: [{ name: 'models/gemini-3-pro', supportedGenerationMethods: 'generateContent' }] }, 'gemini'),
  ['gemini-3-pro']);
check('поле data у gemini не читается — форма другая',
  parseModelList({ data: [{ id: 'gemini-2.5-flash' }] }, 'gemini'), []);
check('name без приставки остаётся как есть',
  parseModelList({ models: [{ name: 'gemini-2.5-flash' }] }, 'gemini'), ['gemini-2.5-flash']);

console.log('\n— фильтр автодополнения —');
// ⚠️ Случай ИЗ ЖИЗНИ: свежая Ollama, ещё без единой скачанной модели, отвечает именно так —
// массива нет вовсе, вместо него null. Разбор обязан вернуть пустоту, а не упасть; и это законная
// находка «раннер запущен, моделей нет», а не молчание, поэтому форму ответа надо уметь опознать
// отдельно от его содержимого — иначе чужая служба на том же порту сойдёт за найденный раннер.
check('Ollama без моделей: data = null', parseModelList({ object: 'list', data: null }, 'openai-compatible'), []);
check('она же — это всё-таки список', looksLikeModelList({ object: 'list', data: null }), true);
check('пустой массив — тоже список', looksLikeModelList({ object: 'list', data: [] }), true);
check('форма Gemini опознаётся по своему полю', looksLikeModelList({ models: [] }), true);
check('чужая служба на том же порту — не список', looksLikeModelList({ status: 'ok', version: 3 }), false);
check('массив вместо объекта — не список', looksLikeModelList([{ id: 'gpt-5' }]), false);
check('строка — не список', looksLikeModelList('gpt-5'), false);
check('null — не список', looksLikeModelList(null), false);

const many = ['anthropic/claude-sonnet-5', 'deepseek/deepseek-chat', 'gpt-4o-mini', 'openai/gpt-5', 'x-ai/grok-4'];
check('пустой запрос — весь список', filterModels(many, ''), many);
check('пробелы — тоже весь список', filterModels(many, '   '), many);
check('совпадение после слэша идёт раньше середины',
  filterModels(['a/zzz-gpt', 'openai/gpt-5', 'gpt-4o-mini'], 'gpt'),
  ['openai/gpt-5', 'gpt-4o-mini', 'a/zzz-gpt']);
check('регистр не важен', filterModels(many, 'CLAUDE'), ['anthropic/claude-sonnet-5']);
check('поиск по вендору', filterModels(many, 'openai/'), ['openai/gpt-5']);
check('ничего не нашлось', filterModels(many, 'llama'), []);
check('исходный список не портится', many.length, 5);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
