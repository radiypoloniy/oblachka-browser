// Обходы дерева узлов сайдбара (shared/nodeTree.ts) — без electron, обычным node.
//
// Дерево рекурсивное: группа может лежать в группе, а split-пара — внутри группы. Ошибка в
// пользу «первого уровня» здесь тихая: операция вроде «распустить группу» просто ничего не
// делает, если группа вложенная, и человек видит не ошибку, а «кнопка не работает». Поэтому
// почти каждый случай ниже проверяется дважды — на верхнем уровне и во вложенной группе.
//
// Запуск: npm test -- node-tree
import {
  collectTabIds, reorderNodes, filterNodesByTab, wrapTabInGroup, moveTabNodeToGroup, findTabParent, groupContaining, findGroupByLabel, findGroupById, findGroupParent,
  pruneEmptyGroups, dissolveSplitPair, disbandGroup, findActiveSplitPairNode,
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

console.log('\n— плоский порядок вкладок —');
{
  const nodes = [
    single('a'),
    pair('left', 'right'),
    group('g1', 'Внешняя', [
      single('b'),
      group('g2', 'Внутренняя', [pair('deep-left', 'deep-right')], { collapsed: true }),
    ]),
  ];
  check(
    'single, обе половины split и вложенные группы идут в визуальном порядке',
    collectTabIds(nodes),
    ['a', 'left', 'right', 'b', 'deep-left', 'deep-right'],
  );
  check('collapsed не меняет состав дерева', collectTabIds(nodes).includes('deep-left'), true);
  check('пустое дерево даёт пустой список', collectTabIds([]), []);
}

console.log('\n— перестановка узлов —');
{
  const a = single('a');
  const split = pair('left', 'right', 0.37);
  const g = group('g', 'Группа', [single('inside')], { collapsed: true });
  const b = single('b');
  const reordered = reorderNodes([a, split, g, b], ['group:g', 'left', 'a', 'b']);
  check('single, split и группа переставлены по item-id', collectTabIds(reordered), ['inside', 'left', 'right', 'a', 'b']);
  check('перестановка сохраняет объекты узлов', reordered[0] === g && reordered[1] === split, true);
}
{
  const nodes = [single('a'), single('b'), single('c')];
  check(
    'неизвестный и повторный id отброшены, пропущенный узел дописан в прежнем порядке',
    collectTabIds(reorderNodes(nodes, ['b', 'unknown', 'b'])),
    ['b', 'a', 'c'],
  );
  check('пустая команда сохраняет исходный порядок', collectTabIds(reorderNodes(nodes, [])), ['a', 'b', 'c']);
  check('пустое дерево остаётся пустым', reorderNodes([], ['a']), []);
}

console.log('\n— фильтрация дерева по вкладкам —');
{
  const own = single('own');
  const ownPair = pair('own-left', 'own-right', 0.4);
  const foreignPair = pair('own-half', 'foreign-half', 0.6);
  const visibleGroup = group('visible', 'Можно видеть', [single('foreign'), single('nested-own')]);
  const secretGroup = group('secret', 'Скрытое имя', [single('secret-tab')]);
  const nested = group('outer', 'Внешняя', [
    group('inner', 'Внутренняя', [single('deep-own'), single('deep-foreign')]),
  ]);
  const source = [own, ownPair, foreignPair, visibleGroup, secretGroup, nested];
  const allowed = new Set(['own', 'own-left', 'own-right', 'own-half', 'nested-own', 'deep-own']);
  const filtered = filterNodesByTab(source, (id) => allowed.has(id));

  check(
    'чужие single и неполная split-пара скрыты, целая пара сохранена',
    collectTabIds(filtered),
    ['own', 'own-left', 'own-right', 'nested-own', 'deep-own'],
  );
  check('пустая группа не выдаёт своё имя', findGroupById('secret', filtered), null);
  check('непустая вложенная группа сохраняет путь к разрешённой вкладке', findGroupById('inner', filtered)?.children.length, 1);
  check('single и целая split-пара сохраняют идентичность', filtered[0] === own && filtered[1] === ownPair, true);
  check('исходное дерево и дети групп не мутируют', visibleGroup.children.length === 2 && source.length === 6, true);
}
{
  const nodes = [group('g', 'Г', [single('a')])];
  check('если нельзя ничего, дерево пусто', filterNodesByTab(nodes, () => false), []);
  check('пустое исходное дерево остаётся пустым', filterNodesByTab([], () => true), []);
}

console.log('\n— создание группы вокруг вкладки —');
{
  const a = single('a');
  const b = single('b');
  const nodes = [a, b];
  const created = wrapTabInGroup('b', {
    id: 'g', label: 'Новая группа', color: null, collapsed: false,
  }, nodes);
  check('single заменён группой на прежнем месте', nodes.map((n) => n.type), ['single', 'group']);
  check('созданная группа возвращена вызывающему', created === nodes[1], true);
  check('исходный узел сохранён ребёнком без копирования', created?.children[0] === b, true);
}
{
  const split = pair('left', 'right', 0.37);
  const nodes = [single('a'), split];
  const created = wrapTabInGroup('right', {
    id: 'g', label: 'Пара', color: 'blue', collapsed: true,
  }, nodes);
  check('клик по правой половине переносит split целиком', created?.children[0] === split, true);
  check('ratio и свойства новой группы сохранены', [created?.children[0].ratio, created?.color, created?.collapsed], [0.37, 'blue', true]);
}
{
  const inner = [single('deep')];
  const nodes = [group('outer', 'Внешняя', inner)];
  wrapTabInGroup('deep', { id: 'inner', label: 'Внутренняя', color: null, collapsed: false }, nodes);
  check('вложенная вкладка завёрнута на своём уровне', inner[0].type === 'group' && inner[0].id, 'inner');
}
{
  const nodes = [single('a')];
  const before = JSON.stringify(nodes);
  check('несуществующая вкладка не создаёт группу', wrapTabInGroup('missing', {
    id: 'g', label: 'Г', color: null, collapsed: false,
  }, nodes), null);
  check('дерево при промахе не изменено', JSON.stringify(nodes), before);
}

console.log('\n— перенос вкладки в группу —');
{
  const moved = single('a');
  const target = group('g', 'Группа', [single('inside')]);
  const nodes = [moved, target, single('b')];
  check('одиночная вкладка перенесена', moveTabNodeToGroup(target, 'a', nodes), true);
  check('узел удалён с прежнего места', collectTabIds(nodes), ['inside', 'a', 'b']);
  check('тот же объект добавлен в конец группы', target.children[1] === moved, true);
}
{
  const split = pair('left', 'right', 0.37);
  const target = group('g', 'Группа', []);
  const nodes = [split, target];
  moveTabNodeToGroup(target, 'right', nodes);
  check('правая половина переносит split целиком', target.children[0] === split, true);
  check('порядок половин и ratio сохранены', collectTabIds(target.children), ['left', 'right']);
  check('доля split сохранена', target.children[0].ratio, 0.37);
}
{
  const first = single('first');
  const last = single('last');
  const target = group('g', 'Группа', [first, last]);
  const nodes = [target];
  moveTabNodeToGroup(target, 'first', nodes);
  check('вкладка из той же группы переставлена в конец', target.children, [last, first]);
}
{
  const target = group('g', 'Группа', []);
  const nodes = [single('a'), target];
  const before = JSON.stringify(nodes);
  check('несуществующая вкладка не переносится', moveTabNodeToGroup(target, 'missing', nodes), false);
  check('дерево при промахе не изменено', JSON.stringify(nodes), before);
}

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

console.log('\n— показываемая split-пара —');
{
  const nodes = [pair('l1', 'r1'), pair('l2', 'r2')];
  check('пара по левой половине', findActiveSplitPairNode(nodes, 'l1')?.rightTabId, 'r1');
  check('пара по правой половине', findActiveSplitPairNode(nodes, 'r1')?.leftTabId, 'l1');
  // ⚠️ Случай из жизни: при 2+ парах вернуться обязана та, что содержит активную вкладку, а не
  // первая по порядку. Плоский поиск по splitSide всегда отдавал первую — и сплит рисовался чужой.
  check('вторая пара, а не первая по порядку', findActiveSplitPairNode(nodes, 'r2')?.leftTabId, 'l2');
}
{
  const nodes = [single('a'), pair('l', 'r'), single('b')];
  // «Припаркованная» пара: смотрим вкладку вне её — сплит не показывается.
  check('вкладка вне пары — пары нет', findActiveSplitPairNode(nodes, 'a'), null);
  check('чужой вкладки нет', findActiveSplitPairNode(nodes, 'zzz'), null);
  check('пустое дерево', findActiveSplitPairNode([], 'a'), null);
}
{
  // Ради рекурсии: пара внутри группы обязана находиться так же.
  const nodes = [single('a'), group('g', 'Г', [single('x'), pair('l', 'r')])];
  check('пара внутри группы', findActiveSplitPairNode(nodes, 'r')?.leftTabId, 'l');
}
{
  const nodes = [group('g1', 'Внешняя', [group('g2', 'Внутренняя', [pair('l', 'r')])])];
  check('пара во вложенной группе', findActiveSplitPairNode(nodes, 'l')?.rightTabId, 'r');
}
{
  // Доля показываемой пары — то, ради чего её и ищут: она едет в раскладку окна.
  const nodes = [pair('l1', 'r1', 0.3), pair('l2', 'r2', 0.7)];
  check('доля берётся у СВОЕЙ пары', findActiveSplitPairNode(nodes, 'l2')?.ratio, 0.7);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
