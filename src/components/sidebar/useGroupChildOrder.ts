import { useEffect, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import type { SidebarNode, GroupNode } from '../../../shared/ipc';
import { nodeToTopId } from './nodeIds';

export interface ChildDragZone {
  // id перетаскиваемого элемента: по нему Sidebar собирает карточку в руку (см. dragCardFor).
  start: (id: string) => void;
  /** true — дроп забрала зона (сплит/новое окно/передача), перестановку делать не нужно. */
  finish: (e: DragEndEvent) => Promise<boolean>;
  cancel: () => void;
}

export function useGroupChildOrder(group: GroupNode, zone: ChildDragZone) {
  const [localChildOrder, setLocalChildOrder] = useState<string[] | null>(null);
  // Своя пара state+DragOverlay на каждый вложенный DndContext — верхнеуровневый DragOverlay
  // не видит drag, стартовавший в НЁМ, dnd-kit не пробрасывает состояние между независимыми
  // DndContext. Без этого ряд гасит себя (opacity:0 при isDragging) в расчёте на портал-призрак,
  // которого там нет — пустота при перетаскивании вкладки внутри папки.
  const [childDragId, setChildDragId] = useState<string | null>(null);

  const childIds = group.children.map(nodeToTopId);

  // Сбросить оптимистичный порядок детей при изменении состава группы из main
  useEffect(() => {
    if (!localChildOrder) return;
    const curSet = new Set(localChildOrder);
    if (localChildOrder.length !== childIds.length || childIds.some((id) => !curSet.has(id))) {
      setLocalChildOrder(null);
      return;
    }
    if (localChildOrder.every((id, i) => id === childIds[i])) {
      setLocalChildOrder(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.children]);

  const effectiveChildIds = localChildOrder ?? childIds;
  const childNodeById = new Map<string, SidebarNode>();
  for (const child of group.children) {
    childNodeById.set(nodeToTopId(child), child);
  }
  const effectiveChildren = effectiveChildIds
    .map((id) => childNodeById.get(id))
    .filter((n): n is SidebarNode => n !== undefined);

  // Тип перетаскиваемого ребёнка — простой поиск в effectiveChildren (уже под рукой, не нужен
  // рекурсивный обход всего дерева, как для top-level DragOverlay в Sidebar).
  const dragChild = childDragId
    ? effectiveChildren.find((c) => nodeToTopId(c) === childDragId) ?? null
    : null;

  const handleChildDragStart = (id: string) => {
    setChildDragId(id);
    zone.start(id);
  };

  const handleChildDragCancel = () => {
    setChildDragId(null);
    zone.cancel();
  };

  const handleChildDragEnd = (e: DragEndEvent) => {
    // Сброс ПЕРВЫМ, до любых ранних return — иначе drop без реального перемещения
    // (over совпал с active, или вне списка) оставит childDragId висеть, а вместе с ним
    // призрак и погашенный (opacity:0) оригинал.
    setChildDragId(null);
    const { active, over } = e;

    // ⚠️ ПОРЯДОК В СПИСКЕ ПРИМЕНЯЕТСЯ СИНХРОННО, а команда в main — уже после ответа о зоне.
    // Это ровно тот урок, что записан в CLAUDE.md для верхнего уровня, и я его сначала
    // проглядел: dnd-kit запускает анимацию приземления в тот же миг, когда обработчик вернул
    // управление, и меряет исходный ряд ТАМ, ГДЕ ОН СЕЙЧАС. Дождись мы ответа о зоне — ряд ещё
    // на старом месте, и вкладка на глазах уезжает обратно, хотя фактически перестановка прошла.
    let newOrder: string[] | null = null;
    if (over && active.id !== over.id) {
      const from = effectiveChildIds.indexOf(active.id as string);
      const to   = effectiveChildIds.indexOf(over.id as string);
      if (from >= 0 && to >= 0 && from !== to) {
        newOrder = arrayMove(effectiveChildIds, from, to);
        setLocalChildOrder(newOrder);
      }
    }

    void zone.finish(e).then((takenByZone) => {
      if (takenByZone) {
        // Дроп забрала зона (сплит/новое окно/передача) — показанный порядок откатываем:
        // вкладка уезжает из списка целиком, переставлять её здесь незачем.
        setLocalChildOrder(null);
        return;
      }
      if (newOrder) void window.oblako.reorderGroupChildren(group.id, newOrder);
    });
  };

  return {
    effectiveChildIds, effectiveChildren, dragChild,
    setChildDragId, handleChildDragStart, handleChildDragCancel, handleChildDragEnd,
  };
}

// Блок группы: заголовок (drag handle для внешнего DndContext)
// + собственный inner DndContext для сортировки детей.
