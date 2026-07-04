import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import Hub from './components/Hub';
import TabError from './components/TabError';
import Settings from './components/Settings';
import History from './components/History';
import Downloads from './components/Downloads';
import PermissionPrompt from './components/PermissionPrompt';
import { embeddingService } from './services/EmbeddingService';
import type { SyncState, TabState, DownloadEntry, PermissionRequest, SidebarNode } from '../shared/ipc';
import type { ClusterProposal } from './services/ClusteringService';

const HUB_ID = 'hub';

// Высота резерва для дропдауна омнибокса — FindBar больше не резервирует место (переехал в
// отдельную WebContentsView-оверлей, см. electron/FindBarManager.ts) — та же логика, что раньше.
// chromeView идёт под WebContentsView по z-order, поэтому сдвигаем WebContentsView вниз.
// 280 = 6 строк × ~44px + 8px зазор — max высота списка саджестов.
const OMNIBOX_SUGGEST_RESERVE = 280;

// Резерв для inline-prompt разрешений (высота панели 56px + 8px зазор).
const PERMISSION_PROMPT_RESERVE = 64;

// Ширина зазора-разделителя в split-режиме (px). Должна совпадать с SPLIT_GAP в TabManager.
const SPLIT_GAP = 8;

// Ниже COLLAPSE_THRESHOLD сайдбар схлопывается принудительно.
// Выше EXPAND_THRESHOLD — восстанавливается желаемое состояние пользователя.
// Зазор 20 px = гистерезис: убирает дёрганье на границе.
const SIDEBAR_COLLAPSE_THRESHOLD = 960;
const SIDEBAR_EXPAND_THRESHOLD   = 980;
const SPLIT_RATIO_MIN = 0.2;
const SPLIT_RATIO_MAX = 0.8;

