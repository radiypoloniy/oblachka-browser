import type { SidebarNode } from '../../../shared/ipc';

// ID для dnd-kit: single → tabId, pair → leftTabId, group → 'group:${id}'
export const nodeToTopId = (node: SidebarNode): string =>
  node.type === 'single' ? node.tabId
  : node.type === 'split-pair' ? node.leftTabId
  : `group:${node.id}`;

// Ищет узел дерева по его "верхнему" id (nodeToTopId) — рекурсивно, узел может лежать
// внутри группы. Резолвит РЕАЛЬНЫЙ тип по дереву, а не по эвристике вида id (тот же
// id — голый tabId — носят и одиночная вкладка, и левая панель пары, различить их
// можно только так). Используется DragOverlay, чтобы понять, что именно тащат.
export const findNodeByTopId = (nodes: SidebarNode[], topId: string): SidebarNode | null => {
  for (const node of nodes) {
    if (nodeToTopId(node) === topId) return node;
    if (node.type === 'group') {
      const nested = findNodeByTopId(node.children, topId);
      if (nested) return nested;
    }
  }
  return null;
};
