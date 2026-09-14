// Навигация и правка дерева узлов сайдбара (SidebarNode[]) — чистой логикой, без Electron.
//
// Дерево рекурсивное: группа может содержать группы, а split-пара может лежать внутри группы.
// Именно из-за рекурсии тут легко ошибиться в пользу «первого уровня» — и это тихая ошибка:
// операция вроде «распустить группу» просто ничего не делает, если группа оказалась вложенной.
// Поэтому логика вынесена сюда и покрыта scripts/node-tree-check.mjs, а TabManager остаётся
// владельцем самого дерева и зовёт эти функции со своим this.nodes.
//
// ⚠️ Часть функций МЕНЯЕТ переданный массив на месте (pruneEmptyGroups, dissolveSplitPair,
// disbandGroup) — так они работали внутри TabManager, и перенос сохранил семантику дословно:
// дерево там правится по ссылке, а возврат копии потребовал бы переписывать вызывающих.
//
// ⚠️ Значимых импортов тут быть НЕ должно, только типовые — см. ту же причину в shared/sessionTree.ts.
import type { SidebarNode, GroupNode, SplitPairNode } from './ipc';

// Листовые вкладки в визуальном порядке дерева. Split-пара даёт две вкладки — сначала левую,
// потом правую; группы раскрываются рекурсивно независимо от collapsed (свёрнутость влияет только
// на показ строк, а не на состав дерева). Здесь возвращаются id, потому что сами ManagedTab и
// tabMap принадлежат Electron-слою TabManager.
export function collectTabIds(nodes: SidebarNode[]): string[] {
  const result: string[] = [];
  for (const node of nodes) {
    if (node.type === 'single') {
      result.push(node.tabId);
    } else if (node.type === 'split-pair') {
      result.push(node.leftTabId, node.rightTabId);
    } else if (node.type === 'group') {
      result.push(...collectTabIds(node.children));
    }
  }
  return result;
}

// Порядок верхнего уровня по item-id из renderer. Узел split считается одним элементом по id
// левой панели, группа — по `group:${id}`: это ровно те ключи, которые рисует sidebar.
//
// Команде не доверяем вслепую: неизвестные и повторные id пропускаются, а не упомянутые узлы
// дописываются в прежнем порядке. Возвращаются ТЕ ЖЕ объекты узлов — меняется только массив;
// состояние групп и split-пар при drag-and-drop не должно копироваться или пересобираться.
export function reorderNodes(nodes: SidebarNode[], orderedIds: string[]): SidebarNode[] {
  const byId = new Map<string, SidebarNode>();
  for (const node of nodes) {
    const id = node.type === 'single' ? node.tabId
      : node.type === 'split-pair' ? node.leftTabId
        : `group:${node.id}`;
    byId.set(id, node);
  }

  const seen = new Set<string>();
  const finalIds: string[] = [];
  for (const id of orderedIds) {
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    finalIds.push(id);
  }
  for (const id of byId.keys()) {
    if (!seen.has(id)) finalIds.push(id);
  }
  return finalIds.map((id) => byId.get(id)!);
}

// Копия дерева только с разрешёнными вкладками. Нужна границе профилей: renderer не должен
// увидеть ни вкладку другого профиля, ни имя группы, которая после фильтра стала пустой.
//
// Split-пара существует только целиком — если запрещена или отсутствует хотя бы одна половина,
// не показываем обе. Одиночные узлы и целые пары сохраняют идентичность; GroupNode копируется,
// потому что его children фильтруются, а исходное дерево владельца менять нельзя.
export function filterNodesByTab(
  nodes: SidebarNode[],
  includeTab: (tabId: string) => boolean,
): SidebarNode[] {
  const result: SidebarNode[] = [];
  for (const node of nodes) {
    if (node.type === 'single') {
      if (includeTab(node.tabId)) result.push(node);
    } else if (node.type === 'split-pair') {
      if (includeTab(node.leftTabId) && includeTab(node.rightTabId)) result.push(node);
    } else {
      const children = filterNodesByTab(node.children, includeTab);
      if (children.length > 0) result.push({ ...node, children });
    }
  }
  return result;
}

// Заворачивает узел, содержащий вкладку, в новую группу на том же месте. Если tabId указывает
// на половину split-пары, группа получает пару ЦЕЛИКОМ: дробить её при обычном DnD нельзя.
// Меняет переданное дерево на месте и возвращает созданный GroupNode; null — вкладки нет.
export function wrapTabInGroup(
  tabId: string,
  group: Omit<GroupNode, 'type' | 'children'>,
  nodes: SidebarNode[],
): GroupNode | null {
  const found = findTabParent(tabId, nodes);
  if (!found) return null;
  const node = found.parent[found.idx];
  if (node.type === 'group') return null;

  const created: GroupNode = { type: 'group', ...group, children: [node] };
  found.parent.splice(found.idx, 1, created);
  return created;
}

