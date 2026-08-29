import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TabState, GroupNode, SidebarNode } from '../../../shared/ipc';
import { RADIUS, glyph } from '../../styles/system';
import { GROUP_COLORS } from './groupColors';
import { useTabDragOverPage } from './useTabDragOverPage';
import { useGroupChildOrder, type ChildDragZone } from './useGroupChildOrder';
import { TabRow, SortableTabRow, PairTile, SortablePairBlock } from './rows';

export interface GroupBlockProps {
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

export function SortableGroupBlock({
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

      {/* Дети группы — свой DndContext и свой DragOverlay, см. GroupChildren. */}
      {!group.collapsed && (
        <GroupChildren
          tabMap={tabMap} activeId={activeId}
          onSelect={onSelect} onClose={onClose} onContextMenu={onContextMenu}
          onSplit={onSplit} onExitSplit={onExitSplit}
          innerSensors={innerSensors}
          effectiveChildIds={effectiveChildIds} effectiveChildren={effectiveChildren}
          onChildDragStart={handleChildDragStart}
          onChildDragEnd={handleChildDragEnd}
          onChildDragCancel={handleChildDragCancel}
          dragOverPage={dragOverPage}
          dragChildTab={dragChildTab} dragChildPairTabs={dragChildPairTabs}
        />
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

// ⚠️ Вынесено из SortableGroupBlock отдельной функцией, а не «для красоты»: сторож структуры не
// пускает новый файл с функцией длиннее 200 строк, и это тот случай, когда он прав — заголовок
// группы и список её детей связаны только тем, что нарисованы рядом.
interface GroupChildrenProps {
  tabMap: Map<string, TabState>;
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (id: string) => void;
  onSplit: (id: string) => void;
  onExitSplit: (id: string) => void;
  innerSensors: ReturnType<typeof useSensors>;
  effectiveChildIds: string[];
  effectiveChildren: SidebarNode[];
  onChildDragStart: (id: string) => void;
  onChildDragEnd: (e: DragEndEvent) => void;
  onChildDragCancel: () => void;
  dragOverPage: boolean;
  dragChildTab: TabState | null;
  dragChildPairTabs: { left: TabState; right: TabState } | null;
}

function GroupChildren({
  tabMap, activeId, onSelect, onClose, onContextMenu, onSplit, onExitSplit,
  innerSensors, effectiveChildIds, effectiveChildren,
  onChildDragStart, onChildDragEnd, onChildDragCancel,
  dragOverPage, dragChildTab, dragChildPairTabs,
}: GroupChildrenProps) {
  return (
        <DndContext
          sensors={innerSensors}
          collisionDetection={closestCenter}
          // ⚠️ restrictToVerticalAxis снят намеренно: он запирал призрак в колонке, и утащить
          // вкладку из папки на страницу было физически некуда — жест выглядел невозможным. Порядок
          // внутри папки считает verticalListSortingStrategy, модификатор влиял лишь на картинку.
          onDragStart={(e) => onChildDragStart(e.active.id as string)}
          onDragEnd={onChildDragEnd}
          onDragCancel={onChildDragCancel}
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
  );
}
