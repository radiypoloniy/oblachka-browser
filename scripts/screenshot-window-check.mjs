// Прогон выбора своего окна для снимка (shared/screenshotWindow.ts).
// Эталон — литералы: иначе мутант двигает и формулу, и ожидание.
//
// Запуск: npm test -- screenshot-window
import { pickOwnWindowSource, windowThumbSize } from '../shared/screenshotWindow.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const a = { id: 'window:1:0', name: 'Oblako' };
const b = { id: 'window:2:0', name: 'Notepad' };
const twin = { id: 'window:3:0', name: 'Oblako' };

console.log('\n— своё окно —');
check('точный mediaSourceId', pickOwnWindowSource([a, b], 'window:1:0', 'Oblako'), a);
check('суффикс, который дописывает Electron', pickOwnWindowSource(
  [{ id: 'window:1:0:1', name: 'Oblako' }, b],
  'window:1:0',
  'Oblako',
), { id: 'window:1:0:1', name: 'Oblako' });
check('единственный заголовок, если id разъехался', pickOwnWindowSource([a, b], 'window:9:0', 'Oblako'), a);
check('два окна с одним именем — не угадываем', pickOwnWindowSource([a, twin], 'window:9:0', 'Oblako'), null);
check('пустой id — не ищем по имени', pickOwnWindowSource([a], '', 'Oblako'), null);
check('чужой id и чужой заголовок', pickOwnWindowSource([b], 'window:1:0', 'Oblako'), null);
check('пустой список', pickOwnWindowSource([], 'window:1:0', 'Oblako'), null);

console.log('\n— размер миниатюры —');
check('125% 1280×720', windowThumbSize({ width: 1280, height: 720 }, 1.25), { width: 1600, height: 900 });
check('150% округление', windowThumbSize({ width: 100, height: 50 }, 1.5), { width: 150, height: 75 });
check('нулевой scale → 1×', windowThumbSize({ width: 100, height: 50 }, 0), { width: 100, height: 50 });
check('отрицательный scale → 1×', windowThumbSize({ width: 100, height: 50 }, -2), { width: 100, height: 50 });
check('пустое окно не ноль', windowThumbSize({ width: 0, height: 0 }, 2), { width: 1, height: 1 });

console.log(`\nИтого: ${passed} ок, ${failed} провалено`);
process.exit(failed === 0 ? 0 : 1);
