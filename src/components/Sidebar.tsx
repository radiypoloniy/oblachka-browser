import { useState, useEffect, useRef } from 'react';
import { PanelLeft, Plus, Settings, X, Cloud, Columns2, Moon, Clock, ChevronRight, ChevronDown, Sparkles, RotateCcw } from 'lucide-react';
import type { ClusterProposal } from '../services/ClusteringService';
import {
  DndContext, DragOverlay,
  PointerSensor, useSensor, useSensors,
  closestCenter, useDroppable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import type { TabState, SidebarNode, GroupNode } from '../../shared/ipc';

// Стабильный id droppable-контейнера секции «Открытые вкладки».
const SECTION_NORMAL_ID = 'drop-section-normal';

// ID для dnd-kit: single → tabId, pair → leftTabId, group → 'group:${id}'
const nodeToTopId = (node: SidebarNode): string =>
  node.type === 'single' ? node.tabId
  : node.type === 'split-pair' ? node.leftTabId
  : `group:${node.id}`;

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
  onTabMenu: (id: string) => void;
  onSplit: (id: string) => void;
  onExitSplit: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onReorder: (section: 'normal' | 'pinned', orderedIds: string[]) => void;
  onMoveSection: (tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number) => void;
  getContentRect: () => DOMRect | null;
  onDragOverContent: (over: boolean) => void;
  onDropOnContent: (tabId: string) => void;
  // AI-группировка
  organizeTabsCount: number;
  organizeState: 'idle' | 'computing' | 'preview' | 'model-error';
  organizeProposal: ClusterProposal[];
  hasOrganizeSnapshot: boolean;
  onOrganize: () => void;
  onOrganizeApply: () => void;
  onOrganizeCancel: () => void;
  onOrganizeRollback: () => void;
}

