import { useState } from 'react';
import { Columns2, Volume2, VolumeX } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TabState } from '../../../shared/ipc';
import { RADIUS, glyph } from '../../styles/system';
import { CloseGlyph } from '../glyphs';
import { FaviconTile } from './FaviconTile';

interface TabRowProps {
  tab: TabState;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
  onContextMenu: () => void;
  onSplit?: () => void;
  onExitSplit?: (tabId: string) => void;
  onToggleMute?: () => void;
  // Во время DragOverlay-рендера кнопки не нужны (ghost — только визуал).
  ghost?: boolean;
}

export function TabRow({ tab, active, onClick, onClose, onContextMenu, onSplit, onExitSplit, onToggleMute, ghost }: TabRowProps) {
  const [hovered, setHovered] = useState(false);
  const inSplit = tab.splitSide !== null;
  // ⚠️ Фон АКТИВНОЙ вкладки идёт через --tab-active, а не литералом --surface: на цветном
  // сайдбаре белая плашка выглядела вырезанной из другой темы, а в тёмной теме плашка почти
  // совпадала с землёй (1,256 при пороге различимости 1,20 — «надо глаза сломать, чтобы
  // разглядеть открытую вкладку»). Токен решает обе задачи и делает это ПО-РАЗНОМУ в двух темах,
  // потому что арифметика там разная — разбор у --tab-active в colors.css.
  const bg = active ? 'var(--selected)'
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
        // ⚠️ Рельс, а не заливка: в развёрнутом списке у строки есть ширина, текст и соседи —
        // активность подсказывает форма, а сплошной акцент на всю строку был бы криком (в сжатой
        // полосе наоборот: формы нет, и там заливка — единственное, что читается, см. IconCell).
        // inset-полоска вместо ::before — псевдоэлемента у inline-стиля не бывает.
        // ⚠️ Тени и рельса у выбранной строки НЕТ: сигнал ровно один — заливка (--tab-active).
        // Три признака сразу были признаком неуверенной руки, а не заботы о читаемости.
        boxShadow: 'none',
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
          активной вкладкой (см. цветовой закон в CLAUDE.md).
          ⚠️ Условие показа — audible ИЛИ muted, и второе несущее: приглушённая вкладка
          перестаёт считаться звучащей, поэтому по одному audible кнопка исчезла бы сразу
          после нажатия — вместе с единственным способом вернуть звук.
          ⚠️ stopPropagation обязателен: клик по строке переключает вкладку, а человек,
          выключающий звук, никуда переходить не просил. */}
      {!ghost && (tab.audible || tab.muted) && onToggleMute && (
        <button
          className="no-drag"
          onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
          title={tab.muted ? 'Включить звук' : 'Выключить звук'}
          style={{
            border: 'none', background: 'transparent', cursor: 'default', padding: 2,
            borderRadius: RADIUS.tight, display: 'inline-flex', flex: 'none',
            color: tab.muted ? 'var(--text-faint)' : 'var(--text-muted)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >{tab.muted ? <VolumeX {...glyph(13)} /> : <Volume2 {...glyph(13)} />}</button>
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
          style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: RADIUS.tight, display: 'inline-flex', color: 'var(--text-muted)', flex: 'none' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><Columns2 {...glyph(12)} /></button>
      )}

      {!ghost && hovered && !tab.isHub && !tab.isPinned && !inSplit && !active && onSplit && (
        <button
          className="no-drag"
          onClick={(e) => { e.stopPropagation(); onSplit(); }}
          title="Открыть рядом"
          style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: RADIUS.tight, display: 'inline-flex', color: 'var(--text-faint)', flex: 'none' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><Columns2 {...glyph(14)} /></button>
      )}

      {!ghost && !tab.isHub && !tab.isPinned && (
        <button
          className="no-drag"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Закрыть вкладку"
          style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: RADIUS.tight, display: 'inline-flex', color: 'var(--text-faint)', flex: 'none' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><CloseGlyph size={14} /></button>
      )}
    </div>
  );
}

