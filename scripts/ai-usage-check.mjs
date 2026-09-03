// Учёт расхода на подключениях: накопление, итог, человеческие числа.
//
// ⚠️ Проверяется машиной потому, что здесь легко соврать ТИХО. «$0,00» вместо «доли цента»
// выглядит как бесплатно; «0 запросов» на живом подключении — как поломка; ноль от бесплатной
// модели неотличим от «провайдер не сообщил цену», если считать по `cost > 0`.
import {
  emptyUsage, addUsage, sumUsage, totalTokens, formatTokens, formatCost,
} from '../shared/aiUsage.ts';

let passed = 0;
let failed = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ok   ${what}`); }
  else { failed++; console.log(` FAIL  ${what}\n         получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`); }
};

const T = 1_000;

console.log('\n— накопление —');
const one = addUsage(undefined, { promptTokens: 100, completionTokens: 40 }, T);
check('первый ответ заводит счёт', [one.requests, one.promptTokens, one.completionTokens, one.since], [1, 100, 40, T]);
const two = addUsage(one, { promptTokens: 10, completionTokens: 5 }, 9_999);
check('второй прибавляется', [two.requests, two.promptTokens, two.completionTokens], [2, 110, 45]);
check('начало счёта не сдвигается', two.since, T);

// ⚠️ Половина совместимых шлюзов не отдаёт usage вовсе — запрос обязан считаться всё равно,
// иначе живое подключение показывает «0 запросов» и это читается как поломка учёта.
const mute = addUsage(undefined, {}, T);
check('провайдер промолчал — запрос всё равно посчитан', [mute.requests, mute.promptTokens], [1, 0]);
check('и цена осталась неизвестной', mute.costKnown, false);

console.log('\n— деньги —');
const paid = addUsage(undefined, { cost: 0.0021 }, T);
check('цена принята', [paid.cost, paid.costKnown], [0.0021, true]);
// ⚠️ Ноль бывает НАСТОЯЩИМ: бесплатная модель стоит ровно ноль, и это не «неизвестно».
const free = addUsage(undefined, { cost: 0 }, T);
check('честный ноль — это известная цена', [free.cost, free.costKnown], [0, true]);
const mixed = addUsage(paid, {}, T);
check('молчание после известной цены не гасит признак', mixed.costKnown, true);
check('мусор вместо цены игнорируется', addUsage(undefined, { cost: NaN }, T).costKnown, false);
check('отрицательная цена не уменьшает счёт', addUsage(paid, { cost: -5 }, T).cost, 0.0021);
check('отрицательные токены игнорируются', addUsage(undefined, { promptTokens: -3 }, T).promptTokens, 0);
check('дробные токены округляются', addUsage(undefined, { promptTokens: 10.6 }, T).promptTokens, 11);

console.log('\n— итог по всем —');
const a = { requests: 2, promptTokens: 100, completionTokens: 10, cost: 0.5, costKnown: true, since: 500 };
const b = { requests: 3, promptTokens: 7, completionTokens: 3, cost: 0, costKnown: false, since: 900 };
const all = sumUsage([a, b]);
check('складываются', [all.requests, all.promptTokens, all.completionTokens, all.cost], [5, 107, 13, 0.5]);
check('цена известна, если её знает хоть один', all.costKnown, true);
check('считаем с самого раннего дня', all.since, 500);
check('пустой список — пустой счёт', sumUsage([]), emptyUsage(0));
check('всего токенов', totalTokens(a), 110);

console.log('\n— токены человеку —');
// ⚠️ До десяти тысяч показываем точно: на первых сотнях запросов человек сверяет число со счётом
// у провайдера, и «1,2 тыс.» вместо «1240» отнимает точность ровно там, где она ещё нужна.
check('сотни', formatTokens(940), '940');
// ⚠️ Разделитель разрядов — НЕРАЗРЫВНЫЙ пробел (U+00A0): обычный позволил бы числу
// переломиться пополам при переносе строки в узкой плитке.
check('тысячи точно', formatTokens(1240), '1 240');
check('на пороге', formatTokens(9999), '9 999');
check('десятки тысяч', formatTokens(12_340), '12,3 тыс.');
check('круглое без запятой', formatTokens(50_000), '50 тыс.');
check('миллионы', formatTokens(4_500_000), '4,5 млн');
check('ноль', formatTokens(0), '0');

console.log('\n— деньги человеку —');
// ⚠️ «$0,00» на живом счёте означало бы «бесплатно» — враньё в самом чувствительном месте.
check('доли цента', formatCost(0.0021), '$0,0021');
check('копейки', formatCost(0.234), '$0,234');
check('доллары', formatCost(12.5), '$12,50');
check('честный ноль', formatCost(0), '$0');

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
