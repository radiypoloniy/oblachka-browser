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

console.log('\n— runtime-операции пары —');
{
  const registry = new SplitPairRegistry();
  const current = pair('left', 'right', 'left', 0.5);
  registry.add(current);
  check('сторона левой панели определена', registry.sideOf('left'), 'left');
  check('сторона правой панели определена', registry.sideOf('right'), 'right');
  check('у чужой вкладки стороны нет', registry.sideOf('outside'), null);
  check('для панели видимы обе половины', [...registry.visibleTabIds('right')], ['left', 'right']);
  check('для одиночной вкладки видна она сама', [...registry.visibleTabIds('single')], ['single']);

  check('левая панель заменена', registry.replacePanel(current, 'left', 'incoming'), 'left');
  check('новый id записан в пару', [current.leftId, current.rightId], ['incoming', 'right']);
  check('не принадлежащая паре панель не заменена', registry.replacePanel(current, 'outside', 'x'), null);
  check('пара после отказа не изменена', [current.leftId, current.rightId], ['incoming', 'right']);

  check('ratio обновлён', registry.setRatio(current, 0.37), true);
  check('новый ratio сохранён', current.splitRatio, 0.37);
  check('фокус переведён вправо и вернул id', registry.focus(current, 'right'), 'right');
  check('активная сторона обновлена', current.activePanel, 'right');

  check('половины обменяны', registry.swap(current), true);
  check('id и активная сторона синхронно перевёрнуты', [current.leftId, current.rightId, current.activePanel], ['right', 'incoming', 'left']);
  check('ratio при обмене остался у слотов', current.splitRatio, 0.37);
}
{
  const registry = new SplitPairRegistry();
  const foreign = pair('left', 'right');
  check('чужую пару нельзя изменить через реестр', [
    registry.replacePanel(foreign, 'left', 'x'),
    registry.setRatio(foreign, 0.2),
    registry.focus(foreign, 'right'),
    registry.swap(foreign),
  ], [null, false, null, false]);
  check('чужой объект остался неизменным', foreign, pair('left', 'right'));
}

console.log('\n— план выхода из split —');
{
  const registry = new SplitPairRegistry();
  const parked = pair('park-left', 'park-right', 'right', 0.4);
  const shown = pair('show-left', 'show-right', 'left', 0.6);
  registry.add(parked);
  registry.add(shown);
  const plan = registry.planExit('park-right', 'show-left');
  check('клик по припаркованной паре выбирает её, а не показываемую', plan?.pair === parked, true);
  check('припаркованная пара не запускает визуальный выход', plan?.shown, false);
  check('по умолчанию остаётся активная сторона своей пары', [plan?.stayId, plan?.hideId], ['park-right', 'park-left']);
  check('план не удаляет пару до разворачивания дерева', registry.containing('park-left') === parked, true);
  const explicit = registry.planExit('show-right', 'show-left', 'show-right');
  check('показываемая пара распознана по activeId', explicit?.shown, true);
  check('keepId переопределяет активную сторону', [explicit?.stayId, explicit?.hideId], ['show-right', 'show-left']);
  check('неизвестная вкладка не даёт плана', registry.planExit('missing', 'show-left'), null);
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
