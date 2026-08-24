// Прогон порядка и вытеснения записей буфера обмена (shared/clipboardOrder.ts) — обычным node.
//
// Оба правила здесь про ЗАКРЕПЛЁННОЕ, и оба ломаются ТИХО: список продолжает работать, просто
// закреплённая запись однажды оказывается не там, где её оставили, или исчезает совсем — то есть
// делает ровно то, от чего её закрепляли. Человек увидит не сбой, а «оно куда-то делось».
//
// Запуск: npm run clipboard-order-check
import { latestCopy, orderCopies, trimCopies } from '../shared/clipboardOrder.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

// Запись описываем минимально: правилам нужен id (чтобы отличать в проверке) и флаг.
const e = (id, pinned) => (pinned ? { id, pinned: true } : { id });
const ids = (list) => list.map((x) => x.id);

console.log('\n— порядок: закреплённое первым —');
check('закреплённое поднимается наверх',
  ids(orderCopies([e(1), e(2, true), e(3)])), [2, 1, 3]);
check('несколько закреплённых сохраняют свой порядок между собой',
  ids(orderCopies([e(1, true), e(2), e(3, true)])), [1, 3, 2]);
check('незакреплённые сохраняют порядок',
  ids(orderCopies([e(1), e(2), e(3)])), [1, 2, 3]);
check('всё закреплено — порядок не меняется',
  ids(orderCopies([e(1, true), e(2, true)])), [1, 2]);
check('пустой список', orderCopies([]), []);

console.log('\n— вытеснение: под предел, но не закреплённое —');
check('короткий список не трогаем',
  ids(trimCopies([e(1), e(2)], 5)), [1, 2]);
check('ровно предел — не трогаем',
  ids(trimCopies([e(1), e(2)], 2)), [1, 2]);
check('лишнее уходит С КОНЦА (там самое старое)',
  ids(trimCopies([e(1), e(2), e(3), e(4)], 2)), [1, 2]);
// ⚠️ Главный случай: закреплённое дожило до хвоста. Простое обрезание длины выбросило бы именно
// его — то есть ровно то, что человек попросил не терять.
check('закреплённое в хвосте НЕ вытесняется',
  ids(trimCopies([e(1), e(2), e(3, true)], 2)), [1, 3]);
check('вытесняется следующее незакреплённое, а не соседнее к нему',
  ids(trimCopies([e(1), e(2, true), e(3), e(4)], 2)), [1, 2]);
check('закреплённых больше предела — список законно длиннее',
  ids(trimCopies([e(1, true), e(2, true), e(3, true)], 2)), [1, 2, 3]);
check('вытеснять нечего, кроме закреплённых — остаются все',
  ids(trimCopies([e(1, true), e(2, true), e(3)], 1)), [1, 2]);
check('предел ноль — незакреплённые уходят все',
  ids(trimCopies([e(1), e(2, true)], 0)), [2]);

// ── Герой поповера: «последнее скопированное» ────────────────────────────────────────────────
// ⚠️ Случай ИЗ ЖИЗНИ. Поповер брал ПЕРВЫЙ элемент списка, а orderCopies ставит первым
// закреплённое. Из-за этого закреплённая запись показывалась под подписью «последнее» и
// пропадала из раздела «Закреплённое» — визуальная пропажа ровно того, что закрепляли.
console.log('');
console.log('— последнее скопированное —');
const heroId = (x) => (x === null ? null : x.id);
check('закреплённое НЕ становится последним',
  heroId(latestCopy(orderCopies([e(1), e(2, true)]))), 1);
check('без закреплённых — просто первое',
  heroId(latestCopy(orderCopies([e(1), e(2)]))), 1);
check('все закреплены — героя нет',
  heroId(latestCopy(orderCopies([e(1, true), e(2, true)]))), null);
check('пустой список — героя нет',
  heroId(latestCopy([])), null);
check('несколько закреплённых впереди не сбивают выбор',
  heroId(latestCopy(orderCopies([e(1), e(2, true), e(3), e(4, true)]))), 1);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