function FaviconTile({ tab, size = 16 }: { tab: TabState; size?: number }) {
  if (tab.isHub) {
    return (
      <span style={{
        width: size + 6, height: size + 6, borderRadius: 'var(--radius-sm)',
        background: 'var(--accent)', display: 'inline-flex', flex: 'none',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Cloud size={size} color="#fff" />
      </span>
    );
  }

  const tileSize = size + 6;
  let inner: React.ReactNode;
  if (tab.faviconUrl) {
    inner = (
      <img src={tab.faviconUrl} width={tileSize} height={tileSize}
        style={{ borderRadius: 'var(--radius-sm)', objectFit: 'cover', opacity: tab.isSleeping ? 0.45 : 1 }}
        alt="" />
    );
  } else {
    let host = '?';
    try { host = new URL(tab.url).hostname.replace('www.', '')[0]?.toUpperCase() ?? '?'; }
    catch { /* about:blank и т.п. */ }
    inner = (
      <span style={{
        width: tileSize, height: tileSize, borderRadius: 'var(--radius-sm)',
        background: 'var(--neutral-300)', color: 'var(--text-body)', flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600, opacity: tab.isSleeping ? 0.45 : 1,
      }}>{host}</span>
    );
  }

  if (!tab.isSleeping) return <>{inner}</>;

  return (
    <span style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}>
      {inner}
      <Moon size={8} style={{
        position: 'absolute', bottom: -1, right: -1,
        color: 'var(--text-faint)', background: 'var(--surface-island)',
        borderRadius: '50%', padding: 1,
      }} />
    </span>
  );
}

interface TabRowProps {
  tab: TabState;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
  onContextMenu: () => void;
  onSplit?: () => void;
  onExitSplit?: () => void;
  // Во время DragOverlay-рендера кнопки не нужны (ghost — только визуал).
  ghost?: boolean;
  // Скрывает «открыть рядом», пока split уже активен (избегаем молчаливого no-op).
  splitActive?: boolean;
}

function TabRow({ tab, active, onClick, onClose, onContextMenu, onSplit, onExitSplit, ghost, splitActive }: TabRowProps) {
  const [hovered, setHovered] = useState(false);
  const inSplit = tab.splitSide !== null;
  const bg = active ? 'var(--surface)'
    : inSplit ? 'var(--surface-hover)'
    : hovered  ? 'var(--surface-hover)'
    : 'transparent';

  return (
    <div
      onClick={ghost ? undefined : onClick}
      onContextMenu={ghost ? undefined : (e) => { e.preventDefault(); onContextMenu(); }}
      onMouseDown={ghost ? undefined : (e) => {
        if (e.button === 1) { e.preventDefault(); if (!tab.isHub && !tab.isPinned) onClose(); }
      }}
      onMouseEnter={ghost ? undefined : () => setHovered(true)}
      onMouseLeave={ghost ? undefined : () => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
        borderRadius: 'var(--radius-sm)', cursor: 'default',
        background: bg,
        boxShadow: active ? 'var(--shadow-card)' : 'none',
        color: active ? 'var(--text-strong)' : 'var(--text-body)',
        opacity: tab.isSleeping ? 0.6 : 1,
        transition: ghost ? undefined : 'background var(--dur-fast) var(--ease-standard)',
      }}
    >
      <FaviconTile tab={tab} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: active ? 600 : 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{tab.title || tab.url || 'Загрузка…'}</span>

      {tab.isLoading && !tab.isSleeping && (
        <span style={{
          width: 12, height: 12, flex: 'none', borderRadius: '50%',
          border: '2px solid var(--divider-strong)', borderTopColor: 'var(--accent)',
          animation: 'oblako-spin 0.7s linear infinite',
        }} />
      )}

      {!ghost && inSplit && onExitSplit && (
        <button
          className="no-drag"
          onClick={(e) => { e.stopPropagation(); onExitSplit(); }}
          title="Выйти из split (обе вкладки останутся)"
          style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: 4, display: 'inline-flex', color: 'var(--accent)', flex: 'none' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><Columns2 size={12} /></button>
      )}

      {!ghost && hovered && !tab.isHub && !tab.isPinned && !inSplit && !active && !splitActive && onSplit && (
        <button
          className="no-drag"
          onClick={(e) => { e.stopPropagation(); onSplit(); }}
          title="Открыть рядом"
          style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: 4, display: 'inline-flex', color: 'var(--text-faint)', flex: 'none' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><Columns2 size={14} /></button>
      )}

      {!ghost && !tab.isHub && !tab.isPinned && (
        <button
          className="no-drag"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Закрыть вкладку"
          style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: 4, display: 'inline-flex', color: 'var(--text-faint)', flex: 'none' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><X size={14} /></button>
      )}
    </div>
  );
}

// Обёртка для drag-and-drop одного ряда.
// disabled=true когда вкладка в split: tab.splitSide реактивен (обновляется при TABS_CHANGED),
// поэтому disabled корректно пересчитывается при входе/выходе из split.
function SortableTabRow(props: TabRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.tab.id,
    disabled: props.tab.splitSide !== null,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Исходный элемент прозрачен пока drag активен — DragOverlay рисует ghost.
        opacity: isDragging ? 0 : 1,
        flexShrink: 0,
      }}
      {...attributes}
      {...listeners}
    >
      <TabRow {...props} />
    </div>
  );
}