export default function App() {
  console.log('[renderer-alive] App смонтирован')
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [sidebarNodes, setSidebarNodes] = useState<SidebarNode[]>([]);
  const [activeId, setActiveId] = useState(HUB_ID);
  const [vpnOn, setVpnOn] = useState(true);
  const [dark, setDark] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [splitRatio, setSplitRatioState] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);
  const [omniboxSuggestOpen, setOmniboxSuggestOpen] = useState(false);
  const [splitDragOver, setSplitDragOver] = useState(false);

  // AI-группировка: состояние флоу + предложения + наличие снимка для отката
  const [organizeState, setOrganizeState] = useState<'idle' | 'computing' | 'preview' | 'model-error'>('idle');
  const [organizeProposal, setOrganizeProposal] = useState<ClusterProposal[]>([]);
  const [hasOrganizeSnapshot, setHasOrganizeSnapshot] = useState(false);

  // desired — что выбрал пользователь (идёт в автосейв, когда он появится).
  // effective — что реально отображается (может быть принудительно true при узком окне).
  // Авто-схлопывание НЕ пишет в desired и НЕ пишет в автосейв.
  const [desiredCollapsed, setDesiredCollapsed] = useState(false);
  const [effectiveCollapsed, setEffectiveCollapsed] = useState(false);
  const desiredCollapsedRef = useRef(desiredCollapsed);
  desiredCollapsedRef.current = desiredCollapsed;

  const contentRef = useRef<HTMLDivElement>(null);
  // Актуальный DOMRect контент-зоны: обновляется ResizeObserver-ом, читается Sidebar во время drag.
  const contentRectRef = useRef<DOMRect | null>(null);
  const omniboxRef = useRef<HTMLInputElement>(null);

  const active = tabs.find((t) => t.id === activeId);
  const isHub = active?.isHub ?? true;
  const tabError = active?.tabError ?? null;

  // Split View: определяем участников по splitSide в снимке.
  // isSplit = true только когда split реально на экране (активная вкладка — одна из панелей).
  // При «припаркованном» split (смотрим другую вкладку) — isSplit = false,
  // но splitSide у обеих вкладок не null → сайдбар показывает Columns2-индикатор.
  const splitLeft  = tabs.find((t) => t.splitSide === 'left');
  const splitRight = tabs.find((t) => t.splitSide === 'right');
  const isSplit = !!splitLeft && !!splitRight
    && (activeId === splitLeft.id || activeId === splitRight.id);

  // Refs для использования актуальных значений внутри IPC-колбэков (замыкания).
  const isHubRef = useRef(isHub);
  isHubRef.current = isHub;
  // tabErrorRef нужен в pushBounds: reserve не применяем когда показана страница ошибки.
  const tabErrorRef = useRef(tabError);
  tabErrorRef.current = tabError;
  // settingsOpenRef / historyOpenRef: при открытых панелях скрываем WebContentsView нулевыми bounds.
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const historyOpenRef = useRef(historyOpen);
  historyOpenRef.current = historyOpen;
  const downloadsOpenRef = useRef(downloadsOpen);
  downloadsOpenRef.current = downloadsOpen;
  const pendingPermissionsRef = useRef(pendingPermissions);
  pendingPermissionsRef.current = pendingPermissions;
  const omniboxSuggestOpenRef = useRef(omniboxSuggestOpen);
  omniboxSuggestOpenRef.current = omniboxSuggestOpen;

  // Рефы с актуальными значениями — нужны для organize (читаются вне рендер-цикла).
  const sidebarNodesRef = useRef(sidebarNodes);
  sidebarNodesRef.current = sidebarNodes;
  const allTabsRef = useRef(tabs);
  allTabsRef.current = tabs;

  // Предзагрузка модели эмбеддингов: стартует ПОСЛЕ первого paint оболочки.
  // Double-rAF гарантирует, что первый кадр (сайдбар/тулбар/хаб) уже скомпозичен
  // прежде чем worker поднимает 8 WASM-потоков и начинает конкурировать с CPU.
  // Отключается через OBLAKO_PRELOAD_EMBED=0 npm start (для замера влияния на старт).
  useEffect(() => {
    if (!window.oblako.embedPreload) return

    let raf1 = 0, raf2 = 0, idle = 0
    const useIdle = typeof requestIdleCallback !== 'undefined'

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        // Первый кадр отрисован — грузим модель только в реальный idle.
        // timeout=10000: если пользователь активен, не ждать больше 10с.
        if (useIdle) {
          idle = requestIdleCallback(() => { embeddingService.preload() }, { timeout: 10_000 })
        } else {
          idle = window.setTimeout(() => { embeddingService.preload() }, 500)
        }
      })
    })

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      if (useIdle) cancelIdleCallback(idle)
      else clearTimeout(idle)
    }
  }, [])

  // Тема
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  // Синхронизируем фон и цвет иконок зоны системных кнопок с темой.
  // color = --app-bg темы (прозрачность не работает: Windows рисует backgroundColor окна,
  // а не web-контент, что даёт видимую плашку при несовпадении).
  useEffect(() => {
    void window.oblako.setTitleBarOverlay({
      color: dark ? '#15131A' : '#E7E9F4',
      symbolColor: dark ? '#EAE8E3' : '#46443F',
    });
  }, [dark]);

  // Атомарная подписка: tabs + nodes в одном IPC-сообщении → один рендер, нет рассинхрона.
  useEffect(() => {
    const applySync = (s: SyncState) => {
      setTabs(s.tabs);
      setSidebarNodes(s.nodes);
      setHasOrganizeSnapshot(s.hasOrganizeSnapshot);
      const active = s.tabs.find((x) => x.isActive);
      if (active) setActiveId(active.id);
    };
    let mounted = true;
    window.oblako.getSyncState().then((s) => { if (mounted) applySync(s); });
    const unsub = window.oblako.onSyncChanged((s) => { if (mounted) applySync(s); });
    return () => { mounted = false; unsub(); };
  }, []);

  // Подписки на разные push-события хрома — один раз на маунт. FindBar (открытие/закрытие/
  // результат) сюда больше не входит — переехал в отдельную WebContentsView, см.
  // electron/FindBarManager.ts (main сам решает, когда её показать/спрятать/куда слать счётчик).
  useEffect(() => {
    const unsubOmnibox = window.oblako.onOmniboxFocus(() => {
      omniboxRef.current?.focus();
      omniboxRef.current?.select();
    });

    const unsubHistory = window.oblako.onHistoryOpen(() => {
      setHistoryOpen((v) => !v);
      setSettingsOpen(false);
      setDownloadsOpen(false);
    });

    const unsubDownloadsOpen = window.oblako.onDownloadsOpen(() => {
      setDownloadsOpen((v) => !v);
      setSettingsOpen(false);
      setHistoryOpen(false);
    });

    const unsubPermission = window.oblako.onPermissionRequest((req) => {
      // FindBar на входящий запрос разрешения закрывается в main (см. permissions.attach в
      // main.ts) — та же логика, что была здесь, просто рядом с источником события.
      setPendingPermissions((prev) => [...prev, req]);
    });

    return () => {
      unsubOmnibox();
      unsubHistory(); unsubDownloadsOpen(); unsubPermission();
    };
  }, []);

  // Подписка на обновления загрузок.
  useEffect(() => {
    void window.oblako.getDownloads().then(setDownloads);
    const unsub = window.oblako.onDownloadsChanged(setDownloads);
    return () => unsub();
  }, []);

  // ── Авто-схлопывание сайдбара по ширине окна ──
  // Пересчитывается при каждом resize. Гистерезис: схлопнуть < 960, развернуть > 980.
  const updateSidebarCollapse = useCallback(() => {
    const w = window.innerWidth;
    if (w < SIDEBAR_COLLAPSE_THRESHOLD) {
      setEffectiveCollapsed(true);
    } else if (w >= SIDEBAR_EXPAND_THRESHOLD) {
      setEffectiveCollapsed(desiredCollapsedRef.current);
    }
    // в зоне гистерезиса [960, 980) — не меняем effective
  }, []);

  // Ручное переключение из сайдбара: всегда пишем в desired.
  // В effective применяем сразу, только если окно не в зоне принудительного схлопывания.
  const handleSidebarCollapse = useCallback((v: boolean) => {
    setDesiredCollapsed(v);
    desiredCollapsedRef.current = v;
    if (window.innerWidth >= SIDEBAR_COLLAPSE_THRESHOLD) {
      setEffectiveCollapsed(v);
    }
  }, []);

  // ── Drag разделителя split ──
  // setPointerCapture удерживает pointermove на разделителе даже когда курсор
  // уходит над нативными WebContentsViews (в Electron/Aura все вьюхи в одном HWND).
  // Вкладка сброшена в область контента → split (dragged = right, activeId = left).
  const handleDropOnContent = useCallback((tabId: string) => {
    setSplitDragOver(false);
    setSplitRatioState(0.5);
    void window.oblako.enterSplit(tabId);
  }, []);

  const handleDividerPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
  }, []);

  const handleDividerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    const container = contentRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, x / rect.width));
    setSplitRatioState(ratio);
    void window.oblako.setSplitRatio(ratio);
  }, []);

  const handleDividerPointerUp = useCallback((_e: React.PointerEvent) => {
    setIsDragging(false);
  }, []);

  // ── Главное: измеряем "дырку" под контент и сообщаем main, ──
  // ── куда положить WebContentsView активной вкладки.       ──
  //
  // Callback стабилен (deps=[]), читает актуальные значения через рефы.
  const pushBounds = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    // Настройки, история или загрузки открыты — скрываем WebContentsView нулевыми bounds.
    // Покрывает и split (обе вьюхи): repositionViews() в TabManager выдаёт нулевые размеры обеим.
    // Тот же сентинел (0,0,0,0) main использует, чтобы заодно спрятать FindBar (см. FindBarManager.ts).
    if (settingsOpenRef.current || historyOpenRef.current || downloadsOpenRef.current) {
      void window.oblako.setContentBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const r = el.getBoundingClientRect();
    // Дропдаун омнибокса требует резерв сверху — только на реальной странице.
    const suggestReserve = (omniboxSuggestOpenRef.current && !isHubRef.current && !tabErrorRef.current)
      ? OMNIBOX_SUGGEST_RESERVE : 0;
    // Inline-prompt разрешений: резерв только при наличии pending запроса на реальной странице.
    const permReserve = (pendingPermissionsRef.current.length > 0 && !isHubRef.current && !tabErrorRef.current)
      ? PERMISSION_PROMPT_RESERVE : 0;
    const reserve = Math.max(suggestReserve, permReserve);
    void window.oblako.setContentBounds({
      x: r.left, y: r.top + reserve,
      width: r.width, height: Math.max(0, r.height - reserve),
    });
  }, []);

  useLayoutEffect(() => {
    const updateAll = () => {
      contentRectRef.current = contentRef.current?.getBoundingClientRect() ?? null;
      pushBounds();
    };
    updateAll();
    const ro = new ResizeObserver(updateAll);
    if (contentRef.current) ro.observe(contentRef.current);
    window.addEventListener('resize', updateAll);
    return () => { ro.disconnect(); window.removeEventListener('resize', updateAll); };
  }, [pushBounds]);

  useLayoutEffect(() => {
    updateSidebarCollapse(); // начальная проверка при маунте
    window.addEventListener('resize', updateSidebarCollapse);
    return () => window.removeEventListener('resize', updateSidebarCollapse);
  }, [updateSidebarCollapse]);

  // Пересчёт bounds при смене состояния дропдауна омнибокса и очереди разрешений.
  useEffect(() => { pushBounds(); }, [omniboxSuggestOpen, pendingPermissions, pushBounds]);

  // когда переключаемся между хабом и сайтом, геометрия дырки та же,
  // но main должен переотобразить вьюху — пушим bounds ещё раз.
  useEffect(() => { pushBounds(); }, [activeId, isHub, pushBounds]);

  // Открытие/закрытие настроек: скрываем или восстанавливаем WebContentsView
  // (нулевые bounds заодно прячут FindBar, см. pushBounds выше).
  useEffect(() => { pushBounds(); }, [settingsOpen, pushBounds]);

  // То же для панели истории.
  useEffect(() => { pushBounds(); }, [historyOpen, pushBounds]);

  // То же для панели загрузок.
  useEffect(() => { pushBounds(); }, [downloadsOpen, pushBounds]);

  // Количество незакреплённых, негруппированных вкладок-единиц верхнего уровня.
  // GroupNode и pinned в счёт не идут — только top-level single + split-pair.
  const organizeTabsCount = sidebarNodes.filter(
    (n) => n.type === 'single' || n.type === 'split-pair',
  ).length;

  const handleOrganize = useCallback(() => {
    if (organizeState === 'computing') return
    // При ошибке модели: сбросить и перезапустить загрузку перед инференсом.
    if (organizeState === 'model-error') embeddingService.retry()
    setOrganizeState('computing');
    const tabMap = new Map(allTabsRef.current.map((x) => [x.id, x]));
    void import('./services/ClusteringService').then(({ clusterTabs, DEFAULT_SIMILARITY_THRESHOLD }) =>
      clusterTabs(sidebarNodesRef.current, tabMap, DEFAULT_SIMILARITY_THRESHOLD),
    ).then((proposals) => {
      setOrganizeProposal(proposals);
      setOrganizeState('preview');
    }).catch(() => {
      setOrganizeState('model-error');
    });
  }, [organizeState]);

  const handleOrganizeApply = useCallback(() => {
    if (organizeProposal.length === 0) { setOrganizeState('idle'); return; }
    const clusters = organizeProposal.map((p) => ({
      nodeIds:   p.nodeIds,
      nodeTypes: p.nodeTypes,
      label:     p.suggestedName,
    }));
    void window.oblako.organizeApply(clusters);
    setOrganizeState('idle');
    setOrganizeProposal([]);
  }, [organizeProposal]);

  const handleOrganizeCancel = useCallback(() => {
    setOrganizeState('idle');
    setOrganizeProposal([]);
  }, []);

  const handleOrganizeRollback = useCallback(() => {
    void window.oblako.organizeRollback();
  }, []);

  const downloadsActive = downloads.some((d) => d.state === 'progressing');

  const handlePermissionRespond = (granted: boolean, remember: boolean) => {
    const [current, ...rest] = pendingPermissions;
    if (!current) return;
    void window.oblako.respondPermission(current.requestId, granted, remember);
    setPendingPermissions(rest);
  };

  const select = (id: string) => { setActiveId(id); window.oblako.activateTab(id); };
  const newTab = () => { setActiveId(HUB_ID); window.oblako.activateTab(HUB_ID); };
  const close = (id: string) => { window.oblako.closeTab(id); };

  const submit = async (input: string) => {
    if (isHub) {
      const id = await window.oblako.createTab(input);
      setActiveId(id);
    } else {
      window.oblako.navigate(activeId, input);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', overflow: 'hidden' }}>
      {/* Оверлей во время drag разделителя: держит col-resize курсор по всей ширине
          и служит страховкой на случай если setPointerCapture не перехватит события
          над нативными WebContentsViews. */}
      {isDragging && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          cursor: 'col-resize', userSelect: 'none',
        }} />
      )}
      <Sidebar
        tabs={tabs} activeId={activeId}
        collapsed={effectiveCollapsed}
        onCollapsedChange={handleSidebarCollapse}
        onSelect={select} onClose={close} onNewTab={newTab}
        onTabMenu={(id) => { void window.oblako.showTabMenu(id); }}
        onSplit={(id) => { setSplitRatioState(0.5); void window.oblako.enterSplit(id); }}
        onExitSplit={() => { void window.oblako.exitSplit(); }}
        onSettings={() => { setSettingsOpen((v) => !v); setHistoryOpen(false); setDownloadsOpen(false); }}
        onHistory={() => { setHistoryOpen((v) => !v); setSettingsOpen(false); setDownloadsOpen(false); }}
        onReorder={(section, ids) => { void window.oblako.reorderTabs(section, ids); }}
        onMoveSection={(tabId, section, idx) => { void window.oblako.moveTabSection(tabId, section, idx); }}
        sidebarNodes={sidebarNodes}
        getContentRect={() => contentRectRef.current}
        onDragOverContent={setSplitDragOver}
        onDropOnContent={handleDropOnContent}
        organizeTabsCount={organizeTabsCount}
        organizeState={organizeState}
        organizeProposal={organizeProposal}
        hasOrganizeSnapshot={hasOrganizeSnapshot}
        onOrganize={handleOrganize}
        onOrganizeApply={handleOrganizeApply}
        onOrganizeCancel={handleOrganizeCancel}
        onOrganizeRollback={handleOrganizeRollback}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Toolbar
          tab={active} allTabs={tabs} vpnOn={vpnOn} dark={dark}
          omniboxRef={omniboxRef}
          onToggleVpn={() => setVpnOn((v) => !v)}
          onToggleDark={() => setDark((d) => !d)}
          onBack={() => window.oblako.goBack(activeId)}
          onForward={() => window.oblako.goForward(activeId)}
          onReload={() => window.oblako.reload(activeId)}
          onSubmit={submit}
          onSuggestToggle={setOmniboxSuggestOpen}
          downloadsActive={downloadsActive}
          downloadsOpen={downloadsOpen}
          onToggleDownloads={() => { setDownloadsOpen((v) => !v); setSettingsOpen(false); setHistoryOpen(false); }}
          onToggleAiPanel={() => { void window.oblako.toggleAiPanel(); }}
        />
        {/* Контент-зона. Варианты: хаб, страница ошибки, split, "дырка" (WebContentsView).
            Margin — единственный источник воздуха: pushBounds меряет getBoundingClientRect()
            этого div, суженный margin'ом прямоугольник уезжает в main как есть, без правки
            формул bounds. Воздух согласован с --gutter-shell (тем же, что у острова сайдбара). */}
        <div ref={contentRef} style={{ flex: 1, minHeight: 0, position: 'relative', margin: 'var(--gutter-shell)' }}>
          {downloadsOpen ? (
            <Downloads downloads={downloads} onClose={() => setDownloadsOpen(false)} />
          ) : historyOpen ? (
            <History onClose={() => setHistoryOpen(false)} />
          ) : settingsOpen ? (
            <Settings onClose={() => setSettingsOpen(false)} />
          ) : isSplit ? (
            <div style={{ display: 'flex', height: '100%' }}>
              {/* Левая панель — flex: splitRatio даёт долю от (ширина - SPLIT_GAP) */}
              <div
                style={{ flex: splitRatio, position: 'relative', minWidth: 0 }}
                onClick={() => {
                  if (activeId !== splitLeft!.id) void window.oblako.focusSplitPanel('left');
                }}
              >
                {splitLeft!.tabError && (
                  <TabError error={splitLeft!.tabError} url={splitLeft!.url}
                    onRetry={() => void window.oblako.reload(splitLeft!.id)} />
                )}
              </div>

              {/* Разделитель: SPLIT_GAP шириной, визуальная линия по центру */}
              <div
                style={{
                  flex: 'none', width: SPLIT_GAP, position: 'relative',
                  cursor: 'col-resize', userSelect: 'none',
                }}
                onPointerDown={handleDividerPointerDown}
                onPointerMove={handleDividerPointerMove}
                onPointerUp={handleDividerPointerUp}
                onPointerCancel={handleDividerPointerUp}
              >
                <div style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: '50%', width: 2, transform: 'translateX(-50%)',
                  background: 'var(--divider-strong)', pointerEvents: 'none',
                }} />
              </div>

              {/* Правая панель */}
              <div
                style={{ flex: 1 - splitRatio, position: 'relative', minWidth: 0 }}
                onClick={() => {
                  if (activeId !== splitRight!.id) void window.oblako.focusSplitPanel('right');
                }}
              >
                {splitRight!.tabError && (
                  <TabError error={splitRight!.tabError} url={splitRight!.url}
                    onRetry={() => void window.oblako.reload(splitRight!.id)} />
                )}
              </div>
            </div>
          ) : (
            /* Обычный режим: хаб, ошибка или «дырка» под WebContentsView */
            <>
              {isHub
                ? <Hub onSubmit={submit} onOpenHistory={() => { setHistoryOpen(true); setSettingsOpen(false); }} />
                : tabError
                  ? <TabError
                      error={tabError}
                      url={active?.url ?? ''}
                      onRetry={() => window.oblako.reload(activeId)}
                    />
                  : null}
            </>
          )}
          {/* Рамка drag-to-split: видна когда вкладка тащится над контентом. */}
          {splitDragOver && !isSplit && !isHub && !settingsOpen && !historyOpen && !downloadsOpen && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 100, pointerEvents: 'none',
              border: '2px dashed var(--accent)', borderRadius: 'var(--radius-sm)',
            }} />
          )}

          {/* Inline-prompt разрешений: показываем первый из очереди. */}
          {/* Промпт в chrome-зоне, WebContentsView сдвинут вниз через pushBounds. */}
          {pendingPermissions.length > 0 && !isHub && !tabError && !settingsOpen && !historyOpen && !downloadsOpen && (
            <PermissionPrompt
              request={pendingPermissions[0]}
              onRespond={handlePermissionRespond}
            />
          )}
        </div>
      </div>
    </div>
  );
}
