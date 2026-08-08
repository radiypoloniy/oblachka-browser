import { useState, useEffect, useRef } from 'react';
import { PanelLeft, Plus, Settings, X, Cloud, Columns2, Clock, ChevronRight, ChevronDown, Sparkles, RotateCcw, VenetianMask, Volume2 } from 'lucide-react';
import { TAB_KIND_TILE } from '../styles/tabKindTile';
import { glassPlate, islandPlate } from '../styles/island';
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
import type { TabState, SidebarNode, GroupNode, ClusterProposal, TabDropResult } from '../../shared/ipc';

// Стабильный id droppable-контейнера секции «Открытые вкладки».
const SECTION_NORMAL_ID = 'drop-section-normal';

// ID для dnd-kit: single → tabId, pair → leftTabId, group → 'group:${id}'
const nodeToTopId = (node: SidebarNode): string =>
  node.type === 'single' ? node.tabId
  : node.type === 'split-pair' ? node.leftTabId
  : `group:${node.id}`;

// Ищет узел дерева по его "верхнему" id (nodeToTopId) — рекурсивно, узел может лежать
// внутри группы. Резолвит РЕАЛЬНЫЙ тип по дереву, а не по эвристике вида id (тот же
// id — голый tabId — носят и одиночная вкладка, и левая панель пары, различить их
// можно только так). Используется DragOverlay, чтобы понять, что именно тащат.
const findNodeByTopId = (nodes: SidebarNode[], topId: string): SidebarNode | null => {
  for (const node of nodes) {
    if (nodeToTopId(node) === topId) return node;
    if (node.type === 'group') {
      const nested = findNodeByTopId(node.children, topId);
      if (nested) return nested;
    }
  }
  return null;
};

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
  onDropOnContent: (tabId: string) => void;
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

export function FaviconTile({ tab, size = 16 }: { tab: TabState; size?: number }) {
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

  // Псевдо-вкладки (История/Закладки/Настройки) — раньше проваливались в ветку «нет favicon →
  // буква домена» ниже и падали в new URL('') на пустом url (см. TabState.kind в shared/ipc.ts),
  // отсюда «?». Единый маппинг kind → {Icon, color} — src/styles/tabKindTile.ts, не хардкод тут.
  const kindTile = TAB_KIND_TILE[tab.kind];
  if (kindTile) {
    const tileSize = size + 6;
    const { Icon, color } = kindTile;
    return (
      <span style={{
        width: tileSize, height: tileSize, borderRadius: 'var(--radius-sm)',
        background: color, display: 'inline-flex', flex: 'none',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={Math.round(tileSize * 0.65)} color="#fff" />
      </span>
    );
  }

  const tileSize = size + 6;
  // Инкогнито-вкладка — плитка-маска вместо favicon: мгновенно читается как приватная.
  if (tab.incognito) {
    return (
      <span style={{
        width: tileSize, height: tileSize, borderRadius: 'var(--radius-sm)', flex: 'none',
        background: 'var(--neutral-700, #3a3a42)', color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }} title="Приватная вкладка">
        <VenetianMask size={Math.round(tileSize * 0.6)} />
      </span>
    );
  }
  let inner: React.ReactNode;
  if (tab.faviconUrl) {
    inner = (
      <img src={tab.faviconUrl} width={tileSize} height={tileSize}
        style={{ borderRadius: 'var(--radius-sm)', objectFit: 'cover' }}
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
        fontSize: 'var(--fs-xs)', fontWeight: 600,
      }}>{host}</span>
    );
  }

  return <>{inner}</>;
}

interface TabRowProps {
  tab: TabState;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
  onContextMenu: () => void;
  onSplit?: () => void;
  onExitSplit?: (tabId: string) => void;
  // Во время DragOverlay-рендера кнопки не нужны (ghost — только визуал).
  ghost?: boolean;
}

