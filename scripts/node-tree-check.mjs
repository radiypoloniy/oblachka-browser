// Обходы дерева узлов сайдбара (shared/nodeTree.ts) — без electron, обычным node.
//
// Дерево рекурсивное: группа может лежать в группе, а split-пара — внутри группы. Ошибка в
// пользу «первого уровня» здесь тихая: операция вроде «распустить группу» просто ничего не
// делает, если группа вложенная, и человек видит не ошибку, а «кнопка не работает». Поэтому
// почти каждый случай ниже проверяется дважды — на верхнем уровне и во вложенной группе.
//
// Запуск: npm test -- node-tree
import {
  findTabParent, groupContaining, findGroupByLabel, findGroupById, findGroupParent,
  pruneEmptyGroups, dissolveSplitPair, disbandGroup,
} from '../shared/nodeTree.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

const single = (tabId) => ({ type: 'single', tabId });
const pair = (leftTabId, rightTabId, ratio = 0.5) => ({ type: 'split-pair', leftTabId, rightTabId, ratio });
const group = (id, label, children, extra = {}) => ({
  type: 'group', id, label, color: null, collapsed: false, children, ...extra,
});

console.log('\n— поиск родителя вкладки —');
{
  const nodes = [single('a'), single('b')];
  check('вкладка на верхнем уровне', findTabParent('b', nodes)?.idx, 1);
  check('чужой вкладки нет', findTabParent('zzz', nodes), null);
}
{
  // Родителем должен вернуться МАССИВ ГРУППЫ, а не корень: иначе splice удалил бы не тот узел.
  const inner = [single('x'), single('y')];
  const nodes = [single('a'), group('g', 'Г', inner)];
  const found = findTabParent('y', nodes);
  check('вкладка внутри группы — родитель это массив группы', found?.parent === inner, true);
  check('и индекс внутри него', found?.idx, 1);
}
{
  const deep = [single('deep')];
  const nodes = [group('g1', 'Внешняя', [group('g2', 'Внутренняя', deep)])];
  check('вкладка в дважды вложенной группе находится', findTabParent('deep', nodes)?.parent === deep, true);
}
{
  // Пара — ОДИН узел: родителем обеих половин должен быть один и тот же индекс.
  const nodes = [single('a'), pair('l', 'r')];
  check('левая половина пары ведёт к узлу пары', findTabParent('l', nodes)?.idx, 1);
  check('правая половина — тот же узел', findTabParent('r', nodes)?.idx, 1);
}

console.log('\n— группа, в которой лежит вкладка —');
{
  const nodes = [single('a'), group('g', 'Работа', [single('x')])];
  check('вкладка вне групп — null', groupContaining('a', nodes), null);
  check('вкладка в группе — эта группа', groupContaining('x', nodes)?.id, 'g');
}
{
  // ⚠️ Возвращаться должна БЛИЖАЙШАЯ группа, а не внешняя: правило «положить в группу» иначе
  // считало бы вкладку уже лежащей не там и перекладывало бы её на каждую навигацию.
  const nodes = [group('g1', 'Внешняя', [single('a'), group('g2', 'Внутренняя', [single('b')])])];
  check('для вложенной вкладки — внутренняя группа', groupContaining('b', nodes)?.id, 'g2');
  check('для своей вкладки — внешняя', groupContaining('a', nodes)?.id, 'g1');
}
{
  const nodes = [group('g', 'Г', [pair('l', 'r')])];
  check('половина пары внутри группы тоже считается в группе', groupContaining('r', nodes)?.id, 'g');
}

