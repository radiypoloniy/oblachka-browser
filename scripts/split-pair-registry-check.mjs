// Runtime-коллекция split-пар — без Electron, обычным node.
// Запуск: npm test -- split-pair-registry
import { SplitPairRegistry } from '../electron/SplitPairRegistry.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

const pair = (leftId, rightId, activePanel = 'left', splitRatio = 0.5) => ({
  leftId, rightId, activePanel, splitRatio,
});

console.log('\n— поиск runtime split-пар —');
{
  const registry = new SplitPairRegistry();
  const first = pair('left-1', 'right-1');
  const second = pair('left-2', 'right-2', 'right', 0.37);
  registry.add(first);
  registry.add(second);
  check('пара находится по левой панели', registry.containing('left-1') === first, true);
  check('пара находится по правой панели', registry.containing('right-2') === second, true);
  check('активной становится не первая, а содержащая activeId', registry.active('left-2') === second, true);
  check('сторонняя вкладка означает припаркованные пары', registry.active('outside'), undefined);
}

console.log('\n— добавление, удаление и восстановление —');
{
  const registry = new SplitPairRegistry();
  const first = pair('a', 'b');
  const sameShape = pair('a', 'b');
  registry.add(first);
  registry.add(sameShape);
  check('порядок добавления сохранён', [...registry], [first, sameShape]);
  check('удаляется именно переданный объект', registry.remove(sameShape), true);
  check('равная по данным другая пара остаётся', [...registry], [first]);
  check('повторное удаление сообщает об отсутствии', registry.remove(sameShape), false);

  const restored = [pair('c', 'd', 'right', 0.6), pair('e', 'f')];
  registry.replace(restored);
  restored.splice(0, restored.length);
  check('replace не разделяет внешний массив с реестром', [...registry].map((p) => p.leftId), ['c', 'e']);
  check('объекты восстановленных пар сохранены', registry.containing('d')?.activePanel, 'right');
}

console.log('\n— диагностическая сериализация —');
{
  const registry = new SplitPairRegistry();
  registry.add(pair('left', 'right', 'right', 0.42));
  check('JSON содержит прежнюю форму массива', JSON.parse(JSON.stringify(registry)), [{
    leftId: 'left', rightId: 'right', activePanel: 'right', splitRatio: 0.42,
  }]);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
