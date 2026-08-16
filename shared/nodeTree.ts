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
import type { SidebarNode, GroupNode } from './ipc';

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