console.log('\n— поиск группы —');
{
  const nodes = [group('g1', 'Хабр', [group('g2', 'Почта', [])])];
  check('по id на верхнем уровне', findGroupById('g1', nodes)?.label, 'Хабр');
  check('по id во вложенной', findGroupById('g2', nodes)?.label, 'Почта');
  check('несуществующей нет', findGroupById('нет', nodes), null);
}
{
  // Имя приходит из фразы человека («в группу хабр»), поэтому регистр и пробелы не важны.
  const nodes = [group('g1', 'Хабр', []), group('g2', 'Почта', [])];
  check('имя не чувствительно к регистру', findGroupByLabel('хабр', nodes)?.id, 'g1');
  check('и к пробелам по краям', findGroupByLabel('  Почта  ', nodes)?.id, 'g2');
  check('чужого имени нет', findGroupByLabel('Банк', nodes), null);
}
{
  const nodes = [group('g1', 'Внешняя', [group('g2', 'Хабр', [])])];
  check('вложенная группа находится по имени', findGroupByLabel('Хабр', nodes)?.id, 'g2');
}
{
  const innerChildren = [group('g2', 'Внутренняя', [])];
  const nodes = [single('a'), group('g1', 'Внешняя', innerChildren)];
  check('родитель группы верхнего уровня — корень', findGroupParent('g1', nodes) === nodes, true);
  check('родитель вложенной — массив детей внешней', findGroupParent('g2', nodes) === innerChildren, true);
  check('родителя несуществующей нет', findGroupParent('нет', nodes), null);
}

console.log('\n— уборка пустых групп —');
{
  const nodes = [single('a'), group('g', 'Пустая', []), single('b')];
  pruneEmptyGroups(nodes);
  check('пустая группа удалена', nodes.map((n) => n.type), ['single', 'single']);
}
{
  // ⚠️ Изнутри наружу: после удаления пустой внутренней внешняя ТОЖЕ становится пустой и должна
  // уйти в тот же проход. Обход сверху вниз оставил бы пустую внешнюю висеть в сайдбаре.
  const nodes = [group('g1', 'Внешняя', [group('g2', 'Внутренняя', [])])];
  pruneEmptyGroups(nodes);
  check('опустевшая после уборки внешняя тоже удалена', nodes, []);
}
{
  const nodes = [group('g1', 'С вкладкой', [single('a'), group('g2', 'Пустая', [])])];
  pruneEmptyGroups(nodes);
  check('непустая группа остаётся', nodes.length, 1);
  check('а пустая внутри неё убрана', nodes[0].children.map((n) => n.type), ['single']);
}

console.log('\n— роспуск пары —');
{
  const nodes = [single('a'), pair('l', 'r')];
  check('пара найдена', dissolveSplitPair('l', 'r', nodes), true);
  check('на её месте две одиночные вкладки', nodes.map((n) => n.type), ['single', 'single', 'single']);
  check('и в прежнем порядке', nodes.map((n) => n.tabId), ['a', 'l', 'r']);
}
{
  const inner = [pair('l', 'r')];
  const nodes = [group('g', 'Г', inner)];
  check('пара внутри группы найдена', dissolveSplitPair('l', 'r', nodes), true);
  check('и распущена на месте, внутри группы', inner.map((n) => n.tabId), ['l', 'r']);
}
{
  // Порядок половин — часть личности пары: (l,r) и (r,l) это разные пары.
  const nodes = [pair('l', 'r')];
  check('перевёрнутая пара не находится', dissolveSplitPair('r', 'l', nodes), false);
  check('дерево при этом не тронуто', nodes[0].type, 'split-pair');
}

console.log('\n— роспуск группы —');
{
  const nodes = [single('a'), group('g', 'Г', [single('x'), single('y')]), single('b')];
  check('группа найдена', disbandGroup('g', nodes), true);
  check('дети встали на её место', nodes.map((n) => n.tabId), ['a', 'x', 'y', 'b']);
}
{
  // Тот самый случай, ради которого рекурсия: вложенную группу распустить так же можно.
  const outer = [single('a'), group('g2', 'Внутренняя', [single('x')])];
  const nodes = [group('g1', 'Внешняя', outer)];
  check('вложенная группа найдена', disbandGroup('g2', nodes), true);
  check('её дети встали на её место внутри внешней', outer.map((n) => n.tabId), ['a', 'x']);
  check('внешняя группа при этом цела', nodes[0].id, 'g1');
}
{
  const nodes = [group('g', 'Г', [single('x')])];
  check('несуществующая группа — false', disbandGroup('нет', nodes), false);
  check('дерево не тронуто', nodes[0].children.length, 1);
}
{
  const nodes = [group('g', 'Г', [pair('l', 'r')])];
  disbandGroup('g', nodes);
  check('пара переживает роспуск группы целой', nodes[0].type, 'split-pair');
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
