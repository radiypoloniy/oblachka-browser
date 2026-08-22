// Свой виджет как ДАННЫЕ (shared/genSpec.ts) — без electron и без модели.
//
// Зачем: грамматика гарантирует ФОРМУ ответа, но не смысл. Шаг 0, цель 0, дата в прошлом,
// пустые строки и список из одной строки она пропустит — отсекать их обязан этот слой.
//   npm test -- gen-spec
import {
  validateGenSpec, isGenKind, genDataSchema, genKindSize, daysUntil, isFutureDate,
  parseGenRuntime, GEN_KINDS, GEN_TITLE_MAX, GEN_SPEC_VERSION, GEN_KIND_SCHEMA,
  GEN_SOURCES, isGenSource, genSourceLabel,
} from '../shared/genSpec.ts';

let passed = 0;
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  ✗ ${name}\n      получили ${JSON.stringify(got)}\n      ждали    ${JSON.stringify(want)}`); }
  else { passed++; console.log(`  ✓ ${name}`); }
};
const checkTrue = (name, got) => check(name, !!got, true);

const NOW = Date.parse('2026-08-22T09:00:00');

console.log('\n── каталог типов ──');
check('одиннадцать типов', GEN_KINDS.length, 11);
checkTrue('list в каталоге', isGenKind('list'));
checkTrue('выдуманный тип отвергнут', !isGenKind('snake'));

console.log('\n── список ──');
{
  const spec = validateGenSpec({
    kind: 'list',
    title: 'Слово дня',
    items: [
      { main: 'Sun', sub: 'Солнце' }, { main: 'Moon', sub: 'Луна' },
      { main: 'Rain', sub: 'Дождь' }, { main: 'Snow', sub: 'Снег' },
    ],
  }, NOW);
  check('собрался', spec?.kind, 'list');
  check('версия проставлена', spec?.v, GEN_SPEC_VERSION);
  check('четыре пары', spec?.items?.length, 4);
  // ⚠️ Три строки — это не «список», а случайность: клик по такой плитке почти всегда даёт
  // то же самое, и человек читает виджет как сломанный.
  check('трёх мало', validateGenSpec({ kind: 'list', title: 'x', items: [{ main: 'a' }, { main: 'b' }, { main: 'c' }] }, NOW), null);
  const dup = validateGenSpec({
    kind: 'list', title: 'x',
    items: [{ main: 'Sun' }, { main: 'sun' }, { main: 'Moon' }, { main: 'Rain' }, { main: 'Snow' }],
  }, NOW);
  check('повтор выкинут, счёт по уникальным', dup?.items?.length, 4);
}

console.log('\n── жребий ──');
{
  // ⚠️ Живой случай 22.08: «кубик с 6 гранями» уезжал в карточку слова и показывал «Дыши/Дыши».
  // Теперь у кубика свой тип, и двух граней уже достаточно (монетка).
  const dice = validateGenSpec({
    kind: 'dice', title: 'Что на ужин',
    items: [{ main: 'Паста' }, { main: 'Суп' }, { main: 'Плов' }],
  }, NOW);
  check('три грани — жребий', dice?.items?.length, 3);
  check('одной грани мало', validateGenSpec({ kind: 'dice', title: 'x', items: [{ main: 'Да' }] }, NOW), null);
}

console.log('\n── данные браузера, а не выдумка ──');
{
  // ⚠️ Живой случай 22.08: «список из истории последних посещённых сайтов» модель наполнила
  // выдумкой — «Счастье — внутри вас». И не могла иначе: про браузер она не знает ничего.
  // Теперь она выбирает ИСТОЧНИК, а данные подставляет хост в момент показа.
  const feed = validateGenSpec({ kind: 'feed', title: 'История', source: 'history', rows: 6 }, NOW);
  check('источник сохранён', feed?.source, 'history');
  check('число строк зажато в разумное', validateGenSpec({ kind: 'feed', title: 'x', source: 'history', rows: 99 }, NOW)?.rows, 12);
  check('без источника ленты не бывает', validateGenSpec({ kind: 'feed', title: 'x' }, NOW), null);
  check('выдуманный источник отвергнут', validateGenSpec({ kind: 'feed', title: 'x', source: 'weather' }, NOW), null);
  // ⚠️ Источник обязан УМЕТЬ нужную форму: срезанные трекеры — число, лентой они не бывают.
  check('трекеры лентой не показать', validateGenSpec({ kind: 'feed', title: 'x', source: 'blocked' }, NOW), null);
  check('а числом — да', validateGenSpec({ kind: 'stat', title: 'x', source: 'blocked' }, NOW)?.source, 'blocked');
  check('история числом не показывается', validateGenSpec({ kind: 'stat', title: 'x', source: 'history' }, NOW), null);
  checkTrue('источники перечислены', GEN_SOURCES.length === 6 && isGenSource('tabs') && isGenSource('web'));
  check('у источника есть человеческое имя', genSourceLabel('topsites'), 'Частые сайты');
}

console.log('\n── по ссылке человека ──');
{
  // ⚠️ Ссылку даёт ЧЕЛОВЕК. Модель адресов не знает и, если её попросить, выдумает
  // правдоподобный — ровно как выдумывала историю посещений.
  const feed = validateGenSpec({ kind: 'feed', title: 'Новости', source: 'web', url: 'https://example.com/rss', rows: 6 }, NOW);
  check('лента по ссылке собирается', [feed?.source, feed?.url], ['web', 'https://example.com/rss']);
  check('без ссылки не собирается', validateGenSpec({ kind: 'feed', title: 'x', source: 'web' }, NOW), null);
  // ⚠️ Адрес судится ЗДЕСЬ, а не только в момент запроса: спека уходит на диск, и виджета
  // с адресом роутера не должно существовать вовсе.
  check('адрес роутера не спека', validateGenSpec({ kind: 'feed', title: 'x', source: 'web', url: 'https://192.168.1.1/rss' }, NOW), null);
  check('http не спека', validateGenSpec({ kind: 'feed', title: 'x', source: 'web', url: 'http://example.com/rss' }, NOW), null);

  const stat = validateGenSpec({ kind: 'stat', title: 'Курс', source: 'web', url: 'https://api.example/v1', path: 'rates.USD.value', unit: '₽' }, NOW);
  check('число по ссылке собирается', [stat?.path, stat?.unit], ['rates.USD.value', '₽']);
  // Число без пути в ответе взять неоткуда — это провал, а не «плитка с прочерком».
  check('число без пути не собирается', validateGenSpec({ kind: 'stat', title: 'x', source: 'web', url: 'https://api.example/v1' }, NOW), null);
  // ⚠️ 'web' не предлагается модели в схеме: иначе она начнёт выдумывать адреса.
  checkTrue('в схеме модели источника web нет',
    !JSON.stringify(genDataSchema('feed')).includes('"web"') && !JSON.stringify(genDataSchema('stat')).includes('"web"'));
}

console.log('\n── часовые пояса ──');
{
  // ⚠️ Живой вопрос 22.08: «выйдет ли виджет из сайта-конвертера поясов». Из сайта не выйдет —
  // там нет ни фида, ни JSON. А виджет выйдет: перевод времени это не чужие данные, а
  // вычисление, и все 400+ поясов лежат в ICU прямо в браузере.
  const z = validateGenSpec({
    kind: 'zones', title: 'Время',
    items: [{ main: 'America/New_York', sub: 'Нью-Йорк' }, { main: 'Europe/Moscow', sub: 'Москва' }],
  }, NOW);
  check('два пояса', z?.items?.length, 2);
  check('выдуманный пояс выкинут',
    validateGenSpec({ kind: 'zones', title: 'x', items: [{ main: 'Europe/Moscow' }, { main: 'Mars/Olympus' }] }, NOW)?.items?.length, 1);
  check('ни одного настоящего — не виджет',
    validateGenSpec({ kind: 'zones', title: 'x', items: [{ main: 'EDT' }, { main: 'МСК' }] }, NOW), null);
  check('больше четырёх не показываем', validateGenSpec({
    kind: 'zones', title: 'x',
    items: ['Europe/Moscow', 'Asia/Tokyo', 'America/New_York', 'Europe/Berlin', 'Asia/Dubai'].map((m) => ({ main: m })),
  }, NOW)?.items?.length, 4);
}

console.log('\n── жребий числом ──');
{
  // ⚠️ Живой случай 22.08: «игральный кубик, показывать случайное число при клике» дал грани
  // «Карты», «Шашки», «Бросай!» — в схеме были только строки, и модели оставалось выдумывать.
  const d6 = validateGenSpec({ kind: 'dice', title: 'Кубик', from: 1, to: 6 }, NOW);
  check('диапазон сохранён', [d6?.from, d6?.to], [1, 6]);
  check('строк при этом нет', d6?.items, undefined);
  // ⚠️ Без явного mode приоритет у СЛОВ, и это осознанная смена правила. Раньше побеждали
  // числа — и «орёл и решка» превращались в 1 и 2. Числа теперь выигрывают только тогда, когда
  // модель прямо сказала «numbers» (случай ниже) или когда слов просто нет.
  const both = validateGenSpec({ kind: 'dice', title: 'x', from: 1, to: 6, items: [{ main: 'Карты' }, { main: 'Шашки' }] }, NOW);
  check('без явного выбора слова сильнее', both?.items?.length, 2);
  check('и диапазон при этом не хранится', [both?.from, both?.to], [undefined, undefined]);
  check('перевёрнутый диапазон не диапазон', validateGenSpec({ kind: 'dice', title: 'x', from: 6, to: 1 }, NOW), null);

  // ⚠️ Живой случай 22.08: «орёл и решка» выходили числами 1 и 2. Модель заполняла ОБЕ формы,
  // а какая победит, решал код — то есть выбор делал не тот, кто читал фразу. Теперь выбор
  // явный, а запасной путь есть у обеих веток.
  const coin = validateGenSpec({
    kind: 'dice', title: 'Монетка', mode: 'faces',
    items: [{ main: 'Орёл' }, { main: 'Решка' }], from: 1, to: 2,
  }, NOW);
  check('монетка остаётся словами', coin?.items?.map((x) => x.main), ['Орёл', 'Решка']);
  check('и чисел у неё нет', [coin?.from, coin?.to], [undefined, undefined]);
  const die = validateGenSpec({
    kind: 'dice', title: 'Кубик', mode: 'numbers', from: 1, to: 6,
    items: [{ main: 'Карты' }, { main: 'Шашки' }],
  }, NOW);
  check('кубик остаётся числами', [die?.from, die?.to, die?.items], [1, 6, undefined]);
  check('выбрала числа, а диапазона нет — берём грани',
    validateGenSpec({ kind: 'dice', title: 'x', mode: 'numbers', items: [{ main: 'Да' }, { main: 'Нет' }] }, NOW)?.items?.length, 2);
  check('выбрала грани, а списка нет — берём числа',
    validateGenSpec({ kind: 'dice', title: 'x', mode: 'faces', from: 1, to: 6 }, NOW)?.to, 6);
  check('диапазон в миллион отвергнут', validateGenSpec({ kind: 'dice', title: 'x', from: 1, to: 999999 }, NOW), null);
}

console.log('\n── счётчик ──');
{
  const c = validateGenSpec({ kind: 'counter', title: 'Отжимания', unit: 'раз', step: 5, start: 0 }, NOW);
  check('шаг сохранён', c?.step, 5);
  check('единица сохранена', c?.unit, 'раз');
  // ⚠️ Шаг 0 грамматика пропустит (это целое число), а виджет с ним мёртв: кнопки не меняют ничего.
  check('нулевой шаг заменён на единицу', validateGenSpec({ kind: 'counter', title: 'x', step: 0 }, NOW)?.step, 1);
  check('дикий шаг зажат', validateGenSpec({ kind: 'counter', title: 'x', step: 99999 }, NOW)?.step, 1000);
}

console.log('\n── цель ──');
{
  const g = validateGenSpec({ kind: 'goal', title: 'Книга', unit: 'страниц', target: 300, start: 120 }, NOW);
  check('цель и начало', [g?.target, g?.start], [300, 120]);
  check('цели без величины не бывает', validateGenSpec({ kind: 'goal', title: 'x', target: 0 }, NOW), null);
  check('начало выше цели зажато', validateGenSpec({ kind: 'goal', title: 'x', target: 10, start: 99 }, NOW)?.start, 10);
}

console.log('\n── отсчёт до даты ──');
{
  checkTrue('будущая дата годится', isFutureDate('2026-09-01', NOW));
  checkTrue('прошедшая — нет', !isFutureDate('2020-01-01', NOW));
  // ⚠️ Отсчёт до прошлого молча не «чиним»: это не опечатка, а непонятый запрос.
  check('виджет с прошедшей датой не собирается', validateGenSpec({ kind: 'countdown', title: 'x', date: '2020-01-01' }, NOW), null);
  const cd = validateGenSpec({ kind: 'countdown', title: 'Отпуск', date: '2026-09-01' }, NOW);
  check('дата сохранена', cd?.date, '2026-09-01');
  check('дней до неё', daysUntil('2026-09-01', NOW), 10);
  check('сегодня — ноль', daysUntil('2026-08-22', NOW), 0);
}

console.log('\n── таймер и заметка ──');
check('секунды зажаты снизу', validateGenSpec({ kind: 'timer', title: 'x', seconds: 1 }, NOW)?.seconds, 10);
check('помодоро по умолчанию', validateGenSpec({ kind: 'timer', title: 'x' }, NOW)?.seconds, 1500);
check('пустая заметка не виджет', validateGenSpec({ kind: 'note', title: 'x', text: ' ' }, NOW), null);
check('заметка живёт', validateGenSpec({ kind: 'note', title: 'x', text: 'Позвонить маме' }, NOW)?.text, 'Позвонить маме');

console.log('\n── мусор на входе ──');
check('null', validateGenSpec(null, NOW), null);
check('строка', validateGenSpec('list', NOW), null);
check('неизвестный тип', validateGenSpec({ kind: 'snake', title: 'Змейка' }, NOW), null);
check('пустой заголовок заменён понятным',
  validateGenSpec({ kind: 'timer', title: '', seconds: 60 }, NOW)?.title, 'Таймер');
check('длинный заголовок обрезан',
  validateGenSpec({ kind: 'timer', title: 'а'.repeat(90), seconds: 60 }, NOW)?.title.length, GEN_TITLE_MAX);
check('кавычки вокруг заголовка сняты',
  validateGenSpec({ kind: 'timer', title: '«Помидор»', seconds: 60 }, NOW)?.title, 'Помидор');

console.log('\n── схема под грамматику ──');
{
  for (const kind of GEN_KINDS) {
    const schema = genDataSchema(kind);
    checkTrue(`${kind}: схема — объект со свойствами`,
      schema && schema.type === 'object' && !!schema.properties);
  }
  const list = genDataSchema('list');
  check('у списка ограничена длина', [list.properties.items.minItems, list.properties.items.maxItems], [6, 16]);
}

console.log('\n── размер под тип ──');
check('цитате нужна широкая плитка', genKindSize('list'), { w: 4, h: 2 });
check('счётчику хватает квадрата', genKindSize('counter'), { w: 2, h: 2 });

console.log('\n── накликанное состояние ──');
check('пусто', parseGenRuntime(''), {});
check('битый json', parseGenRuntime('{'), {});
check('значение счётчика', parseGenRuntime('{"value":12}'), { value: 12 });
check('отметки чек-листа', parseGenRuntime('{"done":[0,2]}'), { done: [0, 2] });
check('мусор в отметках отфильтрован', parseGenRuntime('{"done":[0,"x",-1,999]}'), { done: [0] });

console.log('\n── схемы компилируются в грамматику ──');
{
  // ⚠️ Схема, которую node-llama-cpp не умеет превратить в GBNF, роняет сборку виджета целиком
  // и уже у человека: до этого места ошибку не видно ни типам, ни глазу. Конвертер — чистая
  // функция, модель и видеопамять для неё не нужны, поэтому проверяем здесь.
  // Импорт по глубокому пути: если библиотека переедет, проверка честно скажет «пропущено»,
  // а не развалит весь прогон.
  let toGbnf = null;
  try {
    ({ getGbnfGrammarForGbnfJsonSchema: toGbnf } =
      await import('../node_modules/node-llama-cpp/dist/utils/gbnfJson/getGbnfGrammarForGbnfJsonSchema.js'));
  } catch {
    console.log('  ~ пропущено: конвертер node-llama-cpp не найден по ожидаемому пути');
  }
  if (toGbnf) {
    checkTrue('схема типа компилируется', typeof toGbnf(GEN_KIND_SCHEMA) === 'string');
    checkTrue('и перечисление типов попало в грамматику', /list|dice|counter/.test(toGbnf(GEN_KIND_SCHEMA)));
    for (const kind of GEN_KINDS) {
      let ok = false;
      try { ok = typeof toGbnf(genDataSchema(kind)) === 'string'; } catch { ok = false; }
      checkTrue(`схема данных «${kind}» компилируется`, ok);
    }
  }
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
