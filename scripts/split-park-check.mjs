// Жест «открыть отдельно» из показанной пары: в соседнюю стопку, не на экран.
import { splitParkSide, splitOtherPaneId } from '../shared/splitPark.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

const base = {
  shownLeftId: 'article',
  shownRightId: 'notes',
  openerId: 'article',
  openedId: 'source',
  openedEphemeral: false,
  openedPinned: false,
  sameProfile: true,
};

console.log('\n— открыть отдельно из показанной пары —');
check('из левой — в правую папку', splitParkSide(base), 'right');
check('из правой — в левую папку', splitParkSide({ ...base, openerId: 'notes' }), 'left');
check('из левой другая панель — notes', splitOtherPaneId('article', 'notes', 'article'), 'notes');
check('из правой другая панель — article', splitOtherPaneId('article', 'notes', 'notes'), 'article');
check('чужой opener — не панель пары', splitOtherPaneId('article', 'notes', 'wiki'), null);

console.log('\n— не класть —');
check('пары на экране нет', splitParkSide({ ...base, shownLeftId: null, shownRightId: null }), null);
check('обычный попап (ephemeral)', splitParkSide({ ...base, openedEphemeral: true }), null);
check('закреплённую', splitParkSide({ ...base, openedPinned: true }), null);
check('другая сессия (инкогнито)', splitParkSide({ ...base, sameProfile: false }), null);
check('это уже левая панель', splitParkSide({ ...base, openedId: 'article' }), null);
check('это уже правая панель', splitParkSide({ ...base, openedId: 'notes' }), null);
check('сама себя', splitParkSide({ ...base, openedId: 'article', openerId: 'article' }), null);
check('открыла скрытая вкладка стопки', splitParkSide({ ...base, openerId: 'parked-source' }), null);
check('припаркованная пара не на экране', splitParkSide({
  ...base, shownLeftId: 'other-l', shownRightId: 'other-r', openerId: 'article',
}), null);
check('хаб', splitParkSide({ ...base, openedId: 'hub' }), null);
check('панель другой пары', splitParkSide({ ...base, openedIsPanel: true }), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
