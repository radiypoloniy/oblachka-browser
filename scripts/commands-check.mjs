// Сторож слоя команд: границы прав и разбор фразы в омнибоксе (shared/commands.ts).
//
// ⚠️ Две вещи здесь несущие, и обе — про то, что нельзя проверить глазами.
// Первая: validateCommand это ГРАНИЦА ДОВЕРИЯ. Через неё проходит всё, что придёт от модели и с
// диска, и «модель придумала своё действие» не должно становиться правами команды.
// Вторая: разбор фразы решает, перехватывать ли Enter в АДРЕСНОЙ СТРОКЕ. Цена ошибки тут —
// «браузер не открыл сайт», худшее, что может случиться с браузером, поэтому у адресоподобного
// ввода команд не должно быть вовсе.
//
// Запуск: npm run commands-check (или npm test -- command)
import {
  validateCommand, resolveCommands, describeNeeds, looksLikeQuestion, MATCH_FIRST,
  BUILTIN_COMMANDS, CONTEXT_KEYS, TOOL_IDS,
} from '../shared/commands.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const cmd = (over = {}) => validateCommand({
  id: 'x', name: 'Разобрать вкладки', phrase: 'разбери вкладки',
  prompt: 'p', needs: ['tabs'], tools: [], doors: ['omnibox'], ...over,
});

console.log('— граница доверия —');
check('выдуманное право видеть отбрасывается',
  cmd({ needs: ['tabs', 'банковские карты'] }).needs, ['tabs']);
check('выдуманный инструмент отбрасывается',
  cmd({ tools: ['tabs.close', 'payments.send'] }).tools, ['tabs.close']);
check('выдуманная дверь отбрасывается, команда остаётся',
  cmd({ doors: ['omnibox', 'телепатия'] }).doors, ['omnibox']);
// ⚠️ Команда без единой двери недостижима: это мусор на диске, а не настройка.
check('команда без дверей — не команда', cmd({ doors: [] }), null);
check('команда без промпта — не команда', cmd({ prompt: '   ' }), null);
check('чужой объект — не команда', validateCommand({ hello: 'world' }), null);
check('строка с диска — не команда', validateCommand('делай хорошо'), null);

console.log('\n— встроенные команды —');
// ⚠️ Стартовый набор обязан быть ОТВЕТАМИ: инструмент без карточки предпросмотра и отката — это
// уже агент, а он появляется только на третьем этапе.
const withTools = BUILTIN_COMMANDS.filter((c) => c.tools.length > 0).map((c) => c.id);
check('ни одна встроенная не имеет инструментов', withTools, []);
const badNeeds = BUILTIN_COMMANDS.flatMap((c) => c.needs.filter((k) => !CONTEXT_KEYS.includes(k)));
check('права встроенных — из каталога', badNeeds, []);
const badTools = BUILTIN_COMMANDS.flatMap((c) => c.tools.filter((t) => !TOOL_IDS.includes(t)));
check('инструменты встроенных — из каталога', badTools, []);
check('все встроенные проходят валидацию',
  BUILTIN_COMMANDS.filter((c) => validateCommand({ ...c, createdAt: 1, lastRunAt: 0, runs: 0 }) === null).length, 0);

console.log('\n— разбор фразы в омнибоксе —');
const list = BUILTIN_COMMANDS.map((c) => validateCommand({ ...c, createdAt: 1, lastRunAt: 0, runs: 0 }));

const top = (q, mode = 'always') => {
  const m = resolveCommands(q, list, mode);
  return m.length ? m[0].id : null;
};
const first = (q, mode = 'always') => {
  const m = resolveCommands(q, list, mode);
  return m.length > 0 && m[0].score >= MATCH_FIRST;
};

check('фраза находит свою команду', top('дайджест открытого'), 'tabs.digest');
check('часть имени тоже находит', top('что тут'), 'page.gist');
check('чужая фраза не находит ничего', resolveCommands('погода в сочи', list, 'always'), []);

// ⚠️ Самое важное правило файла: адрес остаётся адресом.
check('домен командой не перехватывается', resolveCommands('music.yandex.ru', list, 'always'), []);
check('домен с путём — тоже', resolveCommands('github.com/oblako', list, 'always'), []);
check('localhost — тоже', resolveCommands('localhost:5173', list, 'always'), []);
check('пустой ввод ничего не предлагает', resolveCommands('   ', list, 'always'), []);

check('уверенное совпадение встаёт первым', first('дайджест открытого'), true);
// Одно слово из двух — команда видна, но Enter у неё не отбирает.
check('слабое совпадение первым не встаёт', first('открытого письма'), false);

console.log('\n— состояния двери —');
check('off глушит дверь целиком', resolveCommands('дайджест открытого', list, 'off'), []);
check('slash без префикса молчит', resolveCommands('дайджест открытого', list, 'slash'), []);
check('slash с префиксом работает', top('/дайджест открытого', 'slash'), 'tabs.digest');
// ⚠️ В режиме префикса адресоподобное после / — это осознанный ввод команды, а не адрес.
check('slash не считает ввод адресом', resolveCommands('/что', list, 'slash').length > 0, true);

console.log('\n— слэш показывает список —');
// ⚠️ Без этого команды невозможно НАЙТИ: человеку пришлось бы угадывать фразу вызова, а он не
// станет — просто не будет ими пользоваться. Так же устроены навыки в Dia: слэш показывает, что
// вообще есть.
check('пустой «/» показывает список', resolveCommands('/', list, 'always').length > 0, true);
check('«/» с началом имени фильтрует', top('/дайджест'), 'tabs.digest');
check('«/» работает и в режиме always', top('/что тут'), 'page.gist');
check('по «/» команда всегда первая', first('/что тут'), true);
check('«/» выключенную дверь не открывает', resolveCommands('/', list, 'off'), []);

console.log('\n— свободный вопрос —');
check('вопросительный знак — вопрос', looksLikeQuestion('это вообще безопасно?'), true);
check('вопросительное слово — вопрос', looksLikeQuestion('почему это так дорого'), true);
// ⚠️ Главный отрицательный случай: обычный поисковый запрос вопросом НЕ становится, иначе строка
// «купить билеты москва сочи» уходила бы к модели вместо поиска.
check('запрос остаётся запросом', looksLikeQuestion('купить билеты москва сочи'), false);
check('адрес вопросом не становится', looksLikeQuestion('music.yandex.ru'), false);
check('одно слово — не вопрос', looksLikeQuestion('что'), false);

console.log('\n— подписи прав —');
check('подпись перечисляет то, что команда увидит',
  describeNeeds(list.find((c) => c.id === 'tabs.digest')), 'увидит: открытые вкладки');
check('команда без контекста говорит об этом прямо',
  describeNeeds(cmd({ needs: [] })), 'ничего не читает');

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
