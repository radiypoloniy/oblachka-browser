import { useEffect, useRef, useState } from 'react';
import { PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { TabState, SidebarNode, GroupNode, TabDropResult, DragCard } from '../../../shared/ipc';
import { findNodeByTopId } from './nodeIds';
import { useOptimisticOrder } from './useOptimisticOrder';
import type { ChildDragZone } from './useGroupChildOrder';

// Стабильный id droppable-контейнера секции «Открытые вкладки».
const SECTION_NORMAL_ID = 'drop-section-normal';

/**
 * Перетаскивание в сайдбаре целиком: оптимистичный порядок, ghost-состояние, разбор исхода
 * (перестановка / split / новое окно / передача соседнему окну) и производные списки, которые
 * от этого порядка зависят.
 *
 * ⚠️ Сам оптимистичный порядок живёт в useOptimisticOrder и приезжает сюда готовым. Связь
 * между ними односторонняя и в этом весь смысл разделения: порядок применяется синхронно в
 * момент дропа (иначе dnd-kit анимирует приземление по СТАРОМУ ряду, см. handleDragEnd), а
 * жест лишь говорит, что поставить (applyOrder) и когда откатить (revert) — по ответу main о
 * зоне. Обратных вызовов из порядка в жест нет.
 */
export function useSidebarDrag({
  tabs, sidebarNodes, onReorder, onMoveSection, onDropOnContent,
}: {
  tabs: TabState[];
  sidebarNodes: SidebarNode[];
  onReorder: (section: 'normal' | 'pinned', orderedIds: string[]) => void;
  onMoveSection: (tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number) => void;
  onDropOnContent: (tabId: string, side?: 'left' | 'right') => void;
}) {
  // Оптимистичный порядок: применяется сразу при drop, до ответа main.
  // Оптимистичный порядок и производные от него списки — в useOptimisticOrder.
  const { tabMap, pinned, effectiveNodes, pinnedIds, openIds, applyOrder, revert: revertLocalOrder }
    = useOptimisticOrder({ tabs, sidebarNodes });

  // ⚠️ Обработчики через ref: эффект подписки живёт всё время жизни сайдбара (пустые
  // зависимости), а applyZoneDrop замыкает список вкладок, который меняется на каждом рендере.
  // Без ref сигнал страховки применял бы исход к вкладкам первого рендера — то есть к пустому
  // списку. Ровно та же ловушка уже стоила работоспособности жеста внутри групп (см. childDragZone).
  const applyZoneDropRef = useRef<(id: string, r: TabDropResult) => boolean>(() => false);
  const revertLocalOrderRef = useRef<() => void>(() => {});
  /** Тот же dragActiveId, но читаемый из обработчика вне рендера. */
  const dragActiveIdRef = useRef<string | null>(null);

  // ID активного drag-элемента (может быть tabId одиночной, left.id пары или
  // 'group:${id}') — САМ id не говорит, какого типа узел: у одиночной и у левой
  // панели пары id выглядит одинаково (голый tabId). Резолвим РЕАЛЬНЫЙ тип, найдя
  // узел в дереве (findNodeByTopId), а не гадая по виду строки.
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  // Закреплённые живут ОТДЕЛЬНОЙ структурой (TabManager.pinnedTabs), в sidebarNodes их нет —
  // findNodeByTopId по дереву пин не находит. Отсюда и пропадала иконка при перетаскивании:
  // оригинал гасил себя (opacity:0 в расчёте на призрак), а призрака никто не рисовал.
  // Резолвим пин отдельно и ДО дерева — заодно исключает двойной призрак в окне
  // рассинхрона, когда только что закреплённая вкладка ещё висит и в sidebarNodes.
  const dragPinnedTab: TabState | null = dragActiveId
    ? (pinned.find((t) => t.id === dragActiveId) ?? null)
    : null;
  const dragNode: SidebarNode | null = dragActiveId && !dragPinnedTab
    ? findNodeByTopId(sidebarNodes, dragActiveId)
    : null;
  const dragTab: TabState | null = dragNode?.type === 'single'
    ? (tabs.find((t) => t.id === dragNode.tabId) ?? null)
    : null;
  const dragGroup: GroupNode | null = dragNode?.type === 'group' ? dragNode : null;
  const dragPairTabs: { left: TabState; right: TabState } | null = (() => {
    if (dragNode?.type !== 'split-pair') return null;
    const left  = tabs.find((t) => t.id === dragNode.leftTabId);
    const right = tabs.find((t) => t.id === dragNode.rightTabId);
    return left && right ? { left, right } : null;
  })();

  // ⚠️ Курсор жеста — классом на body, а не стилем на строке вкладки. Как только указатель
  // уходит со строки (а он уходит сразу: вкладку ведут к области контента), её собственный
  // курсор перестаёт что-либо значить. Разбор, почему именно класс с !important, — в global.css
  // у правила .oblako-dragging-tab.
  useEffect(() => {
    if (dragActiveId === null) return;
    document.body.classList.add('oblako-dragging-tab');
    return () => document.body.classList.remove('oblako-dragging-tab');
  }, [dragActiveId]);

  /**
   * Жест закрыт СТРАХОВКОЙ в main — выходим из перетаскивания сами.
   *
   * ⚠️ Ради этого всё и затевалось. Оверлей зон лежит поверх области контента, и когда кнопку
   * отпускают над страницей, `pointerup` достаётся ЕМУ, а не хрому. Обычно спасает захват мыши
   * Chromium'ом, но он переживает не всякую перестановку вью — а её мы делаем ровно посреди
   * жеста. В такой прогон dnd-kit не получал ни pointerup, ни pointercancel и оставался в
   * состоянии перетаскивания НАВСЕГДА: в сайдбаре залипал курсор руки, а следующее движение
   * мыши выглядело как «вкладка сама начала тащиться» — это был не новый жест, а тот же,
   * незакрытый. Три прошлых захода чинили симптомы (прятали окошко зон, гасили зоны в main),
   * и ни один не трогал причину: renderer о принудительном конце просто не узнавал.
   *
   * ⚠️ Синтетический `pointercancel` НА ДОКУМЕНТЕ — не хак, а единственный честный выход:
   * PointerSensor вешает слушатели именно на ownerDocument и именно на это событие
   * (node_modules/@dnd-kit/core: events.cancel.name === 'pointercancel'). Своего API «прервать
   * жест» у dnd-kit нет, а просто обнулить dragActiveId мало: сам dnd-kit остался бы в драге и
   * при следующем клике выдал бы onDragEnd от ПРОШЛОГО жеста, то есть чужую перестановку.
   *
   * ⚠️ Исход применяем ТОТ, что посчитал main. Раньше в этом случае дроп пропадал молча:
   * человек вёл вкладку в сплит, отпускал — и не происходило ничего.
   */
  useEffect(() => window.oblako.onTabDragFinished((res) => {
    const activeId = dragActiveIdRef.current;
    if (activeId === null) return;          // жест уже закрылся штатно — сигнал опоздал
    // ⚠️ Читаем id из ref, а НЕ из апдейтера setState: внутри апдейтера это был бы побочный
    // эффект, а React вправе прогнать апдейтер дважды (StrictMode) — и pointercancel улетел бы
    // дважды, второй раз уже в чужой жест.
    dragActiveIdRef.current = null;
    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    setDragActiveId(null);
    // Перестановки в сайдбаре в этом пути не было (planReorder не отрабатывал), но откат
    // безвреден и оставлен ради симметрии с handleDragEnd — правда о порядке одна.
    if (applyZoneDropRef.current(activeId, res)) revertLocalOrderRef.current();
  }), []);

  // PointerSensor с минимальным расстоянием активации: клики не превращаются в drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Droppable-контейнер секции «Открытые вкладки» для дропа из pinned в пустую секцию.
  const { setNodeRef: setNormalDropRef } = useDroppable({ id: SECTION_NORMAL_ID });


  // Зоны дропа для детей группы. Собраны здесь, потому что и tabDragStart, и разбор результата
  // (applyZoneDrop) уже живут в этой области видимости; компонентам групп уезжает готовый набор.
  // useMemo — чтобы объект не пересоздавался на каждый рендер и не дёргал хук внутри групп.
  // ⚠️ БЕЗ useMemo, и это не небрежность. С пустым списком зависимостей объект замыкал
  // applyZoneDrop ПЕРВОГО рендера, а тот, в свою очередь, — список вкладок первого рендера,
  // то есть пустой (вкладки приезжают из main позже). Дальше всё выглядело исправным:
  // подсветку рисует main по реальному курсору, зона возвращалась верная, а applyZoneDrop
  // не находил вкладку по id в пустом массиве и молча не делал ничего. Ровно поэтому жест
  // работал вне групп и не работал внутри: снаружи применяется свежий обработчик, внутри —
  // замороженный. Пересоздание объекта на каждый рендер безвредно: он живёт только внутри
  // обработчиков и ни в один список зависимостей не входит.
  const childDragZone: ChildDragZone = {
    start: (id: string) => { void window.oblako.tabDragStart(dragCardFor(id)); },
    finish: (e: DragEndEvent) => finishDrag().then((res) => applyZoneDrop(e.active.id as string, res)),
    // Отмена (Esc, потеря указателя): зоны надо погасить, но исход не применять.
    cancel: () => { void window.oblako.tabDragEnd().catch(() => {}); },
  };

  // Что нести в руке над страницей: имя и значок. Карточку рисует оверлей (чром над областью
  // контента не виден), поэтому данные для неё уходят в main сразу на старте. У папки одной
  // страницы нет — ей достаётся имя без значка.
  const dragCardFor = (id: string): DragCard | null => {
    if (id.startsWith('group:')) {
      const g = findNodeByTopId(sidebarNodes, id);
      return g?.type === 'group' ? { title: g.label, favicon: null } : null;
    }
    const tab = tabMap.get(id);
    if (!tab) return null;
    return { title: tab.title || tab.url || 'Вкладка', favicon: tab.faviconUrl };
  };

  const handleDragStart = (e: DragStartEvent) => {
    const id = e.active.id as string;
    dragActiveIdRef.current = id;
    setDragActiveId(id);
    // Зоны дропа поверх страницы и слежение за курсором — на стороне main: нативная вью страницы
    // и рисовать поверх себя не даёт, и указатель у чрома забирает (см. DropZoneManager.ts).
    void window.oblako.tabDragStart(dragCardFor(id));
  };

  // Хвост любого драга — снять слушатель, погасить подсветку контент-зоны, сбросить id.
  // Отдельной функцией, потому что нужен и в конце драга, и в ОТМЕНЕ (Esc, потеря указателя):
  // при отмене dnd-kit зовёт onDragCancel вместо onDragEnd, и без этого pointermove-слушатель
  // оставался висеть на document навсегда, продолжая дёргать onDragOverContent на каждое
  // движение мыши, а подсветка «бросить сюда» — залипать.
  // Хвост любого драга: убрать зоны и вернуть последнюю — main считает её по реальному курсору.
  // Зовётся и в конце, и в ОТМЕНЕ (Esc, потеря указателя), иначе зоны остались бы висеть.
  const finishDrag = (): Promise<TabDropResult> => {
    dragActiveIdRef.current = null;
    setDragActiveId(null);
    return window.oblako.tabDragEnd().catch(() => ({ zone: null }));
  };


  // Зону, в которой отпустили, знает main (см. finishDrag) — поэтому решение асинхронное.
  //
  // ⚠️ Но НОВЫЙ ПОРЯДОК В СПИСКЕ применяется синхронно, прямо здесь, до всякого ожидания.
  // Раньше ждали и его тоже, и от этого перетаскивание выглядело сломанным: dnd-kit запускает
  // анимацию приземления в тот же миг, когда обработчик вернул управление, и меряет исходный
  // ряд ТАМ, ГДЕ ОН СЕЙЧАС. А он в этот момент ещё на старом месте — призрак улетал обратно,
  // откуда вкладку взяли, и только потом список перескакивал в новый порядок. Механика при
  // этом работала верно, врала одна анимация.
  // Порядок и так оптимистичный (localOpenOrder/localPinnedOrder — см. выше), main его лишь
  // подтверждает, поэтому применить на кадр раньше ничего не стоит. Команда же в main уходит
  // по-прежнему только после ответа о зоне, а если зона оказалась не сайдбаром — порядок
  // откатывается тем же кадром, в котором пришёл ответ.
  const handleDragEnd = (e: DragEndEvent) => {
    // ⚠️ Жест мог быть уже закрыт страховкой (см. onTabDragFinished). Тогда это ОПОЗДАВШЕЕ
    // событие того же перетаскивания, и применять по нему перестановку нельзя: исход уже
    // применён, а второй раз он лёг бы поверх — человек увидел бы, что вкладка уехала не туда.
    if (dragActiveIdRef.current === null) return;
    const commit = planReorder(e, { pinnedIds, openIds, applyOrder, onReorder, onMoveSection });
    void (async () => {
      const drop = await finishDrag();
      if (applyZoneDrop(e.active.id as string, drop)) { revertLocalOrder(); return; }
      commit?.();
    })();
  };

  const applyZoneDrop = (id: string, res: TabDropResult): boolean =>
    zoneDrop(id, res, { tabs, onDropOnContent });


  applyZoneDropRef.current = applyZoneDrop;
  revertLocalOrderRef.current = revertLocalOrder;

  return {
    tabMap, pinned, effectiveNodes, pinnedIds, openIds,
    sensors, setNormalDropRef, childDragZone,
    dragActiveId, dragNode, dragPinnedTab, dragTab, dragGroup, dragPairTabs,
    handleDragStart, handleDragEnd, finishDrag,
  };
}


interface PlanContext {
  pinnedIds: string[];
  openIds: string[];
  applyOrder: (next: { open?: string[]; pinned?: string[] }) => void;
  onReorder: (section: 'normal' | 'pinned', orderedIds: string[]) => void;
  onMoveSection: (tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number) => void;
}

/**
 * Перестановка в сайдбаре: локальный порядок применяется СРАЗУ (ради анимации приземления,
 * см. handleDragEnd), а команду в main возвращаем отложенной — её отправит только тот, кто
 * дождался зоны. null — дроп ничего не меняет.
 */
function planReorder(e: DragEndEvent, ctx: PlanContext): (() => void) | null {
const { pinnedIds, openIds, applyOrder, onReorder, onMoveSection } = ctx;
  const { active, over } = e;

  if (!over || active.id === over.id) return null;

  const activeItemId = active.id as string;
  const overId       = over.id  as string;

  const isActivePinned      = pinnedIds.includes(activeItemId);
  const overIsPinnedTab     = pinnedIds.includes(overId);
  const overIsNormalItem    = openIds.includes(overId);
  const overIsNormalSection = overId === SECTION_NORMAL_ID;

  const overInPinned = overIsPinnedTab;
  const overInNormal = overIsNormalItem || overIsNormalSection;

  if (!overInPinned && !overInNormal) return null;

  const crossSection = (isActivePinned && overInNormal) || (!isActivePinned && overInPinned);

  if (crossSection) {
    // Группы нельзя перемещать в закреплённые — это операция только над вкладками
    if (activeItemId.startsWith('group:')) return null;

    const targetSection: 'pinned' | 'normal' = overInNormal ? 'normal' : 'pinned';

    let targetIndex: number;
    if (overIsNormalSection) {
      targetIndex = openIds.length;
    } else if (overIsNormalItem) {
      targetIndex = openIds.indexOf(overId);
    } else {
      targetIndex = pinnedIds.indexOf(overId);
    }

    if (targetSection === 'normal') {
      const newPinnedIds = pinnedIds.filter((id) => id !== activeItemId);
      const newOpenIds   = [...openIds];
      newOpenIds.splice(targetIndex, 0, activeItemId);
      applyOrder({ open: newOpenIds, pinned: newPinnedIds });
    } else {
      const newOpenIds   = openIds.filter((id) => id !== activeItemId);
      const newPinnedIds = [...pinnedIds];
      newPinnedIds.splice(targetIndex, 0, activeItemId);
      applyOrder({ open: newOpenIds, pinned: newPinnedIds });
    }
    return () => onMoveSection(activeItemId, targetSection, targetIndex);
  }

  // ── Перемещение внутри секции ─────────────────────────────────────────
  if (isActivePinned) {
    const oldIdx = pinnedIds.indexOf(activeItemId);
    const newIdx = overIsPinnedTab ? pinnedIds.indexOf(overId) : -1;
    if (newIdx < 0 || oldIdx === newIdx) return null;
    const newOrder = arrayMove(pinnedIds, oldIdx, newIdx);
    applyOrder({ pinned: newOrder });
    return () => onReorder('pinned', newOrder);
  }

  const oldIdx = openIds.indexOf(activeItemId);
  const newIdx = overIsNormalItem ? openIds.indexOf(overId) : -1;
  if (newIdx < 0 || oldIdx === newIdx) return null;
  const newOrder = arrayMove(openIds, oldIdx, newIdx);
  applyOrder({ open: newOrder });
  return () => onReorder('normal', newOrder);
}

/**
 * Исходы, которые перестановкой в сайдбаре не являются: split, вынос в новое окно, передача
 * в соседнее. Возвращает true, если дроп забрала зона, — тогда локальный порядок откатывается.
 */
function zoneDrop(
draggedId: string,
{ zone, windowId, side, replaceId }: TabDropResult,
ctx: { tabs: TabState[]; onDropOnContent: (tabId: string, side?: 'left' | 'right') => void },
): boolean {
const { tabs, onDropOnContent } = ctx;
  const draggedTab = draggedId.startsWith('group:') ? undefined : tabs.find((t) => t.id === draggedId);
  // Группу и участника split не выносим: у первой нет одной страницы, второй увёл бы за собой
  // половину пары. Хаб — не страница вовсе.
  const canDetach = !!draggedTab && !draggedTab.isHub && draggedTab.splitSide === null;

  // Середина страницы (и всё, что вне окна) — «новое окно». Это и есть ответ на развёрнутое во
  // весь экран окно: выйти за его край там некуда, поэтому жест не должен зависеть от границы.
  if (zone === 'window' && canDetach) {
    void window.oblako.moveTabToNewWindow(draggedId);
    return true;
  }
  // Отпустили над ДРУГИМ окном Oblako — вкладка переезжает в него. Это обратный жест к
  // выносу: вытащенное по ошибке окно возвращается перетаскиванием, а не только закрытием.
  if (zone === 'adopt' && windowId !== undefined && canDetach) {
    void window.oblako.moveTabToWindow(draggedId, windowId);
    return true;
  }
  // Отпустили над панелью уже открытого сплита — вкладка занимает её место, выселенная
  // возвращается в список. Ту же проверку, что и у split ниже: группу и половину чужой пары
  // на панель не кладём.
  if (zone === 'replace' && replaceId) {
    if (draggedTab && !draggedTab.isHub && !draggedTab.isPinned && draggedTab.splitSide === null) {
      void window.oblako.replaceSplitPanel(replaceId, draggedId);
    }
    return true;
  }
  // Дроп в контент-зону → split вместо reorder. Сторону считает main по реальному курсору
  // (см. TabDropResult.side) — вкладка встаёт туда, куда её вели, а не всегда справа.
  // Группы в split не входят — проверяем только обычные вкладки.
  if (zone === 'split') {
    if (draggedTab && !draggedTab.isHub && !draggedTab.isPinned && draggedTab.splitSide === null) {
      onDropOnContent(draggedId, side);
    }
    return true;
  }
  return false;
}
