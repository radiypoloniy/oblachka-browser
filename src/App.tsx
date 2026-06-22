import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import Hub from './components/Hub';
import TabError from './components/TabError';
import FindBar from './components/FindBar';
import Settings from './components/Settings';
import History from './components/History';
import type { TabState, FindResult } from '../shared/ipc';

const HUB_ID = 'hub';

// Высота полосы, вырезаемой у WebContentsView сверху, когда открыт FindBar.
// Даёт «реальную дырку» в нативном слое, иначе DOM-оверлей скрыт за WebContentsView.
// 52 = 8px (gap) + ~36px (панель) + 8px (запас).
const FIND_BAR_RESERVE = 52;

// Ширина зазора-разделителя в split-режиме (px). Должна совпадать с SPLIT_GAP в TabManager.
const SPLIT_GAP = 8;
const SPLIT_RATIO_MIN = 0.2;
const SPLIT_RATIO_MAX = 0.8;

export default function App() {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeId, setActiveId] = useState(HUB_ID);
  const [vpnOn, setVpnOn] = useState(true);
  const [dark, setDark] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findResult, setFindResult] = useState<FindResult | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [adBlockCount, setAdBlockCount] = useState(0);
  const [splitRatio, setSplitRatioState] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
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
  const findOpenRef = useRef(findOpen);
  findOpenRef.current = findOpen;
  // tabErrorRef нужен в pushBounds: reserve не применяем когда показана страница ошибки.
  const tabErrorRef = useRef(tabError);
  tabErrorRef.current = tabError;
  // settingsOpenRef / historyOpenRef: при открытых панелях скрываем WebContentsView нулевыми bounds.
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const historyOpenRef = useRef(historyOpen);
  historyOpenRef.current = historyOpen;

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

  // Подписка на изменения вкладок из main + первичная загрузка.
  // snapshot теперь несёт isActive — синхронизируем activeId из main,
  // чтобы хоткеи и любые переключения из main отражались в UI немедленно.
  useEffect(() => {
    const applySnapshot = (t: TabState[]) => {
      setTabs(t);
      const active = t.find((x) => x.isActive);
      if (active) setActiveId(active.id);
    };
    let mounted = true;
    window.oblako.getAllTabs().then((t) => { if (mounted) applySnapshot(t); });
    const unsub = window.oblako.onTabsChanged(applySnapshot);
    return () => { mounted = false; unsub(); };
  }, []);

  // Подписки на события поиска — один раз на маунт.
  useEffect(() => {
    const unsubResult = window.oblako.onFindResult((r) => setFindResult(r));

    const unsubOpen = window.oblako.onFindOpen(() => {
      if (isHubRef.current) return; // поиск не работает на хабе
      if (!findOpenRef.current) {
        setFindOpen(true);           // открыть панель; autoFocus сфокусирует input
      } else {
        // Панель уже открыта — выделить текст в поле (стандарт браузеров)
        findInputRef.current?.focus();
        findInputRef.current?.select();
      }
    });

    const unsubClose = window.oblako.onFindClose(() => {
      setFindOpen(false);
      setFindResult(null);
      void window.oblako.findStop();
    });

    const unsubOmnibox = window.oblako.onOmniboxFocus(() => {
      omniboxRef.current?.focus();
      omniboxRef.current?.select();
    });

    const unsubHistory = window.oblako.onHistoryOpen(() => {
      setHistoryOpen((v) => !v);
    });

    return () => { unsubResult(); unsubOpen(); unsubClose(); unsubOmnibox(); unsubHistory(); };
  }, []);

  // Счётчик адблока — подписка на push из main (debounced 1s, значит не шумит).
  useEffect(() => {
    void window.oblako.getAdBlockState().then((s) => setAdBlockCount(s.sessionBlockCount));
    const unsub = window.oblako.onAdBlockStateChanged((s) => setAdBlockCount(s.sessionBlockCount));
    return () => unsub();
  }, []);

  // Закрыть панель при переключении вкладки (stopFindInPage уже вызван в TabManager).
  useEffect(() => {
    setFindOpen(false);
    setFindResult(null);
  }, [activeId]);

  // ── Drag разделителя split ──
  // setPointerCapture удерживает pointermove на разделителе даже когда курсор
  // уходит над нативными WebContentsViews (в Electron/Aura все вьюхи в одном HWND).
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
  // Reserve: когда FindBar открыт на реальной странице (не хаб, не ошибка),
  // откусываем FIND_BAR_RESERVE px сверху — создаём «реальную дырку» для панели.
  // Callback стабилен (deps=[]), читает актуальные значения через рефы.
  const pushBounds = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    // Настройки или история открыты — скрываем WebContentsView нулевыми bounds.
    // Покрывает и split (обе вьюхи): repositionViews() в TabManager выдаёт нулевые размеры обеим.
    if (settingsOpenRef.current || historyOpenRef.current) {
      void window.oblako.setContentBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const r = el.getBoundingClientRect();
    const reserve = (findOpenRef.current && !isHubRef.current && !tabErrorRef.current)
      ? FIND_BAR_RESERVE
      : 0;
    void window.oblako.setContentBounds({
      x: r.left, y: r.top + reserve,
      width: r.width, height: Math.max(0, r.height - reserve),
    });
  }, []);

  useLayoutEffect(() => {
    pushBounds();
    const ro = new ResizeObserver(pushBounds);
    if (contentRef.current) ro.observe(contentRef.current);
    window.addEventListener('resize', pushBounds);
    return () => { ro.disconnect(); window.removeEventListener('resize', pushBounds); };
  }, [pushBounds]);

  // Пересчёт bounds при смене состояния find-панели:
  // открытие (+reserve) и закрытие (-reserve) должны синхронно обновить WebContentsView.
  useEffect(() => { pushBounds(); }, [findOpen, pushBounds]);

  // когда переключаемся между хабом и сайтом, геометрия дырки та же,
  // но main должен переотобразить вьюху — пушим bounds ещё раз.
  useEffect(() => { pushBounds(); }, [activeId, isHub, pushBounds]);

  // Открытие/закрытие настроек: скрываем или восстанавливаем WebContentsView.
  // FindBar закрываем при входе в настройки.
  useEffect(() => {
    if (settingsOpen) {
      setFindOpen(false);
      setFindResult(null);
    }
    pushBounds();
  }, [settingsOpen, pushBounds]);

  // То же для панели истории.
  useEffect(() => {
    if (historyOpen) {
      setFindOpen(false);
      setFindResult(null);
    }
    pushBounds();
  }, [historyOpen, pushBounds]);

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
        onSelect={select} onClose={close} onNewTab={newTab}
        onTabMenu={(id) => { void window.oblako.showTabMenu(id); }}
        onSplit={(id) => { setSplitRatioState(0.5); void window.oblako.enterSplit(id); }}
        onExitSplit={() => { void window.oblako.exitSplit(); }}
        onSettings={() => { setSettingsOpen((v) => !v); setHistoryOpen(false); }}
        onHistory={() => { setHistoryOpen((v) => !v); setSettingsOpen(false); }}
        adBlockCount={adBlockCount}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Toolbar
          tab={active} vpnOn={vpnOn} dark={dark}
          omniboxRef={omniboxRef}
          onToggleVpn={() => setVpnOn((v) => !v)}
          onToggleDark={() => setDark((d) => !d)}
          onBack={() => window.oblako.goBack(activeId)}
          onForward={() => window.oblako.goForward(activeId)}
          onReload={() => window.oblako.reload(activeId)}
          onSubmit={submit}
        />
        {/* Контент-зона. Варианты: хаб, страница ошибки, split, "дырка" (WebContentsView). */}
        <div ref={contentRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {historyOpen ? (
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
                {activeId === splitLeft!.id && (
                  <div style={{
                    position: 'absolute', inset: 0, pointerEvents: 'none',
                    boxShadow: 'inset 0 0 0 2px var(--accent)',
                  }} />
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
                {activeId === splitRight!.id && (
                  <div style={{
                    position: 'absolute', inset: 0, pointerEvents: 'none',
                    boxShadow: 'inset 0 0 0 2px var(--accent)',
                  }} />
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
          {/* FindBar: абсолютный оверлей над всей контент-зоной (включая split). */}
          {/* FindBar: абсолютный оверлей (не показываем в режиме настроек). */}
          {findOpen && !isHub && !tabError && !settingsOpen && !historyOpen && (
            <FindBar
              ref={findInputRef}
              result={findResult}
              onSearch={(q, fwd) => { void window.oblako.findStart(q, fwd); }}
              onNext={(fwd) => { void window.oblako.findNext(fwd); }}
              onStop={() => { void window.oblako.findStop(); setFindResult(null); }}
              onClose={() => {
                void window.oblako.findStop();
                setFindResult(null);
                setFindOpen(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
