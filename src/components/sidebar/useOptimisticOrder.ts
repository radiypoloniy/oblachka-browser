import { useEffect, useRef, useState } from 'react';
import type { TabState, SidebarNode } from '../../../shared/ipc';
import { nodeToTopId } from './nodeIds';

/**
 * Оптимистичный порядок вкладок в сайдбаре: применяется СРАЗУ при дропе, до ответа main, и сам
 * себя отменяет, если main не подтвердил его за REORDER_CONFIRM_MS. Отсюда же едут все списки,
 * которые от этого порядка зависят.
 *
 * ⚠️ Выделено из useSidebarDrag не «для красоты», а потому что сторож структуры не пустил хук на
 * 344 строки — и оказался прав дважды: пять мест жеста повторяли одну и ту же пляску «погасить
 * таймер → поставить порядок → завести подтверждение», и теперь она живёт в applyOrder одним
 * куском.
 */
export function useOptimisticOrder({ tabs, sidebarNodes }: { tabs: TabState[]; sidebarNodes: SidebarNode[] }) {
  const [localPinnedOrder, setLocalPinnedOrder] = useState<string[] | null>(null);
  const [localOpenOrder,   setLocalOpenOrder]   = useState<string[] | null>(null);
  const REORDER_CONFIRM_MS = 3000;
  const openTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Валидация оптимистичного порядка при любом изменении tabs или sidebarNodes.
  // Если состав ID изменился → сброс (закрытие/открытие/группировка).
  // Если порядок совпал с оптимистичным → подтверждение, сброс.
  useEffect(() => {
    const newTopIds    = sidebarNodes.map(nodeToTopId);
    const newPinnedIds = tabs.filter((t) => t.isPinned && !t.isHub).map((t) => t.id);

    const decide = (cur: string[], newIds: string[]): string[] | null => {
      const curSet = new Set(cur);
      if (cur.length !== newIds.length || newIds.some((id) => !curSet.has(id))) return null;
      if (cur.every((id, i) => id === newIds[i])) return null;
      return cur;
    };

    setLocalOpenOrder((cur)   => (cur === null ? null : decide(cur, newTopIds)));
    setLocalPinnedOrder((cur) => (cur === null ? null : decide(cur, newPinnedIds)));
  }, [tabs, sidebarNodes]);

  // ⚠️ Уборка ТОЛЬКО таймаутов. Рядом жил ещё moveListenerRef — реф под pointermove-слушатель,
  // который перестали заводить в 8dc76fb (слежение за курсором уехало в main, см.
  // DropZoneManager.ts). Присваивание убрали, а объявление и эта ветка уборки остались и
  // с тех пор были мёртвым кодом: tsc его не видит, потому что реф читается — вот здесь.
  useEffect(() => {
    return () => {
      if (openTimeoutRef.current)   clearTimeout(openTimeoutRef.current);
      if (pinnedTimeoutRef.current) clearTimeout(pinnedTimeoutRef.current);
    };
  }, []);

  const pinnedBase = tabs.filter((t) => t.isPinned && !t.isHub);

  // Карта tabId → TabState для O(1)-поиска (нужна до pinned: при активной оптимистике
  // ищем вкладку здесь, а не в pinnedBase — tabs ещё не обновился).
  const tabMap = new Map(tabs.map((t) => [t.id, t]));
  // pinned: при активном localPinnedOrder берём TabState из tabMap.
  // Это даёт мгновенный показ X в секции закреплённых ДО ответа main —
  // без этого pinned.find() не находит X (tabs ещё isPinned=false) и dnd-kit
  // анимирует snap-back.
  const pinned: TabState[] = localPinnedOrder
    ? localPinnedOrder.map((id) => tabMap.get(id)).filter((t): t is TabState => t !== undefined && !t.isHub)
    : pinnedBase;

  // Набор «эффективно закреплённых» для фильтрации открытой секции:
  // оптимистика в приоритете — это предотвращает дубль X в обеих секциях
  // во время race-окна между TABS_CHANGED и SIDEBAR_NODES_CHANGED
  // (два сообщения приходят отдельными рендерами).
  const effectivePinnedIds: Set<string> = localPinnedOrder
    ? new Set(localPinnedOrder)
    : new Set(pinnedBase.map((t) => t.id));

  // Канонические ID верхнего уровня: single→tabId, pair→leftTabId, group→'group:${id}'
  const topLevelOpenIds = sidebarNodes.map(nodeToTopId);

  // Карта topId → SidebarNode для восстановления порядка при localOpenOrder
  const nodeByTopId = new Map<string, SidebarNode>();
  for (const node of sidebarNodes) {
    nodeByTopId.set(nodeToTopId(node), node);
  }
  const effectiveNodes: SidebarNode[] = (localOpenOrder
    ? localOpenOrder.map((id) => nodeByTopId.get(id)).filter((n): n is SidebarNode => n !== undefined)
    : sidebarNodes
  ).filter((node) => {
    if (node.type === 'single') return !effectivePinnedIds.has(node.tabId);
    return true;
  });

  const pinnedIds = pinned.map((t) => t.id);
  const openIds = (localOpenOrder ?? topLevelOpenIds).filter((id) => !effectivePinnedIds.has(id));

  /**
   * Поставить оптимистичный порядок и завести подтверждение. Секции независимы: перестановка
   * внутри одной трогает только её, перенос между секциями — обе разом.
   */
  const applyOrder = (next: { open?: string[]; pinned?: string[] }): void => {
    if (next.open !== undefined) {
      if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
      setLocalOpenOrder(next.open);
      openTimeoutRef.current = setTimeout(() => { setLocalOpenOrder(null); openTimeoutRef.current = null; }, REORDER_CONFIRM_MS);
    }
    if (next.pinned !== undefined) {
      if (pinnedTimeoutRef.current) clearTimeout(pinnedTimeoutRef.current);
      setLocalPinnedOrder(next.pinned);
      pinnedTimeoutRef.current = setTimeout(() => { setLocalPinnedOrder(null); pinnedTimeoutRef.current = null; }, REORDER_CONFIRM_MS);
    }
  };

  // Сброс оптимистичного порядка вместе с таймерами подтверждения — нужен, когда дроп
  // оказался не перестановкой в сайдбаре, а split/выносом в окно (см. handleDragEnd).
  const revertLocalOrder = (): void => {
    if (openTimeoutRef.current)   { clearTimeout(openTimeoutRef.current);   openTimeoutRef.current   = null; }
    if (pinnedTimeoutRef.current) { clearTimeout(pinnedTimeoutRef.current); pinnedTimeoutRef.current = null; }
    setLocalOpenOrder(null);
    setLocalPinnedOrder(null);
  };

  return { tabMap, pinned, effectiveNodes, pinnedIds, openIds, applyOrder, revert: revertLocalOrder };
}