// Ищет родительский массив и индекс узла, содержащего tabId (рекурсивно).
export function findTabParent(
  tabId: string,
  nodes: SidebarNode[],
): { parent: SidebarNode[]; idx: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === 'single' && node.tabId === tabId)
      return { parent: nodes, idx: i };
    if (node.type === 'split-pair' && (node.leftTabId === tabId || node.rightTabId === tabId))
      return { parent: nodes, idx: i };
    if (node.type === 'group') {
      const found = findTabParent(tabId, node.children);
      if (found) return found;
    }
  }
  return null;
}

// Группа, в которой лежит вкладка (или null — вкладка вне групп). Нужна правилам: правило
// срабатывает на КАЖДУЮ навигацию, и без этой проверки вкладку перекладывали бы снова и снова.
export function groupContaining(tabId: string, nodes: SidebarNode[]): GroupNode | null {
  for (const node of nodes) {
    if (node.type !== 'group') continue;
    for (const child of node.children) {
      if (child.type === 'single' && child.tabId === tabId) return node;
      if (child.type === 'split-pair' && (child.leftTabId === tabId || child.rightTabId === tabId)) return node;
    }
    const nested = groupContaining(tabId, node.children);
    if (nested) return nested;
  }
  return null;
}

// Группа по ИМЕНИ — правило говорит «в группу «Хабр»», а не «в группу с таким-то id».
export function findGroupByLabel(label: string, nodes: SidebarNode[]): GroupNode | null {
  for (const node of nodes) {
    if (node.type !== 'group') continue;
    if (node.label.trim().toLowerCase() === label.trim().toLowerCase()) return node;
    const nested = findGroupByLabel(label, node.children);
    if (nested) return nested;
  }
  return null;
}

// Ищет GroupNode по id (рекурсивно).
export function findGroupById(groupId: string, nodes: SidebarNode[]): GroupNode | null {
  for (const node of nodes) {
    if (node.type === 'group') {
      if (node.id === groupId) return node;
      const found = findGroupById(groupId, node.children);
      if (found) return found;
    }
  }
  return null;
}

// Возвращает родительский массив для группы (или null если группа не найдена).
export function findGroupParent(groupId: string, nodes: SidebarNode[]): SidebarNode[] | null {
  for (const node of nodes) {
    if (node.type === 'group') {
      if (node.id === groupId) return nodes;
      const found = findGroupParent(groupId, node.children);
      if (found) return found;
    }
  }
  return null;
}

// Удаляет пустые GroupNode из дерева (рекурсивно). Меняет массив на месте.
export function pruneEmptyGroups(nodes: SidebarNode[]): void {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.type === 'group') {
      pruneEmptyGroups(node.children);
      if (node.children.length === 0) nodes.splice(i, 1);
    }
  }
}

// Заменяет SplitPairNode двумя SingleNode — рекурсивный поиск (пара может быть в группе).
// Меняет массив на месте, возвращает true, если пара найдена.
export function dissolveSplitPair(leftId: string, rightId: string, nodes: SidebarNode[]): boolean {
  const idx = nodes.findIndex(
    (n) => n.type === 'split-pair' && n.leftTabId === leftId && n.rightTabId === rightId,
  );
  if (idx !== -1) {
    nodes.splice(idx, 1,
      { type: 'single', tabId: leftId },
      { type: 'single', tabId: rightId },
    );
    return true;
  }
  for (const node of nodes) {
    if (node.type === 'group') {
      if (dissolveSplitPair(leftId, rightId, node.children)) return true;
    }
  }
  return false;
}

// Распускает группу: её дети встают на её место в родительском массиве (рекурсивный поиск).
// Меняет массив на месте, возвращает true, если группа найдена.
export function disbandGroup(groupId: string, nodes: SidebarNode[]): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === 'group') {
      if (node.id === groupId) {
        nodes.splice(i, 1, ...node.children);
        return true;
      }
      if (disbandGroup(groupId, node.children)) return true;
    }
  }
  return false;
}

// Показываемая split-пара — та, что СОДЕРЖИТ активную вкладку.
//
// ⚠️ Не «первая в дереве с нужным splitSide»: при двух и более парах плоский поиск по splitSide
// всегда попадал бы на первую по порядку пару, а не на реально показываемую. Тот же принцип, что
// у #activePair() в TabManager.ts — там это источник истины, здесь его отражение для чрома.
//
// null означает в том числе ПРИПАРКОВАННУЮ пару: человек смотрит вкладку вне пары, узел не
// найден, сплит не рисуется — но splitSide у обеих вкладок пары остаётся непустым, и по нему
// сайдбар всё ещё показывает значок пары.
export function findActiveSplitPairNode(nodes: SidebarNode[], activeId: string): SplitPairNode | null {
  for (const node of nodes) {
    if (node.type === 'split-pair' && (node.leftTabId === activeId || node.rightTabId === activeId)) {
      return node;
    }
    if (node.type === 'group') {
      const nested = findActiveSplitPairNode(node.children, activeId);
      if (nested) return nested;
    }
  }
  return null;
}
