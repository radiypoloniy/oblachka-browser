import { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, RotateCcw } from 'lucide-react';
// Свои значки — см. разбор в glyphs.tsx.
import { PanelGlyph, PlusGlyph, SlidersGlyph, CloseGlyph, ClockGlyph, SparkGlyph } from './glyphs';
import { islandPlate } from '../styles/island';
import SidebarBookmarks from './SidebarBookmarks';
import {
  DndContext, DragOverlay,
  PointerSensor, useSensor, useSensors,
  closestCenter, useDroppable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, rectSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import type { TabState, SidebarNode, GroupNode, ClusterProposal, TabDropResult, DragCard } from '../../shared/ipc';
import { well, RADIUS, glyph, CAPS } from '../styles/system';
import { useSidebarWidth, SIDEBAR_HANDLE_OUTSET } from './sidebar/useSidebarWidth';
import { nodeToTopId, findNodeByTopId } from './sidebar/nodeIds';
import { TabRow, SortableTabRow, PairTile, SortablePairBlock, IconCell, SortablePinCell } from './sidebar/rows';

// Стабильный id droppable-контейнера секции «Открытые вкладки».
const SECTION_NORMAL_ID = 'drop-section-normal';


// Курсор ушёл с чрома на страницу (или на другое окно) — там карточку в руке ведёт оверлей, и
// СВОЙ призрак чром обязан спрятать: две вещи под курсором разом читаются как сбой. Зону считает
// main, он один видит курсор над страницей (см. DropZoneManager.ts).
//
// Хук, а не проп: призраков в этом файле четыре (развёрнутая панель, свёрнутая полоса и по одному
// на каждый вид папки), и лежат они в разных компонентах — протаскивать флаг через все уровни
// пришлось бы ради одного логического значения.
function useTabDragOverPage(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => window.oblako.onTabDragZone((zone) => setOver(zone !== null)), []);
  return over;
}

const GROUP_COLORS: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', yellow: '#eab308',
  green: '#22c55e', blue: '#3b82f6', purple: '#a855f7',
};

interface SidebarProps {
  tabs: TabState[];
  sidebarNodes: SidebarNode[];
  activeId: string;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onNewTabMenu: () => void; // ПКМ по кнопке «Новая вкладка» (обычная/инкогнито/восстановить)
  onTabMenu: (id: string) => void;
  onSplit: (id: string) => void;
  onExitSplit: (tabId: string) => void;
  onSettings: () => void;
  // История и Закладки объединены в одну точку входа (HistoryBookmarks.tsx) — одна иконка,
  // всегда открывает секцию «История» (дефолт), переключение на «Закладки» — уже внутри панели.
  onHistory: () => void;
  onReorder: (section: 'normal' | 'pinned', orderedIds: string[]) => void;
  onMoveSection: (tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number) => void;
  // Разделить экран этой вкладкой (дроп у края страницы). Куда именно попадёт вкладка, решает
  // main: чром теряет указатель, как только тот уходит на страницу (см. DropZoneManager.ts).
  onDropOnContent: (tabId: string, side?: 'left' | 'right') => void;
  // Половину сплита тащат за шапку и курсор сейчас над сайдбаром: отпустишь — сплит разорвётся,
  // обе вкладки останутся (см. App.tsx, handlePanelDrag*). Подсветку рисует React, а не оверлей
  // поверх страницы: остров сайдбара — чром, он виден.
  returnHint?: boolean;
  // AI-группировка
  organizeTabsCount: number;
  organizeState: 'idle' | 'computing' | 'preview' | 'model-error';
  // true — 'computing' идёт дольше ORGANIZE_COLD_START_THRESHOLD_MS (App.tsx) без ответа, похоже на
  // холодную загрузку модели, а не тёплый прогон — переключает текст индикатора.
  organizeLongWait: boolean;
  organizeProposal: ClusterProposal[];
  hasOrganizeSnapshot: boolean;
  hasRenameSnapshot: boolean;
  // Сколько имён придумано из скольких; null — переименование не идёт.
  renameProgress: { done: number; total: number } | null;
  undoDismissed: boolean;
  onOrganize: () => void;
  onOrganizeApply: () => void;
  onOrganizeCancel: () => void;
  onOrganizeRollback: () => void;
  onRenameRollback: () => void;
  onRollbackAll: () => void;
  onDismissUndo: () => void;
}


// ── Свёрнутая панель ──────────────────────────────────────────────────────────
// Глиф папки в духе системной иконки macOS: не контур в одну линию, а две залитые стенки —
// задняя с язычком и передняя поверх неё. Объём даётся ВТОРЫМ ТОНОМ, а не тенью: передняя
// стенка — тот же цвет, подмешанный к фону (color-mix), то есть непрозрачный светлый оттенок.
// Полупрозрачность тут не годится — на перекрытии двух слоёв она давала бы третий, грязный тон.
//
// tone — цвет папки (или нейтральный токен) ЯВНЫМ значением, а не через currentColor:
// подмешивание идёт тем же color-mix, что уже держит заливку острова, и в этой форме
// (конкретный цвет + var(--surface)) оно в проекте проверено.
function FolderGlyph({ tone, size = 18, open }: { tone: string; size?: number; open?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      {/* Задняя стенка с язычком */}
      <path
        fill={tone}
        d="M2 7.4C2 6 3.1 4.9 4.5 4.9h4.2c.7 0 1.4.3 1.9.8l1.1 1.2c.3.3.7.5 1.1.5h6.7c1.4 0 2.5 1.1 2.5 2.5v2.2H2V7.4z"
      />
      {/* Передняя стенка. У раскрытой папки слегка отклонена от нижней кромки — тот же приём,
          которым открытую папку показывает сама система. */}
      <path
        fill={`color-mix(in srgb, ${tone} 58%, var(--surface))`}
        transform={open ? 'rotate(-7 3.5 19.4)' : undefined}
        d="M2 10.8c0-1 .8-1.8 1.8-1.8h16.4c1 0 1.8.8 1.8 1.8v6.7c0 1.4-1.1 2.5-2.5 2.5H4.5C3.1 20 2 18.9 2 17.5v-6.7z"
      />
    </svg>
  );
}


// Есть ли активная вкладка внутри узлов (рекурсивно — группа может лежать в группе).
// Нужно свёрнутой панели: у сложенной папки содержимое не видно, и без этой пометки
// пользователь теряет активную вкладку из виду совсем.
const nodesContainTab = (nodes: SidebarNode[], tabId: string): boolean =>
  nodes.some((n) =>
    n.type === 'single' ? n.tabId === tabId
    : n.type === 'split-pair' ? n.leftTabId === tabId || n.rightTabId === tabId
    : nodesContainTab(n.children, tabId));

// Обёртка призрака DragOverlay — одна на все «иконочные» призраки свёрнутой полосы.
const collapsedGhostPlate: React.CSSProperties = {
  boxShadow: 'var(--shadow-card)', borderRadius: 'var(--radius-sm)',
  background: 'var(--surface)', opacity: 0.95, display: 'inline-flex',
};

interface CollapsedCellsProps {
  node: SidebarNode;
  tabMap: Map<string, TabState>;
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onTabMenu: (id: string) => void;
  /** Клик по значку звука на ячейке. Не приходит призракам перетаскивания. */
  onToggleMute?: (id: string) => void;
  ghost?: boolean;
}

// Split-пара в узкой полосе: две иконки на общей утопленной подложке с волосяной линией между
// ними. Без подложки пара неотличима от двух соседних вкладок — а это разные вещи: она и
// переезжает, и закрывается как одно целое.
function CollapsedPairTile({ left, right, activeId, onSelect, onClose, onTabMenu, onToggleMute, ghost }: {
  left: TabState; right: TabState; activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onToggleMute?: (id: string) => void;
  onTabMenu: (id: string) => void;
  ghost?: boolean;
}) {
  const cell = (tab: TabState) => (
    <IconCell
      tab={tab} active={activeId === tab.id} ghost={ghost}
      onClick={() => onSelect(tab.id)}
      onContextMenu={() => onTabMenu(tab.id)}
      onMiddleClick={() => onClose(tab.id)}
      onToggleMute={onToggleMute ? () => onToggleMute(tab.id) : undefined}
    />
  );
  // Обойма split-пары в свёрнутой полосе. ⚠️ Была залита --surface-sunken — на подложке это
  // контраст 1,13:1, то есть обойма просто исчезала бы, и две ячейки пары перестали бы читаться
  // как пара. Ограничиваем волоском: он виден и на сером холсте, и на подкрашенном.
  return (
    <div style={{
      border: '1px solid var(--divider)', borderRadius: 'var(--radius-sm)',
      padding: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    }}>
      {cell(left)}
      <span style={{ width: 14, height: 1, background: 'var(--divider)', flex: 'none' }} />
      {cell(right)}
    </div>
  );
}

