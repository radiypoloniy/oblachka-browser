// Политика усыпления вкладок (shared/sleepPolicy.ts) — без electron, обычным node.
//
// ⚠️ Здесь проверяется не арифметика ради арифметики. Ошибка в любую сторону дорога и незаметна
// при чтении кода:
//   • слишком мягко — браузер не отдаёт память системе (замер против Яндекс.Браузера на одинаковых
//     20 сайтах: 5688 МБ Working Set против 4428 при почти равных Private Bytes);
//   • слишком жёстко — вкладки выгружаются по три в минуту при десятках свободных гигабайт. Это
//     УЖЕ случалось, живая жалоба «слишком сильно перекрутили выгрузку».
// Оба края закреплены ассертами ниже.
//
// Запуск: npm test -- sleep-policy
import {
  memoryBudgetBytes, systemFreeShare, isUnderMemoryPressure, isIdleForTimer, pressureCandidates,
  MEMORY_BUDGET_MIN, MEMORY_BUDGET_MAX, SYSTEM_FREE_MIN_SHARE,
  SLEEP_TIMEOUT_NORMAL, SLEEP_TIMEOUT_PINNED, PRESSURE_MIN_IDLE_NORMAL, PRESSURE_MIN_IDLE_PINNED,
} from '../shared/sleepPolicy.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const GB = 1024 * 1024 * 1024;
const MIN = 60 * 1000;

console.log('\n— бюджет памяти: доля, а не константа —');
{
  check('на 32 ГБ — пятая часть', memoryBudgetBytes(32 * GB), 6.4 * GB);
  // ⚠️ Обе границы несущие: без нижней слабая машина ушла бы в вечное усыпление, без верхней на
  // мощной станции критерий не сработал бы никогда.
  check('на 2 ГБ подпирается нижней границей', memoryBudgetBytes(2 * GB), MEMORY_BUDGET_MIN);
  check('на 128 ГБ подпирается верхней', memoryBudgetBytes(128 * GB), MEMORY_BUDGET_MAX);
  check('вырожденный ноль не ломает счёт', memoryBudgetBytes(0), MEMORY_BUDGET_MIN);
}

console.log('\n— давление: КОНЪЮНКЦИЯ, а не «или» —');
{
  const budget = 6.4 * GB;
  // Ровно та живая жалоба: мы над бюджетом, но в системе полно свободной памяти.
  check('над бюджетом, но системе просторно — НЕ усыпляем',
    isUnderMemoryPressure(8 * GB, budget, 0.5), false);
  check('системе тесно, но мы в бюджете — НЕ усыпляем',
    isUnderMemoryPressure(3 * GB, budget, 0.05), false);
  check('оба условия сразу — усыпляем',
    isUnderMemoryPressure(8 * GB, budget, 0.05), true);
  check('ровно на границе бюджета — ещё не давление',
    isUnderMemoryPressure(budget, budget, 0.05), false);
  check('ровно на пороге свободной памяти — ещё не давление',
    isUnderMemoryPressure(8 * GB, budget, SYSTEM_FREE_MIN_SHARE), false);
}
{
  check('доля свободной памяти считается', systemFreeShare(4 * GB, 16 * GB), 0.25);
  // Деление на ноль дало бы NaN, а NaN < порога — false, то есть «давления нет». Это правильный
  // исход, но получаться он должен явно, а не случайно.
  check('нулевая память системы — считаем, что место есть', systemFreeShare(0, 0), 1);
}

console.log('\n— первый критерий: часы —');
{
  check('обычная вкладка через час — рано', isIdleForTimer(60 * MIN, false), false);
  check('обычная через два часа — пора', isIdleForTimer(SLEEP_TIMEOUT_NORMAL, false), true);
  // ⚠️ Закреплённую держат открытой намеренно, ей срок вчетверо больше.
  check('закреплённая через два часа — рано', isIdleForTimer(SLEEP_TIMEOUT_NORMAL, true), false);
  check('закреплённая через восемь часов — пора', isIdleForTimer(SLEEP_TIMEOUT_PINNED, true), true);
}

console.log('\n— кого усыплять под давлением и в каком порядке —');
{
  const now = 10 * 60 * 60 * 1000;
  const t = (id, idleMs, pinned = false) => ({ id, lastActiveAt: now - idleMs, pinned });
  const order = pressureCandidates([
    t('свежая', 5 * MIN),
    t('закреп-давняя', 5 * 60 * MIN, true),
    t('давняя', 3 * 60 * MIN),
    t('средняя', 45 * MIN),
    t('закреп-свежая', 10 * MIN, true),
  ], now);
  check('незакреплённые раньше закреплённых, внутри — от давних к свежим',
    order.map((x) => x.id), ['давняя', 'средняя', 'закреп-давняя']);
}
{
  const now = 10 * 60 * 60 * 1000;
  // ⚠️ Пороги простоя подняты вшестеро после жалобы: пять минут — это «отошёл за кофе».
  const justLeft = [{ id: 'a', lastActiveAt: now - (PRESSURE_MIN_IDLE_NORMAL - 1), pinned: false }];
  check('вкладку, оставленную только что, не трогаем даже под давлением',
    pressureCandidates(justLeft, now).length, 0);
  const pinnedRecent = [{ id: 'p', lastActiveAt: now - (PRESSURE_MIN_IDLE_PINNED - 1), pinned: true }];
  check('и закреплённую тоже — у неё свой, больший порог',
    pressureCandidates(pinnedRecent, now).length, 0);
}
{
  check('пустой список — пустой результат', pressureCandidates([], Date.now()), []);
  // Исходный массив трогать нельзя: это снимок вкладок вызывающего.
  const src = [{ id: 'b', lastActiveAt: 0, pinned: true }, { id: 'a', lastActiveAt: 0, pinned: false }];
  const copy = JSON.stringify(src);
  pressureCandidates(src, Date.now());
  check('исходный список не переставляется на месте', JSON.stringify(src), copy);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
