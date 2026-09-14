// Чистая подготовка дерева AI-группировки — без Electron и живых вкладок.
// Запуск: npm test -- organize-tree
import { buildOrganizedTree } from '../shared/organizeTree.ts';

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
const group = (id, label, children) => ({
  type: 'group', id, label, color: null, collapsed: false, children,
});

console.log('\n— построение дерева AI-группировки —');
{
  const untouched = single('free');
  const existing = group('existing', 'Существующая', [single('inside')]);
  const split = pair('left', 'right', 0.37);
  const source = [single('one'), untouched, split, existing];
  let nextId = 0;
  const result = buildOrganizedTree(source, [
    { nodeIds: ['one', 'left'], nodeTypes: ['single', 'split-pair'], label: 'Работа' },
  ], () => `new-${++nextId}`);

  check('несгруппированные узлы остаются перед новыми группами', result.nodes.slice(0, 2), [untouched, existing]);
  check('существующая группа сохранена тем же объектом', result.nodes[1] === existing, true);
  check('новая группа добавлена в конец', result.nodes[2].type === 'group' && result.nodes[2].id, 'new-1');
  check('имя и начальное состояние группы заданы', [result.nodes[2].label, result.nodes[2].color, result.nodes[2].collapsed], ['Работа', null, true]);
  check('single и обе половины split попали в группу', result.nodes[2].children.map((n) => n.type === 'single' ? n.tabId : [n.leftTabId, n.rightTabId]), ['one', ['left', 'right']]);
  check('ratio split сохранён', result.nodes[2].children[1].ratio, 0.37);
}

console.log('\n— независимый снимок для отката —');
{
  const source = [group('g', 'До', [single('a')]), single('b')];
  const result = buildOrganizedTree(source, [
    { nodeIds: ['b'], nodeTypes: ['single'], label: 'После' },
  ], () => 'new');
  source[0].label = 'Изменено снаружи';
  result.nodes[1].label = 'Изменено в результате';
  check('снимок не разделяет группу с source', result.snapshot[0].label, 'До');
  check('снимок не разделяет новую группу результата', result.snapshot.some((n) => n.id === 'new'), false);
  check('снимок хранит исходный порядок вкладок', result.snapshot.map((n) => n.type === 'single' ? n.tabId : n.id), ['g', 'b']);
}

console.log('\n— пустые и неполные предложения —');
{
  const source = [single('a'), pair('left', 'right', 0.6)];
  let idsCreated = 0;
  const result = buildOrganizedTree(source, [
    { nodeIds: ['missing'], nodeTypes: ['split-pair'], label: 'Пустая' },
  ], () => { idsCreated++; return 'new'; });
  check('кластер без найденного split не создаёт группу', result.nodes, source);
  check('id для пустой группы не запрашивается', idsCreated, 0);
}
{
  const source = [single('a')];
  const result = buildOrganizedTree(source, [], () => 'unused');
  check('без кластеров дерево остаётся теми же узлами', result.nodes[0] === source[0], true);
  check('но снимок всё равно независим', result.snapshot[0] === source[0], false);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
