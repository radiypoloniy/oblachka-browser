import { useState, useEffect } from 'react';
// Свои значки — см. разбор в glyphs.tsx.
import { PanelGlyph, PlusGlyph, SlidersGlyph, CloseGlyph, ClockGlyph, SparkGlyph } from './glyphs';
import { islandPlate } from '../styles/island';
import SidebarBookmarks from './SidebarBookmarks';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, rectSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import type { TabState, SidebarNode, ClusterProposal } from '../../shared/ipc';
import { RADIUS } from '../styles/system';
import { useSidebarWidth, SIDEBAR_HANDLE_OUTSET } from './sidebar/useSidebarWidth';
import { nodeToTopId } from './sidebar/nodeIds';
import { useTabDragOverPage } from './sidebar/useTabDragOverPage';
import { GROUP_COLORS } from './sidebar/groupColors';
import { FolderGlyph, CollapsedNodeCells, CollapsedGroupIsland, SortableCollapsedItem } from './sidebar/collapsed';
import { DragGhostPlate } from './sidebar/DragGhostPlate';
import { SortableGroupBlock } from './sidebar/GroupBlock';
import { asideBase, utilIconBtn, ModeSwitch, SectionLabel, UndoChip } from './sidebar/chrome';
import { useSidebarDrag } from './sidebar/useSidebarDrag';
import { TabRow, SortableTabRow, PairTile, SortablePairBlock, IconCell, SortablePinCell } from './sidebar/rows';




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
  // Перетаскивание и оптимистичный порядок — в useSidebarDrag. Там же разбор, почему порядок
  // применяется синхронно, а исход дожидается ответа main.
  const {
    tabMap, pinned, effectiveNodes, pinnedIds, openIds,
    sensors, setNormalDropRef, childDragZone,
    dragNode, dragPinnedTab, dragTab, dragGroup, dragPairTabs,
    handleDragStart, handleDragEnd, finishDrag,
  } = useSidebarDrag({ tabs, sidebarNodes, onReorder, onMoveSection, onDropOnContent });
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


  // Подписка на GROUP_RENAME_PROMPT: нативное меню просит начать inline-переименование
  useEffect(() => {
    return window.oblako.onGroupRenamePrompt((groupId) => setRenameGroupId(groupId));
  }, []);


  // Звук вкладки из СВЁРНУТОЙ полосы: там у ячейки нет ничего, кроме значка сайта, и значок
  // звука на нём — единственная кнопка, до которой можно дотянуться, не разворачивая панель.
  // Вторая дверь — пункт в меню по правой кнопке (electron/ipc/menus.ts).
  const toggleMute = (id: string): void => {
    const t = tabMap.get(id);
    if (t) void window.oblako.setTabMuted(id, !t.muted);
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
              <DragGhostPlate inline>
                <IconCell tab={dragPinnedTab} active={activeId === dragPinnedTab.id} ghost />
              </DragGhostPlate>
            )}
            {dragNode && dragNode.type !== 'group' && (
              <DragGhostPlate inline>
                <CollapsedNodeCells
                  node={dragNode} tabMap={tabMap} activeId={activeId}
                  onSelect={() => {}} onClose={() => {}} onTabMenu={() => {}}
                  ghost
                />
              </DragGhostPlate>
            )}
            {dragGroup && (
              <DragGhostPlate inline padding={5}>
                <FolderGlyph
                  tone={(dragGroup.color ? GROUP_COLORS[dragGroup.color] : null) ?? 'var(--text-muted)'}
                  size={18}
                />
              </DragGhostPlate>
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
            <DragGhostPlate inline>
              <IconCell tab={dragPinnedTab} active={activeId === dragPinnedTab.id} ghost />
            </DragGhostPlate>
          )}
          {dragTab && (
            <DragGhostPlate>
              <TabRow
                tab={dragTab}
                active={activeId === dragTab.id}
                onClick={() => {}}
                onClose={() => {}}
                onContextMenu={() => {}}
                ghost
              />
            </DragGhostPlate>
          )}
          {dragPairTabs && (
            <DragGhostPlate>
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
            </DragGhostPlate>
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