function TabRow({ tab, active, onClick, onClose, onContextMenu, onSplit, onExitSplit, ghost }: TabRowProps) {
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
        transition: ghost ? undefined : 'background var(--dur-fast) var(--ease-standard)',
      }}
    >
      <FaviconTile tab={tab} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: active ? 600 : 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{tab.title || tab.url || 'Загрузка…'}</span>

      {/* Звук. ⚠️ Показывается ВСЕГДА, а не по наведению, — в этом вся суть: человек ищет,
          откуда играет музыка, и обойти для этого все вкладки мышью значит не решить задачу.
          Цвет приглушённый: это сообщение о состоянии, а не действие, и акцент тут занят
          активной вкладкой (см. цветовой закон в CLAUDE.md). */}
      {tab.audible && (
        <span title="В этой вкладке воспроизводится звук"
          style={{ flex: 'none', display: 'inline-flex', color: 'var(--text-muted)' }}>
          <Volume2 size={13} />
        </span>
      )}

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
          onClick={(e) => { e.stopPropagation(); onExitSplit(tab.id); }}
          title="Выйти из split (обе вкладки останутся)"
          style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: 4, display: 'inline-flex', color: 'var(--text-muted)', flex: 'none' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><Columns2 size={12} /></button>
      )}

      {!ghost && hovered && !tab.isHub && !tab.isPinned && !inSplit && !active && onSplit && (
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
      {/* Класс появления — на ВНУТРЕННЕМ узле, а не на обёртке dnd-kit. CSS-анимация
          перебивает inline-стили, и с fill-mode её конечный `transform: none` держался бы
          вечно, насмерть ломая перетаскивание вкладок. */}
      <div className="oblako-tab-in">
        <TabRow {...props} />
      </div>
    </div>
  );
}

// Presentational: две mini-ячейки left/right + разделитель, БЕЗ useSortable/drag —
// используется и внутри SortablePairBlock (интерактивная, оборачивает как
// SortableTabRow оборачивает TabRow), и как DragOverlay-призрак (ghost — та же
// разметка без кликов/кнопок, тот же контракт, что у TabRow с ghost).
interface PairTileProps {
  left: TabState;
  right: TabState;
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (id: string) => void;
  onExitSplit: (tabId: string) => void;
  ghost?: boolean;
}