// Split-пара как единый неперетаскиваемый блок (drag разблокируется в 2c).
// Arc-стиль: одна горизонтальная строка с двумя mini-ячейками.
function SortablePairBlock({ left, right, activeId, onSelect, onClose, onContextMenu, onExitSplit }: {
  left: TabState;
  right: TabState;
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (id: string) => void;
  onExitSplit: () => void;
}) {
  const [hoveredSide, setHoveredSide] = useState<'left' | 'right' | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: left.id,
    disabled: true,
  });

  const leftActive  = activeId === left.id;
  const rightActive = activeId === right.id;
  const leftShowExit  = leftActive || !rightActive;
  const rightShowExit = rightActive;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        display: 'flex', alignItems: 'stretch',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--divider-strong)',
        overflow: 'hidden',
        flexShrink: 0,
        minHeight: 36,
      }}
      {...attributes}
      {...listeners}
    >
      {/* Левая ячейка */}
      <div
        onClick={() => { if (!leftActive) onSelect(left.id); }}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(left.id); }}
        onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(left.id); } }}
        onMouseEnter={() => setHoveredSide('left')}
        onMouseLeave={() => setHoveredSide(null)}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 4,
          padding: '0 8px', minWidth: 0, cursor: 'default',
          background: leftActive ? 'var(--surface)' : 'transparent',
          boxShadow: leftActive ? 'var(--shadow-card)' : 'none',
        }}
      >
        <FaviconTile tab={left} size={12} />
        <span style={{
          flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)',
          fontWeight: leftActive ? 600 : 500,
          color: leftActive ? 'var(--text-strong)' : 'var(--text-body)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{left.title || left.url || 'Загрузка…'}</span>
        {leftShowExit && (
          <button
            className="no-drag"
            onClick={(e) => { e.stopPropagation(); onExitSplit(); }}
            title="Выйти из split (обе вкладки останутся)"
            style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: 4, display: 'inline-flex', flex: 'none', color: 'var(--accent)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          ><Columns2 size={12} /></button>
        )}
        {hoveredSide === 'left' && (
          <button
            className="no-drag"
            onClick={(e) => { e.stopPropagation(); onClose(left.id); }}
            title="Закрыть левую панель"
            style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: 4, display: 'inline-flex', flex: 'none', color: 'var(--text-faint)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          ><X size={12} /></button>
        )}
      </div>

      {/* Вертикальный разделитель */}
      <div style={{ width: 1, background: 'var(--divider-strong)', alignSelf: 'stretch', margin: '4px 0', flex: 'none' }} />

      {/* Правая ячейка */}
      <div
        onClick={() => { if (!rightActive) onSelect(right.id); }}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(right.id); }}
        onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(right.id); } }}
        onMouseEnter={() => setHoveredSide('right')}
        onMouseLeave={() => setHoveredSide(null)}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 4,
          padding: '0 8px', minWidth: 0, cursor: 'default',
          background: rightActive ? 'var(--surface)' : 'transparent',
          boxShadow: rightActive ? 'var(--shadow-card)' : 'none',
        }}
      >
        <FaviconTile tab={right} size={12} />
        <span style={{
          flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)',
          fontWeight: rightActive ? 600 : 500,
          color: rightActive ? 'var(--text-strong)' : 'var(--text-body)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{right.title || right.url || 'Загрузка…'}</span>
        {rightShowExit && (
          <button
            className="no-drag"
            onClick={(e) => { e.stopPropagation(); onExitSplit(); }}
            title="Выйти из split (обе вкладки останутся)"
            style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: 4, display: 'inline-flex', flex: 'none', color: 'var(--accent)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          ><Columns2 size={12} /></button>
        )}
        {hoveredSide === 'right' && (
          <button
            className="no-drag"
            onClick={(e) => { e.stopPropagation(); onClose(right.id); }}
            title="Закрыть правую панель"
            style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: 4, display: 'inline-flex', flex: 'none', color: 'var(--text-faint)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          ><X size={12} /></button>
        )}
      </div>
    </div>
  );
}

// Ячейка сетки закреплённых: favicon + tooltip, без крестика.
// DnD сохраняется — перетаскивание для изменения порядка пинов.
function SortablePinCell({ tab, active, onClick, onContextMenu }: {
  tab: TabState; active: boolean;
  onClick: () => void; onContextMenu: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }} {...attributes} {...listeners}>
      <button
        className="no-drag"
        onClick={onClick}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(); }}
        title={tab.title || tab.url || ''}
        style={{
          border: 'none', cursor: 'default', padding: 5, borderRadius: 'var(--radius-sm)',
          background: active ? 'var(--surface)' : 'transparent',
          boxShadow: active ? 'var(--shadow-card)' : 'none',
          opacity: tab.isSleeping ? 0.6 : 1, display: 'inline-flex',
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'var(--surface)' : 'transparent'; }}
      >
        <FaviconTile tab={tab} size={18} />
      </button>
    </div>
  );
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
  onExitSplit: () => void;
  splitActive: boolean;
  renameGroupId: string | null;
  setRenameGroupId: (id: string | null) => void;
}