// Узел дерева → ячейки свёрнутой полосы. Общий кусок для верхнего уровня и для детей папки.
function CollapsedNodeCells({ node, tabMap, activeId, onSelect, onClose, onTabMenu, onToggleMute, ghost }: CollapsedCellsProps) {
  if (node.type === 'single') {
    const tab = tabMap.get(node.tabId);
    if (!tab) return null;
    return (
      <IconCell
        tab={tab} active={activeId === tab.id} ghost={ghost}
        onClick={() => onSelect(tab.id)}
        onContextMenu={() => onTabMenu(tab.id)}
        onMiddleClick={() => onClose(tab.id)}
        onToggleMute={onToggleMute ? () => onToggleMute(tab.id) : undefined}
      />
    );
  }
  if (node.type === 'split-pair') {
    const left = tabMap.get(node.leftTabId);
    const right = tabMap.get(node.rightTabId);
    if (!left || !right) return null;
    return (
      <CollapsedPairTile
        left={left} right={right} activeId={activeId} ghost={ghost}
        onSelect={onSelect} onClose={onClose} onTabMenu={onTabMenu} onToggleMute={onToggleMute}
      />
    );
  }
  return null; // папки рисует CollapsedGroupIsland
}

// DnD-обёртка элемента свёрнутой полосы: пин, одиночная вкладка, split-пара. Папка тащится не
// так (см. CollapsedGroupIsland): у неё listeners висят на иконке-ручке, а не на всём острове,
// иначе перетаскивание ребёнка внутри раскрытой папки поднимало бы заодно и саму папку.
function SortableCollapsedItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0 : 1, flex: 'none',
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

// Папка в свёрнутой панели: остров с иконкой, без названия. Клик по иконке — раскрыть/сложить
// (то же состояние group.collapsed, что и в развёрнутой панели, — одна правда, и она уже
// переживает перезапуск). Тон острова: нейтральный, если цвет папки не задан, иначе — бледная
// заливка её цветом, чтобы принадлежность читалась без подписи.
function CollapsedGroupIsland({ group, tabMap, activeId, onSelect, onClose, onTabMenu, onToggleMute, zone }: {
  group: GroupNode;
  tabMap: Map<string, TabState>;
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onTabMenu: (id: string) => void;
  onToggleMute?: (id: string) => void;
  zone: ChildDragZone;
}) {
  const innerSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const dragOverPage = useTabDragOverPage();
  const {
    effectiveChildIds, effectiveChildren, dragChild,
    handleChildDragStart, handleChildDragCancel, handleChildDragEnd,
  } = useGroupChildOrder(group, zone);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `group:${group.id}`,
  });

  const color = group.color ? (GROUP_COLORS[group.color] ?? null) : null;
  const hasActive = nodesContainTab(group.children, activeId);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0 : 1, flex: 'none',
      }}
    >
      <div
        className="no-drag"
        style={{
          borderRadius: 'var(--radius-sm)',
          // Бледная заливка = цвет папки, приглушённый до фона: сам цвет остаётся узнаваем,
          // но папка не начинает конкурировать с активной вкладкой за внимание.
          // ⚠️ Белой плашки под БЕСЦВЕТНОЙ папкой больше нет: в сайдбаре без поверхностей она
          // была единственным белым прямоугольником ни о чём.
          ...(color ? {
            background: `color-mix(in srgb, ${color} 14%, var(--surface))`,
            border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
          } : {}),
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          padding: '6px 5px',
        }}
      >
        {/* Иконка — и кнопка «раскрыть/сложить», и ручка перетаскивания всей папки. Как у
            заголовка группы в развёрнутой панели: PointerSensor с activationConstraint.distance
            сам разводит клик и драг, клик без сдвига курсора драгом не становится. */}
        <button
          className="no-drag"
          {...attributes}
          {...listeners}
          onClick={() => { void window.oblako.toggleGroupCollapse(group.id); }}
          onContextMenu={(e) => { e.preventDefault(); void window.oblako.showGroupMenu(group.id); }}
          title={group.label}
          style={{
            border: 'none', background: 'transparent', cursor: 'grab',
            padding: 5, borderRadius: 'var(--radius-sm)', display: 'inline-flex',
            position: 'relative', color: color ?? 'var(--text-muted)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <FolderGlyph tone={color ?? 'var(--text-muted)'} size={18} open={!group.collapsed} />
          {/* Активная вкладка внутри сложенной папки — иначе она исчезает из панели бесследно. */}
          {group.collapsed && hasActive && (
            <span style={{
              position: 'absolute', right: 2, bottom: 1, width: 6, height: 6,
              borderRadius: '50%', background: 'var(--accent)',
            }} />
          )}
        </button>

        {/* Свой DndContext на детей — ровно как у развёрнутой группы: порядок внутри папки
            меняется и в узкой полосе, а наружу такой драг не выходит (это отдельный контекст). */}
        {!group.collapsed && (
          <DndContext
            sensors={innerSensors}
            collisionDetection={closestCenter}
            // ⚠️ restrictToVerticalAxis снят намеренно: он запирал призрак в колонке, и утащить
            // вкладку из папки на страницу было физически некуда — жест выглядел невозможным. Порядок
            // внутри папки считает verticalListSortingStrategy, модификатор влиял лишь на картинку.
            onDragStart={(e) => handleChildDragStart(e.active.id as string)}
            onDragEnd={handleChildDragEnd}
            onDragCancel={handleChildDragCancel}
          >
            <SortableContext items={effectiveChildIds} strategy={verticalListSortingStrategy}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                {effectiveChildren.map((child) => (
                  <SortableCollapsedItem key={nodeToTopId(child)} id={nodeToTopId(child)}>
                    <CollapsedNodeCells
                      node={child} tabMap={tabMap} activeId={activeId}
                      onSelect={onSelect} onClose={onClose} onTabMenu={onTabMenu}
                      onToggleMute={onToggleMute}
                    />
                  </SortableCollapsedItem>
                ))}
              </div>
            </SortableContext>

            {/* Портал призрака живёт в своём DndContext — верхний сюда не дотягивается. */}
            {!dragOverPage && <DragOverlay>
              {dragChild && (
                <div style={collapsedGhostPlate}>
                  <CollapsedNodeCells
                    node={dragChild} tabMap={tabMap} activeId={activeId}
                    onSelect={() => {}} onClose={() => {}} onTabMenu={() => {}}
                    ghost
                  />
                </div>
              )}
            </DragOverlay>}
          </DndContext>
        )}
      </div>
    </div>
  );
}

// Порядок детей группы — общий для обеих панелей (развёрнутой и свёрнутой): оптимистичный
// локальный порядок, его сверка с приходящим из main и отправка нового порядка туда же.
// Вынесено в хук, когда сортировка внутри папки понадобилась и в узкой полосе: две копии
// этой машинки разъехались бы при первой же правке.
// Зоны дропа для перетаскивания ВНУТРИ группы. Раньше их не было вовсе: у детей группы свой
// DndContext, и его onDragStart только запоминал id — отслеживание зон на стороне main никто не
// включал. Наружу это выглядело так, будто вкладка из папки умеет только меняться местами с
// соседкой: ни подсветки, ни выноса в окно, ни разделения экрана. Причём молча — жест
// отрабатывал, просто ничего не происходило.
interface ChildDragZone {
  // id перетаскиваемого элемента: по нему Sidebar собирает карточку в руку (см. dragCardFor).
  start: (id: string) => void;
  /** true — дроп забрала зона (сплит/новое окно/передача), перестановку делать не нужно. */
  finish: (e: DragEndEvent) => Promise<boolean>;
  cancel: () => void;
}