// Обёртка для drag-and-drop одного ряда.
// disabled=true когда вкладка в split: tab.splitSide реактивен (обновляется при TABS_CHANGED),
// поэтому disabled корректно пересчитывается при входе/выходе из split.
export function SortableTabRow(props: TabRowProps) {
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

export function PairTile({ left, right, activeId, onSelect, onClose, onContextMenu, onExitSplit, ghost }: PairTileProps) {
  const [hoveredSide, setHoveredSide] = useState<'left' | 'right' | null>(null);

  const leftActive  = activeId === left.id;
  const rightActive = activeId === right.id;
  const leftShowExit  = leftActive || !rightActive;
  const rightShowExit = rightActive;

  return (
    <div style={{
      border: '1px solid var(--divider)', borderRadius: 'var(--radius-sm)',
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
          background: leftActive ? 'var(--selected)' : 'transparent',
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
            style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: RADIUS.tight, display: 'inline-flex', flex: 'none', color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          ><Columns2 {...glyph(12)} /></button>
        )}
        {!ghost && hoveredSide === 'left' && (
          <button
            className="no-drag"
            onClick={(e) => { e.stopPropagation(); onClose(left.id); }}
            title="Закрыть левую панель"
            style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: RADIUS.tight, display: 'inline-flex', flex: 'none', color: 'var(--text-faint)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          ><CloseGlyph size={12} /></button>
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
          background: rightActive ? 'var(--selected)' : 'transparent',
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
            style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: RADIUS.tight, display: 'inline-flex', flex: 'none', color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          ><Columns2 {...glyph(12)} /></button>
        )}
        {!ghost && hoveredSide === 'right' && (
          <button
            className="no-drag"
            onClick={(e) => { e.stopPropagation(); onClose(right.id); }}
            title="Закрыть правую панель"
            style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 2, borderRadius: RADIUS.tight, display: 'inline-flex', flex: 'none', color: 'var(--text-faint)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          ><CloseGlyph size={12} /></button>
        )}
      </div>
    </div>
  );
}

// Split-пара как единый drag-блок (id = left.id — nodeToTopId маппит split-pair
// на leftTabId, TabManager.reorderTabs/reorderGroupChildren матчат по нему же).
// Обёртка над PairTile — та же связка, что SortableTabRow/TabRow: тут только
// useSortable и drag-handle, вся отрисовка — в PairTile.
export function SortablePairBlock({ left, right, activeId, onSelect, onClose, onContextMenu, onExitSplit }: {
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
export function IconCell({ tab, active, onClick, onContextMenu, onMiddleClick, onToggleMute, ghost }: {
  tab: TabState; active: boolean;
  onClick?: () => void; onContextMenu?: () => void; onMiddleClick?: () => void;
  /** Клик по значку звука. Без него значок остаётся картинкой (ghost, призрак перетаскивания). */
  onToggleMute?: () => void;
  ghost?: boolean;
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
      // ⚠️ В СЖАТОЙ ПОЛОСЕ АКТИВНАЯ КЛЕТКА ЗАЛИВАЕТСЯ АКЦЕНТОМ В ПОЛНУЮ СИЛУ, и это не про вкус.
      // Раньше здесь была та же светлая плашка, что в развёрнутом списке, но она лежит на ЗЕМЛЕ:
      // белая плашка к --app-bg даёт 1,20:1 в светлой теме и 1,34 в тёмной при пороге различимости
      // 3,0 — то есть активную вкладку было физически не видно. В развёрнутом виде плашку спасает
      // текст рядом, здесь спасать нечем: кроме 34 пикселей клетки не остаётся ничего.
      // ⚠️ Мягкая заливка акцентом (--accent-soft, 10 %) тут НЕ РАБОТАЕТ ВООБЩЕ: на земле её
      // контраст 1,00 — она неотличима от фона. Работает только сплошной цвет: 4,52 к земле.
      style={{
        border: 'none', cursor: 'default', borderRadius: 'var(--radius-sm)',
        // ⚠️ Поле у активной клетки меньше ровно на толщину подложки под значком (2 + 2), поэтому
        // клетка остаётся 28 px в обоих состояниях и ряд не дёргается при переключении вкладки.
        padding: active ? 3 : 5,
        background: active ? 'var(--accent)' : 'transparent',
        boxShadow: active ? 'var(--shadow-card)' : 'none',
        display: 'inline-flex',
      }}
      onMouseEnter={ghost ? undefined : (e) => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={ghost ? undefined : (e) => { e.currentTarget.style.background = active ? 'var(--accent)' : 'transparent'; }}
    >
      {/* Точка загрузки вместо спиннера с текстом: в 56-пиксельной полосе о состоянии вкладки
          больше нечем сказать, а «крутится/не крутится» — единственное, что тут вообще читается. */}
      <span style={{
        position: 'relative', display: 'inline-flex',
        // ⚠️ Логотипы сайтов нарисованы под светлый фон и на залитой акцентом клетке тонут —
        // особенно синие. Подложка нужна ровно та же, которой в тёмной теме уже спасают
        // прозрачные фавиконы (--favicon-plate), просто здесь она нужна в ОБЕИХ темах.
        ...(active ? {
          background: 'var(--white)', borderRadius: 'calc(var(--radius-sm) - 3px)', padding: 2,
        } : null),
      }}>
        <FaviconTile tab={tab} size={18} />
        {!ghost && tab.isLoading && !tab.isSleeping && (
          <span style={{
            position: 'absolute', right: -2, bottom: -2, width: 7, height: 7,
            borderRadius: '50%',
            // На залитой акцентом клетке синяя точка сливается с фоном — берём цвет текста-на-акценте.
            background: active ? 'var(--on-accent)' : 'var(--accent)',
            boxShadow: active ? 'none' : '0 0 0 1.5px var(--surface-island)',
          }} />
        )}
        {/* ⚠️ Значок звука нужен и здесь, а не только в развёрнутом списке: закреплённые вкладки
            живут в этой сетке всегда, и музыка чаще всего играет именно в них. Рисуем поверх
            иконки сайта — свободного места в 56-пиксельной полосе нет вовсе. Загрузка
            приоритетнее: она короткая, а звук никуда не денется и покажется следом.
            ⚠️ ЭТО КНОПКА, а не картинка: раньше клик по значку просто переключал вкладку, потому
            что попадал в кнопку-ячейку под ним, — живая жалоба «иконка есть, а нажать нельзя».
            Отсюда же и размер: 16 px против прежних 12 — по значку в 12 px в 56-пиксельной полосе
            промахиваются, и промах означает не «ничего», а «ушёл на другую вкладку».
            ⚠️ stopPropagation обязателен по той же причине: без него всплытие доедет до ячейки и
            звук выключится ВМЕСТЕ с переключением вкладки. */}
        {!ghost && (tab.audible || tab.muted) && !tab.isLoading && onToggleMute && (
          <span
            role="button"
            title={tab.muted ? 'Включить звук' : 'Выключить звук'}
            onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', right: -4, bottom: -4,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 16, height: 16, borderRadius: '50%', cursor: 'default',
              background: 'var(--surface-island)',
              color: tab.muted ? 'var(--text-faint)' : 'var(--text-muted)',
              boxShadow: '0 0 0 1.5px var(--surface-island)',
            }}>{tab.muted ? <VolumeX {...glyph(10)} /> : <Volume2 {...glyph(10)} />}</span>
        )}
      </span>
    </button>
  );
}

// DnD-обёртка ячейки пина — перетаскивание меняет порядок закреплённых.
export function SortablePinCell({ tab, active, onClick, onContextMenu }: {
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