function SortableGroupBlock({
  group, tabMap, activeId, onSelect, onClose, onContextMenu,
  onSplit, onExitSplit, splitActive, renameGroupId, setRenameGroupId,
}: GroupBlockProps) {
  const innerSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [localChildOrder, setLocalChildOrder] = useState<string[] | null>(null);
  const [renameValue, setRenameValue] = useState(group.label);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const isRenaming = renameGroupId === group.id;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `group:${group.id}`,
  });

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

  const effectiveChildIds = localChildOrder ?? childIds;
  const childNodeById = new Map<string, SidebarNode>();
  for (const child of group.children) {
    childNodeById.set(nodeToTopId(child), child);
  }
  const effectiveChildren = effectiveChildIds
    .map((id) => childNodeById.get(id))
    .filter((n): n is SidebarNode => n !== undefined);

  const handleChildDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = effectiveChildIds.indexOf(active.id as string);
    const to   = effectiveChildIds.indexOf(over.id as string);
    if (from < 0 || to < 0 || from === to) return;
    const newOrder = arrayMove(effectiveChildIds, from, to);
    setLocalChildOrder(newOrder);
    void window.oblako.reorderGroupChildren(group.id, newOrder);
  };

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
      {/* Заголовок группы — drag handle (listeners отключены при переименовании) */}
      <div
        {...attributes}
        {...(isRenaming ? {} : listeners)}
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
              borderRadius: 4, padding: '1px 6px', color: 'var(--text-strong)',
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
            padding: 2, borderRadius: 4, display: 'inline-flex', flex: 'none',
            color: 'var(--text-faint)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {group.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Дети группы с собственным DndContext для внутренней сортировки */}
      {!group.collapsed && (
        <DndContext
          sensors={innerSensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleChildDragEnd}
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
                      splitActive={splitActive}
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
        </DndContext>
      )}
    </div>
  );
}

// Частичный остров (заход): воздух сверху/снизу/слева через margin (--gutter-shell), высота —
// НЕ фикс. height:100% (тот вместе с margin переполнил бы флекс-строку и обрезался бы снизу
// родительским overflow:hidden в App.tsx) — вместо этого убрали height и отдали расчёт дефолтному
// align-items:stretch родителя, который сам вычитает margin-top/bottom из доступной высоты.
// Справа — воздуха нет (borderRadius только у левых углов): та сторона всё ещё вплотную к контенту
// (bounds WebContentsView в этом заходе не трогаем, см. CLAUDE.md/задачу), полный остров — отдельный
// будущий заход. Тень/скругление — токены из shadows.css/radii.css («Use for islands»), не свои.
const asideBase: React.CSSProperties = {
  flex: 'none', display: 'flex', flexDirection: 'column',
  margin: 'var(--gutter-shell) 0 var(--gutter-shell) var(--gutter-shell)',
  borderRadius: 'var(--radius-island) 0 0 var(--radius-island)',
  background: 'var(--surface-island)',
  backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)',
  boxShadow: 'var(--shadow-island)',
  overflow: 'hidden',
};