function useGroupChildOrder(group: GroupNode, zone: ChildDragZone) {
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
interface GroupBlockProps {
  group: GroupNode;
  tabMap: Map<string, TabState>;
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (id: string) => void;
  onSplit: (id: string) => void;
  onExitSplit: (tabId: string) => void;
  renameGroupId: string | null;
  setRenameGroupId: (id: string | null) => void;
  zone: ChildDragZone;
}

function SortableGroupBlock({
  group, tabMap, activeId, onSelect, onClose, onContextMenu,
  onSplit, onExitSplit, renameGroupId, setRenameGroupId, zone,
}: GroupBlockProps) {
  const innerSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const dragOverPage = useTabDragOverPage();
  const {
    effectiveChildIds, effectiveChildren, dragChild,
    handleChildDragStart, handleChildDragCancel, handleChildDragEnd,
  } = useGroupChildOrder(group, zone);
  const [renameValue, setRenameValue] = useState(group.label);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const isRenaming = renameGroupId === group.id;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `group:${group.id}`,
  });

  // При активации переименования — синхронизировать текущий label и сфокусировать
  useEffect(() => {
    if (!isRenaming) return;
    setRenameValue(group.label);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRenaming]);

  const dragChildTab: TabState | null = dragChild?.type === 'single'
    ? (tabMap.get(dragChild.tabId) ?? null)
    : null;
  const dragChildPairTabs: { left: TabState; right: TabState } | null = (() => {
    if (dragChild?.type !== 'split-pair') return null;
    const left  = tabMap.get(dragChild.leftTabId);
    const right = tabMap.get(dragChild.rightTabId);
    return left && right ? { left, right } : null;
  })();

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed) void window.oblako.renameGroup(group.id, trimmed);
    setRenameGroupId(null);
  };

  const colorDot = group.color ? (GROUP_COLORS[group.color] ?? null) : null;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1, flexShrink: 0 }}
    >
      {/* Заголовок группы — drag handle (listeners отключены при переименовании). Клик по всей
          строке тоже тогглит collapsed, не только иконка-стрелка (см. её onClick ниже) — тот же
          элемент одновременно источник onClick и drag handle, как у TabRow/SortableTabRow: PointerSensor
          с activationConstraint.distance (см. sensors выше) сам разводит клик и драг, отдельного
          «только что было перетаскивание» флага для этого в проекте нет и не нужен — клик без
          сдвига курсора не становится драгом, а реальный драг не долетает как click. Отключаем
          вместе с listeners при переименовании — иначе клик в поле ради позиционирования курсора
          тоже сворачивал бы группу. */}
      <div
        {...attributes}
        {...(isRenaming ? {} : listeners)}
        onClick={isRenaming ? undefined : () => { void window.oblako.toggleGroupCollapse(group.id); }}
        onContextMenu={(e) => {
          if (isRenaming) return;
          e.preventDefault();
          void window.oblako.showGroupMenu(group.id);
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 'var(--radius-sm)',
          cursor: isRenaming ? 'default' : 'grab',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => { if (!isRenaming) e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Цветная точка */}
        <span style={{
          width: 10, height: 10, borderRadius: '50%', flex: 'none',
          background: colorDot ?? 'transparent',
          border: colorDot ? 'none' : '1.5px solid var(--text-faint)',
        }} />

        {/* Метка или поле переименования */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="no-drag"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter')  { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); setRenameGroupId(null); }
            }}
            style={{
              flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: 600,
              background: 'var(--surface)', border: '1px solid var(--accent)',
              borderRadius: RADIUS.tight, padding: '1px 6px', color: 'var(--text-strong)',
              outline: 'none',
            }}
          />
        ) : (
          <span style={{
            flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: 600,
            color: 'var(--text-body)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{group.label}</span>
        )}

        {/* Свернуть / развернуть */}
        <button
          className="no-drag"
          onClick={(e) => { e.stopPropagation(); void window.oblako.toggleGroupCollapse(group.id); }}
          title={group.collapsed ? 'Развернуть группу' : 'Свернуть группу'}
          style={{
            border: 'none', background: 'transparent', cursor: 'default',
            padding: 2, borderRadius: RADIUS.tight, display: 'inline-flex', flex: 'none',
            color: 'var(--text-faint)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {group.collapsed ? <ChevronRight {...glyph(14)} /> : <ChevronDown {...glyph(14)} />}
        </button>
      </div>

      {/* Дети группы с собственным DndContext для внутренней сортировки */}
      {!group.collapsed && (
        <DndContext
          sensors={innerSensors}
          collisionDetection={closestCenter}
          // ⚠️ restrictToVerticalAxis снят намеренно: он запирал призрак в колонке, и утащить
          // вкладку из папки на страницу было физически некуда — жест выглядел невозможным. Порядок
          // внутри папки считает verticalListSortingStrategy, модификатор влиял лишь на картинку.
          onDragStart={(e) => handleChildDragStart(e.active.id as string)}
          onDragEnd={handleChildDragEnd}
          onDragCancel={handleChildDragCancel}
        >
          <SortableContext items={effectiveChildIds} strategy={verticalListSortingStrategy}>
            <div style={{ paddingLeft: 14, paddingBottom: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {effectiveChildren.map((child) => {
                if (child.type === 'single') {
                  const tab = tabMap.get(child.tabId);
                  if (!tab) return null;
                  return (
                    <SortableTabRow
                      key={child.tabId}
                      tab={tab}
                      active={activeId === tab.id}
                      onClick={() => onSelect(tab.id)}
                      onClose={() => onClose(tab.id)}
                      onContextMenu={() => onContextMenu(tab.id)}
                      onSplit={() => onSplit(tab.id)}
                      onExitSplit={onExitSplit}
                      onToggleMute={() => void window.oblako.setTabMuted(tab.id, !tab.muted)}
                    />
                  );
                }
                if (child.type === 'split-pair') {
                  const left = tabMap.get(child.leftTabId);
                  const right = tabMap.get(child.rightTabId);
                  if (!left || !right) return null;
                  return (
                    <SortablePairBlock
                      key={child.leftTabId}
                      left={left} right={right}
                      activeId={activeId}
                      onSelect={onSelect} onClose={onClose}
                      onContextMenu={onContextMenu} onExitSplit={onExitSplit}
                    />
                  );
                }
                return null;
              })}
            </div>
          </SortableContext>

          {/* Свой DragOverlay — портал живёт в своём DndContext, верхнеуровневый
              (Sidebar) сюда не дотягивается. Та же разметка/стиль ghost-контейнера,
              что в top-level DragOverlay (коммит 1) — только источник типа проще
              (child уже под рукой в effectiveChildren, дерево обходить не нужно). */}
          {!dragOverPage && <DragOverlay>
            {dragChildTab && (
              <div style={{
                boxShadow: 'var(--shadow-card)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface)',
                opacity: 0.95,
              }}>
                <TabRow
                  tab={dragChildTab}
                  active={activeId === dragChildTab.id}
                  onClick={() => {}}
                  onClose={() => {}}
                  onContextMenu={() => {}}
                  ghost
                />
              </div>
            )}
            {dragChildPairTabs && (
              <div style={{
                boxShadow: 'var(--shadow-card)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface)',
                opacity: 0.95,
              }}>
                <PairTile
                  left={dragChildPairTabs.left}
                  right={dragChildPairTabs.right}
                  activeId={activeId}
                  onSelect={() => {}}
                  onClose={() => {}}
                  onContextMenu={() => {}}
                  onExitSplit={() => {}}
                  ghost
                />
              </div>
            )}
          </DragOverlay>}
        </DndContext>
      )}
    </div>
  );
}

// Полный остров: воздух сверху/снизу/слева через margin (--gutter-shell), высота —
// НЕ фикс. height:100% (тот вместе с margin переполнил бы флекс-строку и обрезался бы снизу
// родительским overflow:hidden в App.tsx) — вместо этого убрали height и отдали расчёт дефолтному
// align-items:stretch родителя, который сам вычитает margin-top/bottom из доступной высоты.
// Справа margin нет — контент теперь сам отступает от сайдбара своим собственным margin
// (src/App.tsx, contentRef), поэтому граница ровно совпадает без удвоения зазора; скругление —
// все четыре угла (--radius-island), т.к. контент больше не примыкает вплотную.
// ── «Цветной» сайдбар: градиент + шум ────────────────────────────────────────────────────────
//
// ⚠️ Цвет берётся ИЗ ПАЛИТРЫ, а не задаётся своими значениями. Токены --surface/--surface-sunken
// меняются вместе с темой и палитрой (см. palettes.css), поэтому текстура подстраивается сама —
// ровно то, что просили: один тумблер, а не список вариантов на каждую палитру. И цветовой
// закон не нарушен: акцент и функциональные цвета сюда не заходят, работает только «земля».
//
// ⚠️ Шум — инлайновый SVG, а не картинка в бандле: фоновый файл пришлось бы тянуть сетью или
// класть в ресурсы, а он весь состоит из одного фильтра. baseFrequency крупная (0.9) — на мелкой
// сетке зерно сливается в грязь, на крупной читается как фактура бумаги.
// ⚠️ Непрозрачность 3.5%: на глаз это «плотность», а не «пятно». Всё, что заметно как рисунок,
// на вертикальной полосе с текстом начинает мешать читать заголовки вкладок.
// ⚠️ Сайдбар — ПОДЛОЖКА, а не остров: ни внешнего отступа, ни скругления, ни заливки, ни тени.
// Фон под ним даёт холст окна (--canvas на body), сайдбар прозрачен и лежит заподлицо с краем.
//
// Причина не в моде на Arc. В теме `--surface-island` и `--surface` — оба #FFFFFF, то есть остров
// сайдбара и страница были сделаны ИЗ ОДНОГО МАТЕРИАЛА, и различал их только 12-пиксельный зазор
// с тенью. Фигуры и фона не было — два одинаковых белых прямоугольника на сером. Теперь серым
// стал весь хром, а белой осталась только страница, ради которой браузер и открывают.
//
// ⚠️ Отсюда общее правило для всего, что рисуется внутри: НА ПОДЛОЖКЕ НЕЛЬЗЯ УХОДИТЬ ВГЛУБЬ СЕРЫМ.
// `--surface-sunken` (#E5E5EA) против `--app-bg` (#F2F2F7) — это контраст 1,13:1, то есть один и
// тот же цвет. Пассивное здесь прозрачно, активное поднимается белой карточкой. Значков это не
// касается: `--text-muted` даёт 4,7:1 на подложке против 5,2:1 на белом — просадка в десятую часть.
// ⚠️ overflow здесь БОЛЬШЕ НЕ hidden: он был нужен острову, чтобы содержимое не вылезало за
// скруглённые углы. Углов нет, а обрезка мешает — ручка ширины обязана выходить ЗА правую кромку
// (см. ниже), иначе её не за что взять.
const asideBase: React.CSSProperties = {
  flex: 'none', display: 'flex', flexDirection: 'column',
  background: 'transparent',
};

// ⚠️ Здесь был `innerPlate` — общая «внутренняя плашка» сайдбара (обойма закреплённых, пара в
// сплите, заголовок папки, «Новая вкладка»). Его больше НЕТ, и ни одного потребителя не осталось:
// поверхностей внутри сайдбара нет вовсе.
//
// Смысл правки не в том, что плашки были некрасивые, а в том, что панелью сайдбар делали именно
// они. Снятия внешнего острова не хватило: стопка белых карточек на белом читается как панель
// сама по себе — что с островом, что без. Ровно это и было видно в первой попытке, где «просто
// вернулась боковая панель».
//
// Что осталось из выделений и почему: АКТИВНАЯ вкладка (единственное состояние, которое обязано
// быть видно всегда), волосок вокруг пары в сплите (иначе две ячейки перестают читаться парой) и
// цветная заливка папки (это опознание, а не украшение). Всё остальное — прозрачное, отзыв только
// по наведению.

// Кнопка сайдбара — свернуть/развернуть панель, «Новая вкладка» в свёрнутом виде. БЕЗ плашки.
//
// ⚠️ Все они были белыми карточками (прежний floatingIconBtn, удалён). Вместе с обоймой
// закреплённых, дорожкой переключателя и «Новой вкладкой» во всю ширину именно из этих карточек
// сайдбар и складывался в «боковую панель» — независимо от того, есть у него внешний остров или
// нет. Поверхностей внутри сайдбара больше нет вовсе: всё лежит прямо на фоне окна, отзыв —
// только по наведению.
const utilIconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: 7,
  borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', display: 'inline-flex',
};

// Переключатель режима сайдбара. Намеренно КРОШЕЧНЫЙ: он не команда, а указатель «где я», и
// стоять рядом с полосой вкладок ему положено тише, чем самим вкладкам. Отсюда же подписи
// текстом, а не иконками: две иконки рядом (страница и звезда) в 20 px читаются хуже, чем два
// коротких слова, а места занимают столько же.
function ModeSwitch({ mode, onChange }: { mode: 'tabs' | 'bookmarks'; onChange: (m: 'tabs' | 'bookmarks') => void }) {
  const seg = (m: 'tabs' | 'bookmarks', label: string): React.ReactNode => {
    const active = mode === m;
    return (
      <button
        className="no-drag"
        onClick={() => onChange(m)}
        style={{
          flex: 1, border: 'none', cursor: 'default', padding: '4px 0',
          borderRadius: 'calc(var(--radius-sm) - 2px)',
          background: active ? 'var(--selected)' : 'transparent',
          boxShadow: active ? 'var(--shadow-card)' : 'none',
          color: active ? 'var(--text-strong)' : 'var(--text-muted)',
          fontSize: 'var(--fs-xs)', fontWeight: active ? 600 : 400,
          transition: 'background var(--dur-fast) var(--ease-standard)',
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'var(--selected)' : 'transparent'; }}
      >{label}</button>
    );
  };
  return (
    <div className="no-drag" style={{
      display: 'flex', gap: 2, padding: 2, marginBottom: 10,
      // ⚠️ Дорожка вернулась, но НЕ заливкой. Прежняя была --surface-sunken и против --app-bg
      // давала 1,13:1 — она просто исчезала, а на цветном сайдбаре читалась серой полосой из
      // другой темы; поэтому её и убрали совсем. Общий рецепт углубления держится СВЕТОМ (тень
      // внутрь + светлая кромка снизу) и выводит свою заливку из чернил палитры, поэтому виден
      // на любой земле. Тот же well() стоит под сегментами настроек — один элемент, не два.
      ...well(RADIUS.control),
    }}>
      {seg('tabs', 'Вкладки')}
      {seg('bookmarks', 'Закладки')}
    </div>
  );
}

/**
 * Подпись секции сайдбара: моноширинная капса и число рядом.
 *
 * ⚠️ Тот же приём, что на плитках стола и в настройках, и здесь он законен: капса — это ТИПОГРАФИКА,
 * а не цвет. Хром обязан молчать цветом, но не обязан быть безымянной простынёй — до этого
 * закреплённые и открытые вкладки шли одним потоком, и понять, где кончается одно и начинается
 * другое, можно было только по форме значков.
 */
function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="no-drag" style={{
      ...CAPS, color: 'var(--text-faint, var(--text-muted))',
      display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 4px',
    }}>
      <span>{children}</span>
      {count !== undefined && (
        <span style={{ color: 'var(--text-body)', fontWeight: 600 }}>{count}</span>
      )}
    </div>
  );
}

