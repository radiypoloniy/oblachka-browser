// Чистое построение дерева после AI-группировки. Модель только предлагает кластеры;
// здесь они превращаются в SidebarNode[] без доступа к Electron, tabMap и пользовательским
// данным на диске. Проверку полного состава вкладок и откат по-прежнему делает TabManager.
import type { GroupNode, OrganizeCluster, SidebarNode, SplitPairNode } from './ipc';

export interface OrganizedTree {
  // Глубокая копия нужна штатной кнопке «Вернуть» и аварийному откату по инварианту.
  snapshot: SidebarNode[];
  nodes: SidebarNode[];
}

export function buildOrganizedTree(
  source: SidebarNode[],
  clusters: OrganizeCluster[],
  createGroupId: () => string,
): OrganizedTree {
  // SidebarNode сериализуем по контракту; снимок не должен разделять изменяемые объекты с source.
  const snapshot = JSON.parse(JSON.stringify(source)) as SidebarNode[];

  const groupedIds = new Set<string>();
  for (const cluster of clusters) {
    for (const id of cluster.nodeIds) groupedIds.add(id);
  }

  // Существующие группы не перестраиваем: AI работает только с верхнеуровневыми кандидатами.
  const remaining = source.filter((node) => {
    if (node.type === 'single') return !groupedIds.has(node.tabId);
    if (node.type === 'split-pair') return !groupedIds.has(node.leftTabId);
    return true;
  });

  const groups: GroupNode[] = [];
  for (const cluster of clusters) {
    const children: SidebarNode[] = [];
    for (let i = 0; i < cluster.nodeIds.length; i++) {
      const nodeId = cluster.nodeIds[i]!;
      if (cluster.nodeTypes[i] === 'single') {
        children.push({ type: 'single', tabId: nodeId });
      } else {
        // Для split сохраняем ratio из снимка. nodeId по IPC-контракту — id левой панели.
        const original = snapshot.find(
          (node): node is SplitPairNode => node.type === 'split-pair' && node.leftTabId === nodeId,
        );
        if (original) children.push({ ...original });
      }
    }
    if (children.length === 0) continue;
    groups.push({
      type: 'group',
      id: createGroupId(),
      label: cluster.label,
      color: null,
      collapsed: true,
      children,
    });
  }

  return { snapshot, nodes: [...remaining, ...groups] };
}