function PairTile({ left, right, activeId, onSelect, onClose, onContextMenu, onExitSplit, ghost }: PairTileProps) {
  const [hoveredSide, setHoveredSide] = useState<'left' | 'right' | null>(null);

  const leftActive  = activeId === left.id;
  const rightActive = activeId === right.id;
  const leftShowExit  = leftActive || !rightActive;
  const rightShowExit = rightActive;

  return (
    <div style={{
      ...innerPlate,
      display: 'flex', alignItems: 'stretch',
      overflow: 'hidden',
      minHeight: 36,
    }}>
      {/* Левая ячейка */}
      <div
        onClick={ghost ? undefined : () => { if (!leftActive) onSelect(left.id); }}
        onContextMenu={ghost ? undefined : (e) => { e.preventDefault(); onContextMenu(left.id); }}
        onMouseDown={ghost ? undefined : (e) => { if (e.button === 1) { e.preventDefault(); onClose(left.id); } }}
        onMouseEnter={ghost ? undefined : () => setHoveredSide('left')}
        onMouseLeave={ghost ? undefined : () => setHoveredSide(null)}
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
        {!ghost && leftShowExit && (
          <button
            className="no-drag"
            onClick={(e) => { e.stopPropagation(); onExitSplit(left.id); }}
            title="Выйти из split (обе вкладки останутся)"
            style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: 4, display: 'inline-flex', flex: 'none', color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          ><Columns2 size={12} /></button>
        )}
        {!ghost && hoveredSide === 'left' && (
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

      {/* Вертикальный разделитель — смягчён под парящий стиль строки (была --divider-strong) */}
      <div style={{ width: 1, background: 'var(--divider)', alignSelf: 'stretch', margin: '6px 0', flex: 'none' }} />

      {/* Правая ячейка */}
      <div
        onClick={ghost ? undefined : () => { if (!rightActive) onSelect(right.id); }}
        onContextMenu={ghost ? undefined : (e) => { e.preventDefault(); onContextMenu(right.id); }}
        onMouseDown={ghost ? undefined : (e) => { if (e.button === 1) { e.preventDefault(); onClose(right.id); } }}
        onMouseEnter={ghost ? undefined : () => setHoveredSide('right')}
        onMouseLeave={ghost ? undefined : () => setHoveredSide(null)}
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
        {!ghost && rightShowExit && (
          <button
            className="no-drag"
            onClick={(e) => { e.stopPropagation(); onExitSplit(right.id); }}
            title="Выйти из split (обе вкладки останутся)"
            style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: 4, display: 'inline-flex', flex: 'none', color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          ><Columns2 size={12} /></button>
        )}
        {!ghost && hoveredSide === 'right' && (
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

// Split-пара как единый drag-блок (id = left.id — nodeToTopId маппит split-pair
// на leftTabId, TabManager.reorderTabs/reorderGroupChildren матчат по нему же).
// Обёртка над PairTile — та же связка, что SortableTabRow/TabRow: тут только
// useSortable и drag-handle, вся отрисовка — в PairTile.
function SortablePairBlock({ left, right, activeId, onSelect, onClose, onContextMenu, onExitSplit }: {
  left: TabState;
  right: TabState;
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (id: string) => void;
  onExitSplit: (tabId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: left.id,
  });

  return (
    <div
      ref={setNodeRef}
      // Оригинал гасим на время драга, как SortableTabRow/SortablePinCell: призрак пары
      // DragOverlay уже рисует, без этого пара во время перетаскивания видна дважды.
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1, flexShrink: 0 }}
      {...attributes}
      {...listeners}
    >
      <PairTile
        left={left} right={right} activeId={activeId}
        onSelect={onSelect} onClose={onClose}
        onContextMenu={onContextMenu} onExitSplit={onExitSplit}
      />
    </div>
  );
}

// Ячейка «только иконка»: favicon + tooltip, без заголовка и крестика. Одна разметка на три
// места — сетка закреплённых, ghost в DragOverlay и вся свёрнутая панель (та же связка, что
// TabRow/SortableTabRow и PairTile/SortablePairBlock). ghost — только визуал, без кликов.
function IconCell({ tab, active, onClick, onContextMenu, onMiddleClick, ghost }: {
  tab: TabState; active: boolean;
  onClick?: () => void; onContextMenu?: () => void; onMiddleClick?: () => void; ghost?: boolean;
}) {
  return (
    <button
      className="no-drag"
      onClick={ghost ? undefined : onClick}
      onContextMenu={ghost ? undefined : (e) => { e.preventDefault(); onContextMenu?.(); }}
      onMouseDown={ghost || !onMiddleClick ? undefined : (e) => {
        if (e.button === 1) { e.preventDefault(); onMiddleClick(); }
      }}
      title={ghost ? undefined : (tab.title || tab.url || '')}
      style={{
        border: 'none', cursor: 'default', padding: 5, borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--surface)' : 'transparent',
        boxShadow: active ? 'var(--shadow-card)' : 'none',
        display: 'inline-flex',
      }}
      onMouseEnter={ghost ? undefined : (e) => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={ghost ? undefined : (e) => { e.currentTarget.style.background = active ? 'var(--surface)' : 'transparent'; }}
    >
      {/* Точка загрузки вместо спиннера с текстом: в 56-пиксельной полосе о состоянии вкладки
          больше нечем сказать, а «крутится/не крутится» — единственное, что тут вообще читается. */}
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <FaviconTile tab={tab} size={18} />
        {!ghost && tab.isLoading && !tab.isSleeping && (
          <span style={{
            position: 'absolute', right: -2, bottom: -2, width: 7, height: 7,
            borderRadius: '50%', background: 'var(--accent)',
            boxShadow: '0 0 0 1.5px var(--surface-island)',
          }} />
        )}
        {/* ⚠️ Значок звука нужен и здесь, а не только в развёрнутом списке: закреплённые вкладки
            живут в этой сетке всегда, и музыка чаще всего играет именно в них. Рисуем поверх
            иконки сайта — свободного места в 56-пиксельной полосе нет вовсе. Загрузка
            приоритетнее: она короткая, а звук никуда не денется и покажется следом. */}
        {!ghost && tab.audible && !tab.isLoading && (
          <span title="Звук"
            style={{
              position: 'absolute', right: -3, bottom: -3,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 12, height: 12, borderRadius: '50%',
              background: 'var(--surface-island)', color: 'var(--text-muted)',
              boxShadow: '0 0 0 1.5px var(--surface-island)',
            }}><Volume2 size={9} /></span>
        )}
      </span>
    </button>
  );
}

// DnD-обёртка ячейки пина — перетаскивание меняет порядок закреплённых.
function SortablePinCell({ tab, active, onClick, onContextMenu }: {
  tab: TabState; active: boolean;
  onClick: () => void; onContextMenu: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }} {...attributes} {...listeners}>
      <IconCell tab={tab} active={active} onClick={onClick} onContextMenu={onContextMenu} />
    </div>
  );
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
  ghost?: boolean;
}

// Split-пара в узкой полосе: две иконки на общей утопленной подложке с волосяной линией между
// ними. Без подложки пара неотличима от двух соседних вкладок — а это разные вещи: она и
// переезжает, и закрывается как одно целое.
function CollapsedPairTile({ left, right, activeId, onSelect, onClose, onTabMenu, ghost }: {
  left: TabState; right: TabState; activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onTabMenu: (id: string) => void;
  ghost?: boolean;
}) {
  const cell = (tab: TabState) => (
    <IconCell
      tab={tab} active={activeId === tab.id} ghost={ghost}
      onClick={() => onSelect(tab.id)}
      onContextMenu={() => onTabMenu(tab.id)}
      onMiddleClick={() => onClose(tab.id)}
    />
  );
  return (
    <div style={{
      background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)',
      padding: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    }}>
      {cell(left)}
      <span style={{ width: 14, height: 1, background: 'var(--divider)', flex: 'none' }} />
      {cell(right)}
    </div>
  );
}

// Узел дерева → ячейки свёрнутой полосы. Общий кусок для верхнего уровня и для детей папки.
function CollapsedNodeCells({ node, tabMap, activeId, onSelect, onClose, onTabMenu, ghost }: CollapsedCellsProps) {
  if (node.type === 'single') {
    const tab = tabMap.get(node.tabId);
    if (!tab) return null;
    return (
      <IconCell
        tab={tab} active={activeId === tab.id} ghost={ghost}
        onClick={() => onSelect(tab.id)}
        onContextMenu={() => onTabMenu(tab.id)}
        onMiddleClick={() => onClose(tab.id)}
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
        onSelect={onSelect} onClose={onClose} onTabMenu={onTabMenu}
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
function CollapsedGroupIsland({ group, tabMap, activeId, onSelect, onClose, onTabMenu }: {
  group: GroupNode;
  tabMap: Map<string, TabState>;
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onTabMenu: (id: string) => void;
}) {
  const innerSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const {
    effectiveChildIds, effectiveChildren, dragChild, setChildDragId, handleChildDragEnd,
  } = useGroupChildOrder(group);
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
          ...innerPlate,
          // Бледная заливка = цвет папки, приглушённый до фона: сам цвет остаётся узнаваем,
          // но остров не начинает конкурировать с активной вкладкой за внимание.
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
            modifiers={[restrictToVerticalAxis]}
            onDragStart={(e) => setChildDragId(e.active.id as string)}
            onDragEnd={handleChildDragEnd}
            onDragCancel={() => setChildDragId(null)}
          >
            <SortableContext items={effectiveChildIds} strategy={verticalListSortingStrategy}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                {effectiveChildren.map((child) => (
                  <SortableCollapsedItem key={nodeToTopId(child)} id={nodeToTopId(child)}>
                    <CollapsedNodeCells
                      node={child} tabMap={tabMap} activeId={activeId}
                      onSelect={onSelect} onClose={onClose} onTabMenu={onTabMenu}
                    />
                  </SortableCollapsedItem>
                ))}
              </div>
            </SortableContext>

            {/* Портал призрака живёт в своём DndContext — верхний сюда не дотягивается. */}
            <DragOverlay>
              {dragChild && (
                <div style={collapsedGhostPlate}>
                  <CollapsedNodeCells
                    node={dragChild} tabMap={tabMap} activeId={activeId}
                    onSelect={() => {}} onClose={() => {}} onTabMenu={() => {}}
                    ghost
                  />
                </div>
              )}
            </DragOverlay>
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
function useGroupChildOrder(group: GroupNode) {
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

  const handleChildDragEnd = (e: DragEndEvent) => {
    // Сброс ПЕРВЫМ, до любых ранних return — иначе drop без реального перемещения
    // (over совпал с active, или вне списка) оставит childDragId висеть, а вместе с ним
    // призрак и погашенный (opacity:0) оригинал.
    setChildDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = effectiveChildIds.indexOf(active.id as string);
    const to   = effectiveChildIds.indexOf(over.id as string);
    if (from < 0 || to < 0 || from === to) return;
    const newOrder = arrayMove(effectiveChildIds, from, to);
    setLocalChildOrder(newOrder);
    void window.oblako.reorderGroupChildren(group.id, newOrder);
  };

  return { effectiveChildIds, effectiveChildren, dragChild, setChildDragId, handleChildDragEnd };
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
}

function SortableGroupBlock({
  group, tabMap, activeId, onSelect, onClose, onContextMenu,
  onSplit, onExitSplit, renameGroupId, setRenameGroupId,
}: GroupBlockProps) {
  const innerSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const {
    effectiveChildIds, effectiveChildren, dragChild, setChildDragId, handleChildDragEnd,
  } = useGroupChildOrder(group);
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
          onDragStart={(e) => setChildDragId(e.active.id as string)}
          onDragEnd={handleChildDragEnd}
          onDragCancel={() => setChildDragId(null)}
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
          <DragOverlay>
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
          </DragOverlay>
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
const asideBase: React.CSSProperties = {
  flex: 'none', display: 'flex', flexDirection: 'column',
  margin: 'var(--gutter-shell) 0 var(--gutter-shell) var(--gutter-shell)',
  borderRadius: 'var(--radius-island)',
  ...glassPlate({ surface: 'surface-island', shadow: 'shadow-island', border: false }),
  overflow: 'hidden',
};

// Внутренние «плашки» сайдбара (пины / нижние утилиты) — парят уже ВНУТРИ острова
// сайдбара, поэтому по вложенности это card-уровень, не island-уровень (см. radii.css).
// Совпадает с islandPlate + radius-card — те же параметры, что уже отлажены в FindBar/Hub/TabError.
const innerPlate: React.CSSProperties = {
  ...islandPlate,
  borderRadius: 'var(--radius-card)',
};

// Маленький квадратный «остров» под одну иконку: кнопка сворачивания сайдбара
// и «Новая вкладка» в свёрнутом виде. Тот же innerPlate, компактный padding.
const floatingIconBtn: React.CSSProperties = {
  ...innerPlate,
  padding: 7,
  color: 'var(--text-muted)',
  cursor: 'default',
  display: 'inline-flex',
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
          background: active ? 'var(--surface)' : 'transparent',
          boxShadow: active ? 'var(--shadow-card)' : 'none',
          color: active ? 'var(--text-strong)' : 'var(--text-muted)',
          fontSize: 'var(--fs-xs)', fontWeight: active ? 600 : 400,
          transition: 'background var(--dur-fast) var(--ease-standard)',
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'var(--surface)' : 'transparent'; }}
      >{label}</button>
    );
  };
  return (
    <div className="no-drag" style={{
      display: 'flex', gap: 2, padding: 2, marginBottom: 10,
      background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)',
    }}>
      {seg('tabs', 'Вкладки')}
      {seg('bookmarks', 'Закладки')}
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
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
    >
      <RotateCcw size={10} />
      {label}
    </button>
  );
}

export default function Sidebar({
  tabs, sidebarNodes, activeId, collapsed, onCollapsedChange,
  onSelect, onClose, onNewTab, onNewTabMenu, onTabMenu, onSplit, onExitSplit,
  onSettings, onHistory, onReorder, onMoveSection,
  onDropOnContent,
  organizeTabsCount, organizeState, organizeLongWait, organizeProposal,
  hasOrganizeSnapshot, hasRenameSnapshot, renameProgress, undoDismissed,
  onOrganize, onOrganizeApply, onOrganizeCancel, onOrganizeRollback,
  onRenameRollback, onRollbackAll, onDismissUndo,
}: SidebarProps) {

  // Оптимистичный порядок: применяется сразу при drop, до ответа main.
  const [localPinnedOrder, setLocalPinnedOrder] = useState<string[] | null>(null);
  const [localOpenOrder,   setLocalOpenOrder]   = useState<string[] | null>(null);
  // ID группы, которая сейчас в режиме inline-переименования
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  // Что показывает сайдбар. Состояние взгляда, а не данных: переживать перезапуск ему незачем,
  // а по умолчанию браузер обязан открываться на вкладках.
  const [mode, setMode] = useState<'tabs' | 'bookmarks'>('tabs');

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

  const handleDragStart = (e: DragStartEvent) => {
    setDragActiveId(e.active.id as string);
    // Зоны дропа поверх страницы и слежение за курсором — на стороне main: нативная вью страницы
    // и рисовать поверх себя не даёт, и указатель у чрома забирает (см. DropZoneManager.ts).
    void window.oblako.tabDragStart();
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
  const applyZoneDrop = (e: DragEndEvent, { zone, windowId }: TabDropResult): boolean => {
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
    // Дроп в контент-зону → split вместо reorder.
    // Группы в split не входят — проверяем только обычные вкладки.
    if (zone === 'split') {
      if (draggedTab && !draggedTab.isHub && !draggedTab.isPinned && draggedTab.splitSide === null) {
        onDropOnContent(draggedId);
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

  // ── Свёрнутый режим: узкая полоса иконок ──
  if (collapsed) {
    return (
      <aside className="drag" style={{ ...asideBase, width: 56, alignItems: 'center', padding: '12px 0 14px' }}>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 14 }}>
          <button
            className="no-drag"
            onClick={() => onCollapsedChange(false)}
            title="Развернуть панель"
            style={{ ...floatingIconBtn, transform: 'scaleX(-1)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
          >
            <PanelLeft size={17} />
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
              ...innerPlate,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '8px 6px', marginBottom: 10,
            }}>
              <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
                {pinned.map((t) => (
                  <SortableCollapsedItem key={t.id} id={t.id}>
                    <IconCell tab={t} active={activeId === t.id}
                      onClick={() => onSelect(t.id)}
                      onContextMenu={() => onTabMenu(t.id)} />
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
                    key={node.id}
                    group={node} tabMap={tabMap} activeId={activeId}
                    onSelect={onSelect} onClose={onClose} onTabMenu={onTabMenu}
                  />
                ) : (
                  <SortableCollapsedItem key={nodeToTopId(node)} id={nodeToTopId(node)}>
                    <CollapsedNodeCells
                      node={node} tabMap={tabMap} activeId={activeId}
                      onSelect={onSelect} onClose={onClose} onTabMenu={onTabMenu}
                    />
                  </SortableCollapsedItem>
                )
              ))}
            </div>
          </SortableContext>

          {/* Призраки — по тому же резолву типа узла, что и в развёрнутой панели
              (dragPinnedTab / dragNode), только в «иконочной» подаче. */}
          <DragOverlay>
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
          </DragOverlay>
        </DndContext>

        <div className="no-drag" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 8,
        }}>
          <button
            className="no-drag"
            title="Новая вкладка (ПКМ — инкогнито / восстановить)"
            style={floatingIconBtn}
            onClick={onNewTab}
            onContextMenu={(e) => { e.preventDefault(); onNewTabMenu(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
          ><Plus size={17} /></button>
          <button className="icon-btn" title="История и закладки" style={iconBtn} onClick={onHistory}><Clock size={17} /></button>
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
        <button
          className="no-drag"
          onClick={() => onCollapsedChange(true)}
          title="Свернуть панель"
          style={floatingIconBtn}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
        >
          <PanelLeft size={17} />
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
          <div className="no-drag" style={{ ...innerPlate, padding: 8, marginBottom: 10 }}>
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
                    onExitSplit={onExitSplit} />
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
        <DragOverlay>
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
        </DragOverlay>
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
              <Sparkles size={16} />
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
                padding: 2, borderRadius: 4, color: 'var(--text-faint)', display: 'inline-flex', flex: 'none',
              }}
            ><X size={11} /></button>
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
          style={{
            ...innerPlate,
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', color: 'var(--text-muted)', cursor: 'default',
          }}
          onClick={onNewTab}
          onContextMenu={(e) => { e.preventDefault(); onNewTabMenu(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
        >
          <Plus size={17} />
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>Новая вкладка</span>
        </button>
        <button className="no-drag icon-btn" title="История и закладки" style={iconBtn} onClick={onHistory}><Clock size={17} /></button>
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