// Кнопка отката одного вида изменений. Подпись строится как «Вернуть …»: три отдельные
// формулировки в ряд читались бы длиннее, чем сама полоса вкладок.
function UndoChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="no-drag"
      onClick={onClick}
      title={`Вернуть ${label}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        border: 'none', background: 'var(--surface-sunken)', cursor: 'default',
        padding: '3px 8px', borderRadius: 'var(--radius-pill)',
        color: 'var(--text-body)', fontSize: 'var(--fs-xs)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-active)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
    >
      <RotateCcw {...glyph(10)} />
      {label}
    </button>
  );
}

export default function Sidebar({
  tabs, sidebarNodes, activeId, collapsed, onCollapsedChange,
  onSelect, onClose, onNewTab, onNewTabMenu, onTabMenu, onSplit, onExitSplit,
  onSettings, onHistory, onReorder, onMoveSection,
  onDropOnContent, returnHint,
  organizeTabsCount, organizeState, organizeLongWait, organizeProposal,
  hasOrganizeSnapshot, hasRenameSnapshot, renameProgress, undoDismissed,
  onOrganize, onOrganizeApply, onOrganizeCancel, onOrganizeRollback,
  onRenameRollback, onRollbackAll, onDismissUndo,
}: SidebarProps) {

  const dragOverPage = useTabDragOverPage();
  // Оптимистичный порядок: применяется сразу при drop, до ответа main.
  const [localPinnedOrder, setLocalPinnedOrder] = useState<string[] | null>(null);
  const [localOpenOrder,   setLocalOpenOrder]   = useState<string[] | null>(null);
  // ID группы, которая сейчас в режиме inline-переименования
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  // Что показывает сайдбар. Состояние взгляда, а не данных: переживать перезапуск ему незачем,
  // а по умолчанию браузер обязан открываться на вкладках.
  const [mode, setMode] = useState<'tabs' | 'bookmarks'>('tabs');
  // Ширина и жест её изменения — в useSidebarWidth. Там же разбор, почему pointermove висит на
  // документе, а не на самой ручке.
  const { width, onHandlePointerDown, onHandleDoubleClick } = useSidebarWidth();
  // ⚠️ «Новая вкладка» из режима закладок ВОЗВРАЩАЕТ к вкладкам. Кнопка и раньше была видна в
  // обоих режимах и честно открывала вкладку — но сайдбар оставался на закладках, где не видно
  // ни полосы вкладок, ни активной. Со стороны это читалось как «кнопка не сработала»: человек
  // жал, что-то происходило, а показать результат было негде.
  // Тот же приём, что у открытия самой закладки ниже (onOpen → setMode('tabs')) — одно правило
  // на все действия, которые уводят из закладок в работу с вкладками.
  const handleNewTab = () => {
    onNewTab();
    if (mode === 'bookmarks') setMode('tabs');
  };

  const REORDER_CONFIRM_MS = 3000;
  const openTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moveListenerRef   = useRef<((e: PointerEvent) => void) | null>(null);

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

  // Подписка на GROUP_RENAME_PROMPT: нативное меню просит начать inline-переименование
  useEffect(() => {
    return window.oblako.onGroupRenamePrompt((groupId) => setRenameGroupId(groupId));
  }, []);

  // Очистка таймаутов и pointermove-слушателя при размонтировании.
  useEffect(() => {
    return () => {
      if (openTimeoutRef.current)   clearTimeout(openTimeoutRef.current);
      if (pinnedTimeoutRef.current) clearTimeout(pinnedTimeoutRef.current);
      if (moveListenerRef.current) {
        document.removeEventListener('pointermove', moveListenerRef.current);
        moveListenerRef.current = null;
      }
    };
  }, []);

  const pinnedBase = tabs.filter((t) => t.isPinned && !t.isHub);

  // Карта tabId → TabState для O(1)-поиска (нужна до pinned: при активной оптимистике
  // ищем вкладку здесь, а не в pinnedBase — tabs ещё не обновился).
  const tabMap = new Map(tabs.map((t) => [t.id, t]));
  // Звук вкладки из СВЁРНУТОЙ полосы: там у ячейки нет ничего, кроме значка сайта, и значок
  // звука на нём — единственная кнопка, до которой можно дотянуться, не разворачивая панель.
  // Вторая дверь — пункт в меню по правой кнопке (electron/ipc/menus.ts).
  const toggleMute = (id: string): void => {
    const t = tabMap.get(id);
    if (t) void window.oblako.setTabMuted(id, !t.muted);
  };

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

  // PointerSensor с минимальным расстоянием активации: клики не превращаются в drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Droppable-контейнер секции «Открытые вкладки» для дропа из pinned в пустую секцию.
  const { setNodeRef: setNormalDropRef } = useDroppable({ id: SECTION_NORMAL_ID });

  const pinnedIds = pinned.map((t) => t.id);
  const openIds = (localOpenOrder ?? topLevelOpenIds).filter((id) => !effectivePinnedIds.has(id));

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
    finish: (e: DragEndEvent) => finishDrag().then((res) => applyZoneDrop(e, res)),
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
    setDragActiveId(null);
    return window.oblako.tabDragEnd().catch(() => ({ zone: null }));
  };

  // Сброс оптимистичного порядка вместе с таймерами подтверждения — нужен, когда дроп
  // оказался не перестановкой в сайдбаре, а split/выносом в окно (см. handleDragEnd).
  const revertLocalOrder = (): void => {
    if (openTimeoutRef.current)   { clearTimeout(openTimeoutRef.current);   openTimeoutRef.current   = null; }
    if (pinnedTimeoutRef.current) { clearTimeout(pinnedTimeoutRef.current); pinnedTimeoutRef.current = null; }
    setLocalOpenOrder(null);
    setLocalPinnedOrder(null);
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
    const commit = planReorder(e);
    void (async () => {
      const drop = await finishDrag();
      if (applyZoneDrop(e, drop)) { revertLocalOrder(); return; }
      commit?.();
    })();
  };

  /**
   * Исходы, которые перестановкой в сайдбаре не являются: split, вынос в новое окно, передача
   * в соседнее. Возвращает true, если дроп забрала зона, — тогда локальный порядок откатывается.
   */
  const applyZoneDrop = (e: DragEndEvent, { zone, windowId, side, replaceId }: TabDropResult): boolean => {
    const draggedId = e.active.id as string;
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
  };

  /**
   * Перестановка в сайдбаре: локальный порядок применяется СРАЗУ (ради анимации приземления,
   * см. handleDragEnd), а команду в main возвращаем отложенной — её отправит только тот, кто
   * дождался зоны. null — дроп ничего не меняет.
   */
  const planReorder = (e: DragEndEvent): (() => void) | null => {
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
        if (pinnedTimeoutRef.current) clearTimeout(pinnedTimeoutRef.current);
        if (openTimeoutRef.current)   clearTimeout(openTimeoutRef.current);
        setLocalPinnedOrder(newPinnedIds);
        setLocalOpenOrder(newOpenIds);
        pinnedTimeoutRef.current = setTimeout(() => { setLocalPinnedOrder(null); pinnedTimeoutRef.current = null; }, REORDER_CONFIRM_MS);
        openTimeoutRef.current   = setTimeout(() => { setLocalOpenOrder(null);   openTimeoutRef.current   = null; }, REORDER_CONFIRM_MS);
      } else {
        const newOpenIds   = openIds.filter((id) => id !== activeItemId);
        const newPinnedIds = [...pinnedIds];
        newPinnedIds.splice(targetIndex, 0, activeItemId);
        if (pinnedTimeoutRef.current) clearTimeout(pinnedTimeoutRef.current);
        if (openTimeoutRef.current)   clearTimeout(openTimeoutRef.current);
        setLocalOpenOrder(newOpenIds);
        setLocalPinnedOrder(newPinnedIds);
        openTimeoutRef.current   = setTimeout(() => { setLocalOpenOrder(null);   openTimeoutRef.current   = null; }, REORDER_CONFIRM_MS);
        pinnedTimeoutRef.current = setTimeout(() => { setLocalPinnedOrder(null); pinnedTimeoutRef.current = null; }, REORDER_CONFIRM_MS);
      }
      return () => onMoveSection(activeItemId, targetSection, targetIndex);
    }

    // ── Перемещение внутри секции ─────────────────────────────────────────
    if (isActivePinned) {
      const oldIdx = pinnedIds.indexOf(activeItemId);
      const newIdx = overIsPinnedTab ? pinnedIds.indexOf(overId) : -1;
      if (newIdx < 0 || oldIdx === newIdx) return null;
      const newOrder = arrayMove(pinnedIds, oldIdx, newIdx);
      if (pinnedTimeoutRef.current) clearTimeout(pinnedTimeoutRef.current);
      setLocalPinnedOrder(newOrder);
      pinnedTimeoutRef.current = setTimeout(() => {
        setLocalPinnedOrder(null);
        pinnedTimeoutRef.current = null;
      }, REORDER_CONFIRM_MS);
      return () => onReorder('pinned', newOrder);
    }

    const oldIdx = openIds.indexOf(activeItemId);
    const newIdx = overIsNormalItem ? openIds.indexOf(overId) : -1;
    if (newIdx < 0 || oldIdx === newIdx) return null;
    const newOrder = arrayMove(openIds, oldIdx, newIdx);
    if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
    setLocalOpenOrder(newOrder);
    openTimeoutRef.current = setTimeout(() => {
      setLocalOpenOrder(null);
      openTimeoutRef.current = null;
    }, REORDER_CONFIRM_MS);
    return () => onReorder('normal', newOrder);
  };

  // Возврат половины сплита: остров отзывается мягкой заливкой акцентом и волосяным кантом внутрь
  // (box-shadow, не border — рамка сдвинула бы раскладку). Тот же тихий язык, что у панели-цели в
  // рабочей области (src/dropzones.tsx): человек уже держит панель в руке, кричать не нужно.
  // Пунктир тут был и читался как ошибка валидации, а не как «сюда можно».
  //
  // ⚠️ ЗДЕСЬ БЫЛА ТЕНЬ ОСТРОВА, И ИМЕННО ОНА РИСОВАЛА РАЗДЕЛИТЕЛЬНУЮ ЛИНИЮ. Базовым значением
  // стояло `var(--shadow-island)` — отдавалось ВСЕГДА, а не только под подсветку. Из обоих
  // вызовов <aside> тень при переходе на подложку убрали, но она возвращалась сюда этим объектом,
  // и сайдбар продолжал отбрасывать тень на землю. Замер по пикселям снимка (y=400): земля
  // 242,242,247, на кромке сайдбара провал до 222,220,230 и осветление вправо до 233 — тень,
  // темнейшая У САМОЙ КРОМКИ, то есть отброшенная сайдбаром, а не карточкой страницы. Три захода
  // до этого искали виновника в цветах фона; нашёлся он замером, а не чтением.
  //
  // ⚠️ Базовое значение всё равно нужно — иначе переход не с чего начинать и подсветка появлялась
  // бы рывком. Поэтому база — ПРОЗРАЧНЫЙ кант той же формы: box-shadow от `none` не
  // интерполируется, а от `inset 0 0 0 1.5px transparent` к цветному — плавно.
  // ⚠️ Заливку акцентом НЕ трогаем: фон здесь — подкраска окна (см. chromeTint в styles/island.ts),
  // и подмена background его бы стёрла. Кант и без неё говорит достаточно, а слова несёт призрак
  // под курсором («Вернуть в панель», см. App.tsx).
  const returnHintStyle: React.CSSProperties = {
    boxShadow: returnHint
      ? 'inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 45%, transparent)'
      : 'inset 0 0 0 1.5px transparent',
    transition: 'box-shadow var(--dur-fast) var(--ease-standard)',
  };

  // ── Свёрнутый режим: узкая полоса иконок ──
  if (collapsed) {
    return (
      <aside className="drag" style={{ ...asideBase, width: 56, alignItems: 'center', padding: '16px 0 14px', ...returnHintStyle }}>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 14 }}>
          <button
            className="no-drag"
            onClick={() => onCollapsedChange(false)}
            title="Развернуть панель"
            style={{ ...utilIconBtn, transform: 'scaleX(-1)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
            // ⚠️ Возврат — к ПОДКРАШЕННОМУ фону, иначе кнопка после наведения навсегда белела.
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <PanelGlyph size={17} />
          </button>
        </div>

        {/* Тот же DndContext и те же обработчики, что в развёрнутой панели: id элементов
            совпадают (nodeToTopId), значит порядок, перенос между секциями и дроп в контент-зону
            (→ split) работают одинаково в обоих режимах. Ось тут ограничиваем всегда — обе
            секции в узкой полосе вертикальные, в отличие от сетки пинов в развёрнутой. */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => { void finishDrag(); }}
        >
          {pinned.length > 0 && (
            <div className="no-drag" style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '2px 0 6px', marginBottom: 6,
            }}>
              <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
                {pinned.map((t) => (
                  <SortableCollapsedItem key={t.id} id={t.id}>
                    <IconCell tab={t} active={activeId === t.id}
                      onClick={() => onSelect(t.id)}
                      onContextMenu={() => onTabMenu(t.id)}
                      onToggleMute={() => toggleMute(t.id)} />
                  </SortableCollapsedItem>
                ))}
              </SortableContext>
            </div>
          )}

          {/* Список вкладок. oblako-hide-scrollbar — полоса прокрутки съедала ~10px из 56 и
              дёргала центровку иконок при переполнении; сама прокрутка (колесо/тачпад) цела.
              Рисуем дерево (effectiveNodes), а не плоский tabs.filter: тот показывал вкладки из
              папок и split-пар вперемешку в порядке создания, а папок в свёрнутой панели не было
              вовсе — то есть свернуть панель означало потерять всю структуру. */}
          <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
            <div ref={setNormalDropRef} className="no-drag oblako-hide-scrollbar" style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              overflowY: 'auto', flex: 1, paddingTop: 4, width: '100%',
            }}>
              {effectiveNodes.map((node) => (
                node.type === 'group' ? (
                  <CollapsedGroupIsland
                    zone={childDragZone}
                    key={node.id}
                    group={node} tabMap={tabMap} activeId={activeId}
                    onSelect={onSelect} onClose={onClose} onTabMenu={onTabMenu}
                    onToggleMute={toggleMute}
                  />
                ) : (
                  <SortableCollapsedItem key={nodeToTopId(node)} id={nodeToTopId(node)}>
                    <CollapsedNodeCells
                      node={node} tabMap={tabMap} activeId={activeId}
                      onSelect={onSelect} onClose={onClose} onTabMenu={onTabMenu}
                      onToggleMute={toggleMute}
                    />
                  </SortableCollapsedItem>
                )
              ))}
            </div>
          </SortableContext>

          {/* Призраки — по тому же резолву типа узла, что и в развёрнутой панели
              (dragPinnedTab / dragNode), только в «иконочной» подаче. */}
          {!dragOverPage && <DragOverlay>
            {dragPinnedTab && (
              <div style={collapsedGhostPlate}>
                <IconCell tab={dragPinnedTab} active={activeId === dragPinnedTab.id} ghost />
              </div>
            )}
            {dragNode && dragNode.type !== 'group' && (
              <div style={collapsedGhostPlate}>
                <CollapsedNodeCells
                  node={dragNode} tabMap={tabMap} activeId={activeId}
                  onSelect={() => {}} onClose={() => {}} onTabMenu={() => {}}
                  ghost
                />
              </div>
            )}
            {dragGroup && (
              <div style={{ ...collapsedGhostPlate, padding: 5 }}>
                <FolderGlyph
                  tone={(dragGroup.color ? GROUP_COLORS[dragGroup.color] : null) ?? 'var(--text-muted)'}
                  size={18}
                />
              </div>
            )}
          </DragOverlay>}
        </DndContext>

        <div className="no-drag" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 8,
        }}>
          <button
            className="no-drag"
            title="Новая вкладка (ПКМ — инкогнито / восстановить)"
            // Тот же остров, что у развёрнутой «Новой вкладки»: главное действие панели.
            style={{ ...utilIconBtn, ...islandPlate, borderRadius: 'var(--radius-card)' }}
            onClick={handleNewTab}
            onContextMenu={(e) => { e.preventDefault(); onNewTabMenu(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--plate-bg, var(--surface))'; }}
          ><PlusGlyph size={17} /></button>
          <button className="icon-btn" title="История и закладки" style={iconBtn} onClick={onHistory}><ClockGlyph size={17} /></button>
          <button className="icon-btn" title="Настройки" style={iconBtn} onClick={onSettings}><SlidersGlyph size={17} /></button>
        </div>
      </aside>
    );
  }

  // ── Развёрнутый режим с drag-and-drop ──
  return (
    <aside className="drag chrome-icons" style={{ ...asideBase, width, padding: '12px 12px 14px 16px', position: 'relative', ...returnHintStyle }}>
      {/* Ручка ширины — прозрачная полоска. Своей заливки нет намеренно: видимая вертикальная
          черта читалась бы как рамка, а именно от рамок сайдбар и уходил. Курсор объясняет всё
          сам.
          ⚠️ Полоса вынесена ЗА правую кромку сайдбара и доведена до левого края карточки контента
          (right:-12 при зазоре --gutter-shell=12). Пока сайдбар был островом, у него была видимая
          кромка, и тянули за неё. Кромки больше нет — и человек тянет за край КАРТОЧКИ, потому что
          это единственная видимая граница в этом месте. Живая жалоба ровно про это: «курсор
          менялся, а реакции не было; оказалось, тянуть надо чуть левее».
          Дальше карточки полосу вести нельзя: там начинается нативная WebContentsView страницы,
          и события мыши до DOM уже не доходят. */}
      <div
        className="no-drag"
        onPointerDown={onHandlePointerDown}
        onDoubleClick={onHandleDoubleClick}
        title="Потяните, чтобы изменить ширину (двойной щелчок — вернуть)"
        style={{
          position: 'absolute', top: 0, right: -SIDEBAR_HANDLE_OUTSET, bottom: 0,
          width: SIDEBAR_HANDLE_OUTSET + 8,
          cursor: 'col-resize', zIndex: 5,
        }}
      />

      {/* Шапка */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0 14px' }}>
        <button
          className="no-drag"
          onClick={() => onCollapsedChange(true)}
          title="Свернуть панель"
          style={{ ...utilIconBtn }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <PanelGlyph size={17} />
        </button>
      </div>

      {/* ⚠️ Переключатель «Вкладки | Закладки» — ОДНА область сайдбара на две сущности, а не два
          похожих ряда иконок рядом. Именно поэтому сетку вверху нельзя спутать: в режиме вкладок
          там закреплённые СТРАНИЦЫ, в режиме закладок — ПАПКИ, и одновременно их не бывает. */}
      <ModeSwitch mode={mode} onChange={setMode} />

      {mode === 'bookmarks' && (
        <SidebarBookmarks onOpen={(url) => {
          void window.oblako.createTab(url);
          // ⚠️ Возврат к вкладкам сразу после открытия — ЗДЕСЬ, одной строкой, намеренно: в
          // режиме закладок не видно ни полосы вкладок, ни того, какая активна, и без возврата
          // человек теряет из виду, куда он вообще попал. Поведение пробное (открыть несколько
          // закладок подряд станет дороже на клик) — если не приживётся, убирается эта строка.
          setMode('tabs');
        }} />
      )}

      {/* Один внешний DndContext для обеих секций */}
      {mode === 'tabs' && (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        // Закреплённые выложены сеткой по горизонтали, и вертикальное ограничение делало их
        // перестановку между собой физически невозможной: модификатор режет X у transform, а
        // collisionDetection считает по СМЕЩЁННОМУ прямоугольнику — сосед справа никогда не
        // становился ближайшим, over всегда совпадал с active и drop уходил в no-op. Для пина
        // ось не ограничиваем (ему нужно и вбок, и вниз — в обычные), для списка оставляем.
        modifiers={dragPinnedTab ? [] : [restrictToVerticalAxis]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => { void finishDrag(); }}
      >
        {/* Закреплённые: сетка favicon, tooltip с заголовком, без крестика.
            Плашка-обёртка — СНАРУЖИ SortableContext, сам dnd-контекст и ячейки не тронуты. */}
        {pinned.length > 0 && (
          <div className="no-drag" style={{ padding: '2px 0 6px', marginBottom: 6 }}>
            <SectionLabel count={pinned.length}>Закреплённые</SectionLabel>
            {/* rect-, а не verticalList-стратегия: пины лежат сеткой с переносом строк, и
                вертикальная стратегия расталкивала соседей по Y — не в ту сторону, куда
                едет курсор. rectSortingStrategy считает по реальным прямоугольникам. */}
            <SortableContext items={pinnedIds} strategy={rectSortingStrategy}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {pinned.map((t) => (
                  <SortablePinCell key={t.id} tab={t} active={activeId === t.id}
                    onClick={() => onSelect(t.id)}
                    onContextMenu={() => onTabMenu(t.id)} />
                ))}
              </div>
            </SortableContext>
          </div>
        )}

        {/* ⚠️ Подпись СНАРУЖИ SortableContext: внутри он ждёт только сортируемые элементы, и
            лишний узел между ними сбивает расчёт позиций при перетаскивании. */}
        {effectiveNodes.length > 0 && organizeState !== 'preview' && (
          <SectionLabel count={openIds.length}>Открыто</SectionLabel>
        )}
        {/* Верхний уровень: singles, pairs, groups — все в одном SortableContext */}
        <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
          <div ref={setNormalDropRef} className="no-drag" style={{
            display: organizeState === 'preview' ? 'none' : 'flex',
            flexDirection: 'column', gap: 2, overflowY: 'auto',
            flex: organizeState === 'preview' ? 'none' : 1,
          }}>
            {effectiveNodes.length === 0 && (
              <div style={{ padding: '8px 10px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
                Пока пусто. Введите адрес в строке сверху.
              </div>
            )}
            {effectiveNodes.map((node) => {
              if (node.type === 'single') {
                const tab = tabMap.get(node.tabId);
                if (!tab) return null;
                return (
                  <SortableTabRow key={node.tabId} tab={tab} active={activeId === tab.id}
                    onClick={() => onSelect(tab.id)}
                    onClose={() => onClose(tab.id)}
                    onContextMenu={() => onTabMenu(tab.id)}
                    onSplit={() => onSplit(tab.id)}
                    onExitSplit={onExitSplit}
                    onToggleMute={() => void window.oblako.setTabMuted(tab.id, !tab.muted)} />
                );
              }
              if (node.type === 'split-pair') {
                const left = tabMap.get(node.leftTabId);
                const right = tabMap.get(node.rightTabId);
                if (!left || !right) return null;
                return (
                  <SortablePairBlock
                    key={node.leftTabId}
                    left={left} right={right}
                    activeId={activeId}
                    onSelect={onSelect} onClose={onClose}
                    onContextMenu={onTabMenu} onExitSplit={onExitSplit}
                  />
                );
              }
              if (node.type === 'group') {
                return (
                  <SortableGroupBlock
                    key={node.id}
                    zone={childDragZone}
                    group={node}
                    tabMap={tabMap}
                    activeId={activeId}
                    onSelect={onSelect} onClose={onClose}
                    onContextMenu={onTabMenu} onSplit={onSplit}
                    onExitSplit={onExitSplit}
                    renameGroupId={renameGroupId}
                    setRenameGroupId={setRenameGroupId}
                  />
                );
              }
              return null;
            })}
          </div>
        </SortableContext>

        {/* DragOverlay: ghost-копия перетаскиваемого элемента, по РЕАЛЬНОМУ типу узла
            (dragNode/findNodeByTopId выше) — не по виду id. Одиночная — TabRow;
            пара — PairTile (две ячейки); группа — минимальный заголовок. */}
        {!dragOverPage && <DragOverlay>
          {dragPinnedTab && (
            <div style={{
              boxShadow: 'var(--shadow-card)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              opacity: 0.95,
              display: 'inline-flex',
            }}>
              <IconCell tab={dragPinnedTab} active={activeId === dragPinnedTab.id} ghost />
            </div>
          )}
          {dragTab && (
            <div style={{
              boxShadow: 'var(--shadow-card)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              opacity: 0.95,
            }}>
              <TabRow
                tab={dragTab}
                active={activeId === dragTab.id}
                onClick={() => {}}
                onClose={() => {}}
                onContextMenu={() => {}}
                ghost
              />
            </div>
          )}
          {dragPairTabs && (
            <div style={{
              boxShadow: 'var(--shadow-card)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              opacity: 0.95,
            }}>
              <PairTile
                left={dragPairTabs.left}
                right={dragPairTabs.right}
                activeId={activeId}
                onSelect={() => {}}
                onClose={() => {}}
                onContextMenu={() => {}}
                onExitSplit={() => {}}
                ghost
              />
            </div>
          )}
          {dragGroup && (
            <div style={{
              boxShadow: 'var(--shadow-card)', borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)', opacity: 0.95,
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px',
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%', flex: 'none',
                background: dragGroup.color ? (GROUP_COLORS[dragGroup.color] ?? 'transparent') : 'transparent',
                border: dragGroup.color ? 'none' : '1.5px solid var(--text-faint)',
              }} />
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-body)' }}>
                {dragGroup.label}
              </span>
            </div>
          )}
        </DragOverlay>}
      </DndContext>
      )}

      {/* ── Превью AI-группировки: заменяет список вкладок ── */}
      {mode === 'tabs' && organizeState === 'preview' && (
        <div className="no-drag" style={{
          flex: 1, display: 'flex', flexDirection: 'column', gap: 0,
          overflow: 'hidden', marginTop: 4,
        }}>
          <div style={eyebrow}>
            Предложение: {organizeProposal.length} {organizeProposal.length === 1 ? 'группа' : organizeProposal.length < 5 ? 'группы' : 'групп'}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {organizeProposal.map((p, i) => (
              <div key={i} style={{
                border: '1px solid var(--divider-strong)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '6px 10px', background: 'var(--surface-hover)',
                }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%', flex: 'none',
                    background: 'var(--accent)',
                  }} />
                  <span style={{
                    flex: 1, fontWeight: 600, fontSize: 'var(--fs-sm)',
                    color: 'var(--text-strong)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{p.suggestedName}</span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flex: 'none' }}>
                    {p.nodeIds.length}
                  </span>
                </div>
                <div style={{ padding: '4px 10px 6px' }}>
                  {p.titles.slice(0, 4).map((t, j) => (
                    <div key={j} style={{
                      fontSize: 'var(--fs-xs)', color: 'var(--text-body)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      padding: '1px 0',
                    }}>• {t}</div>
                  ))}
                  {p.titles.length > 4 && (
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', padding: '1px 0' }}>
                      и ещё {p.titles.length - 4}…
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '8px 0 4px', flexShrink: 0 }}>
            <button
              className="no-drag"
              onClick={onOrganizeApply}
              style={{
                flex: 1, padding: '8px 0', border: 'none', cursor: 'default',
                borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: 'var(--on-accent)',
                fontSize: 'var(--fs-sm)', fontWeight: 600,
              }}
            >Применить</button>
            <button
              className="no-drag"
              onClick={onOrganizeCancel}
              style={{
                flex: 'none', padding: '8px 14px', border: 'none', cursor: 'default',
                borderRadius: 'var(--radius-sm)', background: 'transparent',
                color: 'var(--text-muted)', fontSize: 'var(--fs-sm)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >Отмена</button>
          </div>
        </div>
      )}

      {/* ── Кнопка «Навести порядок» — только в обычном режиме, > 10 вкладок ──
          ⚠️ И только в режиме вкладок: она группирует ВКЛАДКИ, и висеть над списком закладок ей
          нечего — там она обещает не то, что делает. Умная раскладка закладок живёт в своём
          разделе и своей кнопкой (см. Bookmarks.tsx). */}
      {mode === 'tabs' && organizeState !== 'preview' && organizeTabsCount > 10 && (
        <button
          className="no-drag"
          onClick={organizeState === 'idle' || organizeState === 'model-error' ? onOrganize : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 4,
            padding: '9px 12px', border: 'none', cursor: 'default',
            borderRadius: 'var(--radius-sm)',
            background: organizeState === 'computing' ? 'var(--surface-hover)' : 'transparent',
            fontWeight: 500, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)',
          }}
          onMouseEnter={(e) => { if (organizeState === 'idle' || organizeState === 'model-error') e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { if (organizeState === 'idle' || organizeState === 'model-error') e.currentTarget.style.background = 'transparent'; }}
        >
          {organizeState === 'computing' ? (
            <>
              <span style={{
                width: 14, height: 14, flex: 'none', borderRadius: '50%',
                border: '2px solid var(--divider-strong)', borderTopColor: 'var(--accent)',
                animation: 'oblako-spin 0.7s linear infinite',
              }} />
              {organizeLongWait ? 'Модель загружается в память, это займёт около минуты, потерпите' : 'Читаю вкладки…'}
            </>
          ) : organizeState === 'model-error' ? (
            <>
              <span style={{ fontSize: 'var(--fs-sm)', lineHeight: 1 }}>⚠</span>
              Повторить
            </>
          ) : (
            <>
              <SparkGlyph size={16} />
              Навести порядок
            </>
          )}
        </button>
      )}

      {/* ── Идёт переименование: видно, что порядок наводится, и сколько осталось ── */}
      {renameProgress && (
        <div className="no-drag" style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 4,
          padding: '6px 10px', background: 'var(--surface-hover)',
          borderRadius: 'var(--radius-sm)', border: '1px solid var(--divider-strong)',
        }}>
          <span style={{
            width: 12, height: 12, flex: 'none', borderRadius: '50%',
            border: '2px solid var(--divider-strong)', borderTopColor: 'var(--accent)',
            animation: 'oblako-spin 0.7s linear infinite',
          }} />
          <span style={{ flex: 1, fontSize: 'var(--fs-xs)', color: 'var(--text-body)' }}>
            Придумываю названия… {renameProgress.done} из {renameProgress.total}
          </span>
        </div>
      )}

      {/* ── Баннер отката. Показывается после «навести порядок» и гаснет сам через 15 секунд
             (см. App.tsx): раньше он висел до первого ручного изменения, то есть в спокойном
             сеансе — бесконечно. Откаты раздельные: человеку может понравиться раскладка по
             группам, но не понравиться новые названия. ── */}
      {organizeState === 'idle' && !renameProgress && !undoDismissed
        && (hasOrganizeSnapshot || hasRenameSnapshot) && (
        <div className="no-drag" style={{
          display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4,
          padding: '8px 10px',
          background: 'var(--surface-hover)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--divider-strong)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, fontSize: 'var(--fs-xs)', color: 'var(--text-body)' }}>
              {hasOrganizeSnapshot && hasRenameSnapshot ? 'Порядок наведён'
                : hasOrganizeSnapshot ? 'Вкладки сгруппированы'
                : 'Вкладки переименованы'}
            </span>
            <button
              className="no-drag"
              onClick={onDismissUndo}
              title="Скрыть"
              style={{
                border: 'none', background: 'transparent', cursor: 'default',
                padding: 2, borderRadius: RADIUS.tight, color: 'var(--text-faint)', display: 'inline-flex', flex: 'none',
              }}
            ><CloseGlyph size={11} /></button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {hasRenameSnapshot && (
              <UndoChip label="названия" onClick={onRenameRollback} />
            )}
            {hasOrganizeSnapshot && (
              <UndoChip label="группы" onClick={onOrganizeRollback} />
            )}
            {hasOrganizeSnapshot && hasRenameSnapshot && (
              <UndoChip label="всё" onClick={onRollbackAll} />
            )}
          </div>
        </div>
      )}

      {/* «Новая вкладка» — отдельная плашка-остров; история/настройки — лёгкие иконки рядом,
          НЕ часть плашки (не сливаются в общую пластину). */}
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <button className="no-drag" title="Новая вкладка (ПКМ — инкогнито / восстановить)"
          // ⚠️ ОСТРОВ здесь уместен и остаётся. Единая земля — это про ФОН, а не про запрет
          // поверхностей вообще: главное действие панели имеет право быть выпуклой кнопкой.
          // Убирать надо было обоймы-контейнеры (пины, папки, подкраску сайдбара), которые
          // складывались в боковую плашку, — а не отдельные органы управления.
          style={{
            ...islandPlate, borderRadius: 'var(--radius-card)',
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', color: 'var(--text-muted)', cursor: 'default',
          }}
          onClick={handleNewTab}
          onContextMenu={(e) => { e.preventDefault(); onNewTabMenu(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--plate-bg, var(--surface))'; }}
        >
          <PlusGlyph size={17} />
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>Новая вкладка</span>
        </button>
        <button className="no-drag icon-btn" title="История и закладки" style={iconBtn} onClick={onHistory}><ClockGlyph size={17} /></button>
        <button className="no-drag icon-btn" title="Настройки" style={iconBtn} onClick={onSettings}><SlidersGlyph size={17} /></button>
      </div>
    </aside>
  );
}

const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: 6,
  borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', display: 'inline-flex',
};
const eyebrow: React.CSSProperties = {
  fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
  textTransform: 'uppercase', color: 'var(--text-faint)', padding: '0 10px 6px',
};
