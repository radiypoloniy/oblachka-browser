// Склейка скриптлетов адблока (shared/scriptletBundle.ts) — без electron, обычным node.
//
// ⚠️ Оба случая ниже — С ЖИВЫХ САЙТОВ, и оба уже стоили пользователю багов:
//   • chatgpt.com — два prevent-fetch на window.fetch; при РАЗДЕЛЬНЫХ копиях обвязки uBO они
//     зацикливаются друг в друге, SPA не открывается. Значит скоуп обязан быть общим.
//   • youtube.com/watch — 30 скриптлетов, из них четыре json-prune объявляют `class JSONPath`;
//     при общем скоупе это SyntaxError, и не выполняется НИ ОДНА строка пачки, то есть реклама
//     в видео не режется вовсе. Значит лексические объявления обязаны быть раздельными.
// Требования противоположные, поэтому проверка держит оба сразу.
//
// Запуск: npm test -- scriptlet
import { joinScriptlets } from '../shared/scriptletBundle.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

// Разбирается ли код тем же парсером V8, что и в рендерере.
const compiles = (code) => { try { new Function(code); return true; } catch { return false; } };
const errorOf = (code) => { try { new Function(code); return null; } catch (e) { return e.message; } };

// Форма настоящего скриптлета Ghostery: своя копия обвязки + собственный класс-помощник.
const scriptlet = (klass, body = '') => `
if (typeof scriptletGlobals === 'undefined') { var scriptletGlobals = {}; }
function safeSelf() { return globalThis; }
class ${klass} { constructor() { this.ok = true; } }
${body}
`;

console.log('\n— YouTube: одинаковые классы в разных скриптлетах —');
{
  // Ровно случай четырёх json-prune с общим `class JSONPath`.
  const four = [scriptlet('JSONPath'), scriptlet('JSONPath'), scriptlet('JSONPath'), scriptlet('JSONPath')];
  check('наивная склейка через ;  НЕ разбирается (так и было сломано)', compiles(four.join('\n;\n')), false);
  check('склейка по блокам разбирается', compiles(joinScriptlets(four)), true);
  check('и ошибки нет', errorOf(joinScriptlets(four)), null);
}
{
  const many = Array.from({ length: 30 }, (_, i) => scriptlet('JSONPath', `var mark${i} = ${i};`));
  check('тридцать скриптлетов, как на youtube.com/watch', compiles(joinScriptlets(many)), true);
}

console.log('\n— ChatGPT: обвязка обязана остаться ОДНА на всех —');
{
  // scriptletGlobals объявлен через var — обязан всплыть из блока и стать общим, иначе каждый
  // prevent-fetch заведёт свою копию обвязки, и они зациклятся друг в друге.
  const two = [scriptlet('AFirst', 'scriptletGlobals.seen = (scriptletGlobals.seen || 0) + 1;'),
    scriptlet('ASecond', 'scriptletGlobals.seen = (scriptletGlobals.seen || 0) + 1;')];
  const run = new Function(`${joinScriptlets(two)}\n;\nreturn scriptletGlobals.seen;`);
  check('scriptletGlobals общий на оба скриптлета', run(), 2);
}
{
  const two = [scriptlet('AFirst'), scriptlet('ASecond')];
  const run = new Function(`${joinScriptlets(two)}\n;\nreturn typeof safeSelf;`);
  check('объявления функций тоже видны снаружи блока', run(), 'function');
}

console.log('\n— мелочи —');
{
  check('пустой список даёт пустую строку', joinScriptlets([]), '');
  check('один скриптлет тоже оборачивается', compiles(joinScriptlets([scriptlet('Solo')])), true);
  // Скриптлет, кончающийся строчным комментарием: без перевода строки перед } закрылся бы блок
  // внутри комментария и всё развалилось бы.
  check('строчный комментарий в конце не съедает закрывающую скобку',
    compiles(joinScriptlets(['var a = 1; // хвостовой комментарий'])), true);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
