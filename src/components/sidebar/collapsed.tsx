import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TabState, SidebarNode, GroupNode } from '../../../shared/ipc';
import { IconCell } from './rows';
import { nodeToTopId } from './nodeIds';
import { useTabDragOverPage } from './useTabDragOverPage';
import { GROUP_COLORS } from './groupColors';
import { DragGhostPlate } from './DragGhostPlate';
import { useGroupChildOrder, type ChildDragZone } from './useGroupChildOrder';

// ── Свёрнутая панель ──────────────────────────────────────────────────────────
// Глиф папки в духе системной иконки macOS: не контур в одну линию, а две залитые стенки —
// задняя с язычком и передняя поверх неё. Объём даётся ВТОРЫМ ТОНОМ, а не тенью: передняя
// стенка — тот же цвет, подмешанный к фону (color-mix), то есть непрозрачный светлый оттенок.
// Полупрозрачность тут не годится — на перекрытии двух слоёв она давала бы третий, грязный тон.
//
// tone — цвет папки (или нейтральный токен) ЯВНЫМ значением, а не через currentColor:
// подмешивание идёт тем же color-mix, что уже держит заливку острова, и в этой форме
// (конкретный цвет + var(--surface)) оно в проекте проверено.
export function FolderGlyph({ tone, size = 18, open }: { tone: string; size?: number; open?: boolean }) {
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
export const nodesContainTab = (nodes: SidebarNode[], tabId: string): boolean =>
  nodes.some((n) =>
    n.type === 'single' ? n.tabId === tabId
    : n.type === 'split-pair' ? n.leftTabId === tabId || n.rightTabId === tabId
    : nodesContainTab(n.children, tabId));

// Обёртка призрака DragOverlay — одна на все «иконочные» призраки свёрнутой полосы.
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
export function CollapsedPairTile({ left, right, activeId, onSelect, onClose, onTabMenu, onToggleMute, ghost }: {
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
export function CollapsedNodeCells({ node, tabMap, activeId, onSelect, onClose, onTabMenu, onToggleMute, ghost }: CollapsedCellsProps) {
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
export function SortableCollapsedItem({ id, children }: { id: string; children: React.ReactNode }) {
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
export function CollapsedGroupIsland({ group, tabMap, activeId, onSelect, onClose, onTabMenu, onToggleMute, zone }: {
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
                <DragGhostPlate inline>
                  <CollapsedNodeCells
                    node={dragChild} tabMap={tabMap} activeId={activeId}
                    onSelect={() => {}} onClose={() => {}} onTabMenu={() => {}}
                    ghost
                  />
                </DragGhostPlate>
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
