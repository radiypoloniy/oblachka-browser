// Готовые сценарии, которые браузер предлагает агенту (shared/mcpPrompts.ts).
//
// ⚠️ Проверяется не «красиво ли написано», а два свойства, каждое из которых уже стоило дня.
//
// ПЕРВОЕ: сценарий ОБЯЗАН НАЗЫВАТЬ ИНСТРУМЕНТЫ ПОИМЁННО и теми же именами, что в каталоге. Живой
// случай 04.09.2026: имена разошлись на один символ, агент не нашёл инструмент и молча ушёл делать
// работу своими средствами — человек при этом решил, что браузер сломан. Текст, зовущий
// несуществующий инструмент, даёт ровно тот же исход.
//
// ВТОРОЕ: обязательный аргумент обязан ТРЕБОВАТЬСЯ. Промпт без темы поиска — это «найди у меня
// про undefined», и модель честно пойдёт искать пустоту.
//
// Запуск: node scripts/mcp-prompts-check.mjs
import { MCP_PROMPTS, findPrompt, missingArgs, promptArgs } from '../shared/mcpPrompts.ts';
import { MCP_TOOLS } from '../shared/mcpPolicy.ts';

let passed = 0;
let failed = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ok   ${what}`); }
  else { failed++; console.log(` FAIL  ${what}\n         получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`); }
};

const NAMES = MCP_TOOLS.map((t) => t.name);

console.log('\n— каталог сценариев —');
check('состав', MCP_PROMPTS.map((p) => p.name),
  ['review_tabs', 'walk_page', 'explain_screen', 'find_saved']);
// ⚠️ Список команд, в котором двадцать строк, человек не читает — он ищет в нём глазами и не
// находит. Потолок держим намеренно.
check('их немного', MCP_PROMPTS.length <= 6, true);
check('имена через подчёркивание, как у инструментов',
  MCP_PROMPTS.every((p) => /^[a-z][a-z0-9_]*$/.test(p.name)), true);
check('у каждого есть человеческое название и описание',
  MCP_PROMPTS.every((p) => p.title.trim() && p.description.trim()), true);
check('незнакомый сценарий не находится', findPrompt('do_my_taxes'), null);

console.log('\n— сценарии зовут существующие инструменты —');
// ⚠️ Главная проверка файла: текст, называющий инструмент, которого нет, отправит агента делать
// работу своими средствами — а человек решит, что браузер не работает.
for (const p of MCP_PROMPTS) {
  const text = p.build({ topic: 'bergamot', focus: 'цены', question: 'что это' });
  const mentioned = [...text.matchAll(/\b(tabs|page|history|bookmarks)_[a-z_]+/g)].map((m) => m[0]);
  const unknown = [...new Set(mentioned)].filter((n) => !NAMES.includes(n));
  check(`${p.name}: все упомянутые инструменты есть в каталоге`, unknown, []);
  check(`${p.name}: хоть один инструмент назван`, mentioned.length > 0, true);
  check(`${p.name}: отвечать на языке человека сказано`, /user's language/.test(text), true);
}

console.log('\n— аргументы —');
const saved = findPrompt('find_saved');
check('тема поиска обязательна', missingArgs(saved, {}), ['topic']);
check('пробелы не считаются заполнением', missingArgs(saved, { topic: '   ' }), ['topic']);
check('заполненная тема проходит', missingArgs(saved, { topic: 'bergamot' }), []);
check('тема попадает в текст', saved.build({ topic: 'bergamot' }).includes('bergamot'), true);
// ⚠️ Необязательный аргумент не обязан быть: сценарий без него просто шире.
const walk = findPrompt('walk_page');
check('необязательный аргумент не требуется', missingArgs(walk, {}), []);
check('без него текст всё равно осмысленный', walk.build({}).includes('page_links'), true);
check('с ним — уточняет задачу', walk.build({ focus: 'цены' }).includes('цены'), true);

console.log('\n— аргументы приходят от клиента, то есть какими угодно —');
check('строки проходят', promptArgs({ topic: 'x' }), { topic: 'x' });
check('число становится строкой', promptArgs({ topic: 7 }), { topic: '7' });
check('объект отбрасывается', promptArgs({ topic: { a: 1 } }), {});
check('не объект — пусто', promptArgs('topic=x'), {});
check('null — пусто', promptArgs(null), {});

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