export default function Sidebar({
  tabs, sidebarNodes, activeId, collapsed, onCollapsedChange,
  onSelect, onClose, onNewTab, onTabMenu, onSplit, onExitSplit,
  onSettings, onHistory, onReorder, onMoveSection,
  getContentRect, onDragOverContent, onDropOnContent,
  organizeTabsCount, organizeState, organizeProposal,
  hasOrganizeSnapshot, onOrganize, onOrganizeApply, onOrganizeCancel, onOrganizeRollback,
}: SidebarProps) {

  // Оптимистичный порядок: применяется сразу при drop, до ответа main.
  const [localPinnedOrder, setLocalPinnedOrder] = useState<string[] | null>(null);
  const [localOpenOrder,   setLocalOpenOrder]   = useState<string[] | null>(null);
  // ID группы, которая сейчас в режиме inline-переименования
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);

  const REORDER_CONFIRM_MS = 3000;
  const openTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentOverRef    = useRef(false);
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
  // При любом активном split прячем кнопку «открыть рядом» на обычных вкладках.
  const anySplitActive = tabs.some((t) => t.splitSide !== null);

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

  // ID активного drag-элемента (может быть tabId или 'group:${id}')
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const dragTab: TabState | null = (dragActiveId && !dragActiveId.startsWith('group:'))
    ? (tabs.find((t) => t.id === dragActiveId) ?? null)
    : null;
  const dragGroup: GroupNode | null = (() => {
    if (!dragActiveId?.startsWith('group:')) return null;
    const gId = dragActiveId.slice(6);
    const found = sidebarNodes.find((n) => n.type === 'group' && n.id === gId);
    return found?.type === 'group' ? found : null;
  })();

  // PointerSensor с минимальным расстоянием активации: клики не превращаются в drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Droppable-контейнер секции «Открытые вкладки» для дропа из pinned в пустую секцию.
  const { setNodeRef: setNormalDropRef } = useDroppable({ id: SECTION_NORMAL_ID });

  const pinnedIds = pinned.map((t) => t.id);
  const openIds = (localOpenOrder ?? topLevelOpenIds).filter((id) => !effectivePinnedIds.has(id));

  const handleDragStart = (e: DragStartEvent) => {
    setDragActiveId(e.active.id as string);
    const onMove = (ev: PointerEvent) => {
      const rect = getContentRect();
      const over = !!rect
        && ev.clientX >= rect.left && ev.clientX <= rect.right
        && ev.clientY >= rect.top  && ev.clientY <= rect.bottom;
      if (over !== contentOverRef.current) {
        contentOverRef.current = over;
        onDragOverContent(over);
      }
    };
    moveListenerRef.current = onMove;
    document.addEventListener('pointermove', onMove);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    if (moveListenerRef.current) {
      document.removeEventListener('pointermove', moveListenerRef.current);
      moveListenerRef.current = null;
    }
    const wasOverContent = contentOverRef.current;
    contentOverRef.current = false;
    onDragOverContent(false);
    setDragActiveId(null);

    const { active, over } = e;

    // Дроп в контент-зону → split вместо reorder.
    // Группы в split не входят — проверяем только обычные вкладки.
    if (wasOverContent) {
      const draggedId = active.id as string;
      if (!draggedId.startsWith('group:')) {
        const draggedTab = tabs.find((t) => t.id === draggedId);
        if (draggedTab && !draggedTab.isHub && !draggedTab.isPinned && draggedTab.splitSide === null) {
          onDropOnContent(draggedId);
        }
      }
      return;
    }

    if (!over || active.id === over.id) return;

    const activeItemId = active.id as string;
    const overId       = over.id  as string;

    const isActivePinned      = pinnedIds.includes(activeItemId);
    const overIsPinnedTab     = pinnedIds.includes(overId);
    const overIsNormalItem    = openIds.includes(overId);
    const overIsNormalSection = overId === SECTION_NORMAL_ID;

    const overInPinned = overIsPinnedTab;
    const overInNormal = overIsNormalItem || overIsNormalSection;

    if (!overInPinned && !overInNormal) return;

    const crossSection = (isActivePinned && overInNormal) || (!isActivePinned && overInPinned);

    if (crossSection) {
      // Группы нельзя перемещать в закреплённые — это операция только над вкладками
      if (activeItemId.startsWith('group:')) return;

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
      onMoveSection(activeItemId, targetSection, targetIndex);
      return;
    }

    // ── Перемещение внутри секции ─────────────────────────────────────────
    if (isActivePinned) {
      const oldIdx = pinnedIds.indexOf(activeItemId);
      const newIdx = overIsPinnedTab ? pinnedIds.indexOf(overId) : -1;
      if (newIdx < 0 || oldIdx === newIdx) return;
      const newOrder = arrayMove(pinnedIds, oldIdx, newIdx);
      if (pinnedTimeoutRef.current) clearTimeout(pinnedTimeoutRef.current);
      setLocalPinnedOrder(newOrder);
      pinnedTimeoutRef.current = setTimeout(() => {
        setLocalPinnedOrder(null);
        pinnedTimeoutRef.current = null;
      }, REORDER_CONFIRM_MS);
      onReorder('pinned', newOrder);
    } else {
      const oldIdx = openIds.indexOf(activeItemId);
      const newIdx = overIsNormalItem ? openIds.indexOf(overId) : -1;
      if (newIdx < 0 || oldIdx === newIdx) return;
      const newOrder = arrayMove(openIds, oldIdx, newIdx);
      if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
      setLocalOpenOrder(newOrder);
      openTimeoutRef.current = setTimeout(() => {
        setLocalOpenOrder(null);
        openTimeoutRef.current = null;
      }, REORDER_CONFIRM_MS);
      onReorder('normal', newOrder);
    }
  };

  // ── Свёрнутый режим: узкая полоса иконок ──
  if (collapsed) {
    const openBase = tabs.filter((t) => !t.isHub && !t.isPinned);
    return (
      <aside className="drag" style={{ ...asideBase, width: 56, alignItems: 'center', padding: '12px 0 14px' }}>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 14 }}>
          <button
            className="no-drag icon-btn"
            onClick={() => onCollapsedChange(false)}
            title="Развернуть панель"
            style={{ ...iconBtn, transform: 'scaleX(-1)' }}
          >
            <PanelLeft size={17} />
          </button>
        </div>

        {pinned.length > 0 && (
          <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingBottom: 8, paddingTop: 4, borderBottom: '1px solid var(--divider-strong)', width: '100%' }}>
            {pinned.map((t) => (
              <button key={t.id} onClick={() => onSelect(t.id)}
                onContextMenu={(e) => { e.preventDefault(); onTabMenu(t.id); }}
                title={t.title}
                style={{
                  border: 'none', cursor: 'default', padding: 5, borderRadius: 'var(--radius-sm)',
                  background: activeId === t.id ? 'var(--surface)' : 'transparent',
                  boxShadow: activeId === t.id ? 'var(--shadow-card)' : 'none',
                  opacity: t.isSleeping ? 0.6 : 1,
                }}
                onMouseEnter={(e) => { if (activeId !== t.id) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { if (activeId !== t.id) e.currentTarget.style.background = 'transparent'; }}
              >
                <FaviconTile tab={t} size={18} />
              </button>
            ))}
          </div>
        )}

        <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, overflowY: 'auto', flex: 1, paddingTop: 4 }}>
          {openBase.map((t) => (
            <button key={t.id} onClick={() => onSelect(t.id)} title={t.title}
              onContextMenu={(e) => { e.preventDefault(); onTabMenu(t.id); }}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(t.id); } }}
              style={{
                border: 'none', cursor: 'default', padding: 5, borderRadius: 'var(--radius-sm)',
                background: activeId === t.id ? 'var(--surface)' : 'transparent',
                boxShadow: activeId === t.id ? 'var(--shadow-card)' : 'none',
                opacity: t.isSleeping ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { if (activeId !== t.id) e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { if (activeId !== t.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <FaviconTile tab={t} size={18} />
            </button>
          ))}
        </div>

        <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <button className="icon-btn" title="Новая вкладка" style={iconBtn} onClick={onNewTab}><Plus size={17} /></button>
          <button className="icon-btn" title="История" style={iconBtn} onClick={onHistory}><Clock size={17} /></button>
          <button className="icon-btn" title="Настройки" style={iconBtn} onClick={onSettings}><Settings size={17} /></button>
        </div>
      </aside>
    );
  }

  // ── Развёрнутый режим с drag-and-drop ──
  return (
    <aside className="drag" style={{ ...asideBase, width: 256, padding: '14px 12px 14px 14px' }}>

      {/* Шапка */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0 14px' }}>
        <button className="no-drag icon-btn" onClick={() => onCollapsedChange(true)} title="Свернуть панель" style={iconBtn}>
          <PanelLeft size={17} />
        </button>
      </div>

      {/* Один внешний DndContext для обеих секций */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Закреплённые: сетка favicon, tooltip с заголовком, без крестика */}
        {pinned.length > 0 && (
          <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
            <div className="no-drag" style={{
              display: 'flex', flexWrap: 'wrap', gap: 4,
              paddingBottom: 10, marginBottom: 2,
              borderBottom: '1px solid var(--divider-strong)',
            }}>
              {pinned.map((t) => (
                <SortablePinCell key={t.id} tab={t} active={activeId === t.id}
                  onClick={() => onSelect(t.id)}
                  onContextMenu={() => onTabMenu(t.id)} />
              ))}
            </div>
          </SortableContext>
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
                    splitActive={anySplitActive} />
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
                    group={node}
                    tabMap={tabMap}
                    activeId={activeId}
                    onSelect={onSelect} onClose={onClose}
                    onContextMenu={onTabMenu} onSplit={onSplit}
                    onExitSplit={onExitSplit} splitActive={anySplitActive}
                    renameGroupId={renameGroupId}
                    setRenameGroupId={setRenameGroupId}
                  />
                );
              }
              return null;
            })}
          </div>
        </SortableContext>

        {/* DragOverlay: ghost-копия перетаскиваемого элемента.
            Для вкладки — TabRow; для группы — минимальный заголовок. */}
        <DragOverlay>
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
        </DragOverlay>
      </DndContext>

      {/* ── Превью AI-группировки: заменяет список вкладок ── */}
      {organizeState === 'preview' && (
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
                borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: '#fff',
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

      {/* ── Кнопка «Навести порядок» — только в обычном режиме, > 10 вкладок ── */}
      {organizeState !== 'preview' && organizeTabsCount > 10 && (
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
              Группирую…
            </>
          ) : organizeState === 'model-error' ? (
            <>
              <span style={{ fontSize: 13, lineHeight: 1 }}>⚠</span>
              Повторить
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Навести порядок
            </>
          )}
        </button>
      )}

      {/* ── Баннер отката: показываем после применения, пока нет ручных изменений ── */}
      {organizeState === 'idle' && hasOrganizeSnapshot && (
        <div className="no-drag" style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 4,
          padding: '6px 10px',
          background: 'var(--surface-hover)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--divider-strong)',
        }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-xs)', color: 'var(--text-body)' }}>
            Вкладки сгруппированы
          </span>
          <button
            className="no-drag"
            onClick={onOrganizeRollback}
            title="Вернуть прежний порядок"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              border: 'none', background: 'transparent', cursor: 'default',
              padding: '2px 6px', borderRadius: 4,
              color: 'var(--accent)', fontSize: 'var(--fs-xs)', fontWeight: 600,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <RotateCcw size={11} />
            Вернуть
          </button>
        </div>
      )}

      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 8, padding: '4px 0 2px' }}>
        <button className="no-drag" title="Новая вкладка"
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
            border: 'none', background: 'transparent', cursor: 'default',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}
          onClick={onNewTab}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Plus size={17} />
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>Новая вкладка</span>
        </button>
        <button className="no-drag icon-btn" title="История" style={iconBtn} onClick={onHistory}><Clock size={17} /></button>
        <button className="no-drag icon-btn" title="Настройки" style={iconBtn} onClick={onSettings}><Settings size={17} /></button>
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
