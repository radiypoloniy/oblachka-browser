import { useEffect, useLayoutEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import Sidebar, { FaviconTile } from './components/Sidebar';
import Toolbar from './components/Toolbar';
import Hub from './components/Hub';
import TabError from './components/TabError';
import Settings from './components/Settings';
import HistoryBookmarks from './components/HistoryBookmarks';
import Downloads from './components/Downloads';
import PermissionPrompt from './components/PermissionPrompt';
import { islandPlate } from './styles/island';
import { embeddingService } from './services/EmbeddingService';
import { startEmbedRequestBridge } from './services/EmbedRequestBridge';
import type { SyncState, TabState, DownloadEntry, PermissionRequest, SidebarNode, SplitPairNode, VpnConnectionState, PageTranslateState, PageTranslateProgress } from '../shared/ipc';
import { ISLAND_GAP, SHELL_MARGIN, SPLIT_HEADER_HEIGHT } from '../shared/layout';
import type { ClusterProposal } from './services/ClusteringService';

const HUB_ID = 'hub';

// Резерв для inline-prompt разрешений (высота панели 56px + 8px зазор).
const PERMISSION_PROMPT_RESERVE = 64;

// «Остров» позади реальной вкладки (обычная страница/её ошибка, не hub) — та же плашка,
// что уже рисуют History/Settings/Bookmarks под собой (radius-island/shadow-island,
// CONTENT_CORNER_RADIUS в TabManager.ts). Реальная WebContentsView кладётся сверху
// main-процессом ровно на тот же прямоугольник и непрозрачна — плашку целиком закрывает,
// снаружи виден только хвост тени в margin:var(--gutter-shell) вокруг contentRef (и, в
// split-режиме, в ISLAND_GAP между панелями). Hub сюда не входит намеренно: он прозрачный
// по задумке (цветной --canvas просвечивает сквозь него), сплошная подложка убила бы этот
// эффект — у Hub своя эстетика, не «страница».
const TAB_FRAME_VISUAL: CSSProperties = {
  ...islandPlate,
  borderRadius: 'var(--radius-island)',
  boxShadow: 'var(--shadow-island)',
  background: 'var(--surface-solid)',
  overflow: 'hidden',
};

// Одиночная вкладка: плашка сама себе абсолютно спозиционированный слой позади контента,
// pointer-events:none — она никогда не должна перехватывать клики (TabError включает их себе
// обратно явно, см. TabError.tsx).
const TAB_FRAME_STYLE: CSSProperties = {
  position: 'absolute', inset: 0,
  ...TAB_FRAME_VISUAL,
  pointerEvents: 'none',
};

// Полоса заголовка над split-панелью (favicon+title+×) — сидит в верхних SPLIT_HEADER_HEIGHT
// px родительского TAB_FRAME_VISUAL, которые TabManager (getTabViewBounds/repositionViews)
// больше не отдаёт под контентную WebContentsView (см. shared/layout.ts). Сама не скруглена —
// верхние углы даёт overflow:hidden+border-radius родителя (панель), нижняя граница — просто
// прямая линия-разделитель. Клик по пустому месту всплывает к onClick панели (фокус), крестик
// сам себя останавливает и зовёт closeTab — тот же путь, что и обычное закрытие вкладки
// (TabManager.closeTab уже схлопывает сплит через exitSplit, отдельного пути не заводим).
function SplitPanelHeader({ tab, onClose }: { tab: TabState; onClose: () => void }) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: SPLIT_HEADER_HEIGHT,
      display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
      borderBottom: '1px solid var(--divider)',
    }}>
      <FaviconTile tab={tab} size={12} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)', fontWeight: 500,
        color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{tab.title || tab.url || 'Загрузка…'}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        title="Закрыть"
        style={{
          border: 'none', background: 'transparent', cursor: 'default', padding: 2,
          borderRadius: 4, display: 'inline-flex', flex: 'none', color: 'var(--text-faint)',
        }}
      ><X size={12} /></button>
    </div>
  );
}

// Ниже COLLAPSE_THRESHOLD сайдбар схлопывается принудительно.
// Выше EXPAND_THRESHOLD — восстанавливается желаемое состояние пользователя.
// Зазор 20 px = гистерезис: убирает дёрганье на границе.
const SIDEBAR_COLLAPSE_THRESHOLD = 960;
const SIDEBAR_EXPAND_THRESHOLD   = 980;
const SPLIT_RATIO_MIN = 0.2;
const SPLIT_RATIO_MAX = 0.8;

// Заход 3 — AI-хаб: поповер → правый док, тянется как split (см. App.tsx::handleAiDivider*).
// Клампы дублируют electron/AiPanelManager.ts (главный источник истины — там; здесь только
// живой визуальный превью во время драга, до подтверждения основным процессом).
const AI_PANEL_WIDTH_MIN = 300;
const AI_PANEL_WIDTH_MAX = 640;

// Показываемая пара — не «первая в дереве с нужным splitSide» (при 2+ парах это может
// быть ЧУЖАЯ, непоказываемая пара), а та, что реально содержит activeId — тот же принцип,
// что #activePair() в TabManager.ts. Рекурсивно, т.к. пара может лежать внутри группы.
function findActiveSplitPairNode(nodes: SidebarNode[], activeId: string): SplitPairNode | null {
  for (const node of nodes) {
    if (node.type === 'split-pair' && (node.leftTabId === activeId || node.rightTabId === activeId)) {
      return node;
    }
    if (node.type === 'group') {
      const nested = findActiveSplitPairNode(node.children, activeId);
      if (nested) return nested;
    }
  }
  return null;
}

export default function App() {
  console.log('[renderer-alive] App смонтирован')

  // Заход G: отвечает на embed:request от main реальным embeddingService — общий канал для
  // индексатора истории и (позже) семантического поиска, см. EmbedRequestBridge.ts.
  useEffect(() => startEmbedRequestBridge(), []);

  const [tabs, setTabs] = useState<TabState[]>([]);
  const [sidebarNodes, setSidebarNodes] = useState<SidebarNode[]>([]);
  const [activeId, setActiveId] = useState(HUB_ID);
  // VPN, шаг 3 — реальное состояние вместо мока (было: локальный boolean, всегда true при старте,
  // «Финляндия» захардкожена в Toolbar.tsx). Индикатор, который не отражает, действительно ли
  // сейчас блокируется/маршрутизируется трафик, — прямая противоположность тому, что должен
  // давать fail-closed (см. electron/main.ts::applyVpnProxy). null — статус ещё не загружен.
  const [vpnConn, setVpnConn] = useState<VpnConnectionState | null>(null);
  const [pageTranslateState, setPageTranslateState] = useState<PageTranslateState>('idle');
  const [pageTranslateProgress, setPageTranslateProgress] = useState<PageTranslateProgress | null>(null);
  const [dark, setDark] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [splitRatio, setSplitRatioState] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);
  const [splitDragOver, setSplitDragOver] = useState(false);

  // AI-хаб (заход 3): правый док вместо поповера. aiPanelOpen — источник истины main
  // (toggleAiPanel возвращает актуальное open), не локальный тоггл — тот же принцип, что и
  // остальные push/invoke-состояния этого файла (vpnConn, adBlockState, ...).
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelWidth, setAiPanelWidthState] = useState(360);
  const [isAiPanelDragging, setIsAiPanelDragging] = useState(false);

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
  // kind — заход на псевдо-вкладки (История/Настройки, см. shared/ipc.ts::TabState.kind):
  // отдельно от isHub (тот трогать рискованно, читается ~15+ мест) — только для нового рендер-пути.
  const kind = active?.kind ?? 'hub';

  // Split View: показываемая пара — та, что в дереве СОДЕРЖИТ activeId (findActiveSplitPairNode),
  // а не первая в tabs с нужным splitSide — при 2+ парах плоский .find() по splitSide всегда
  // попадал бы на первую по порядку пару в дереве, а не на реально активную (см. историю).
  // При «припаркованном» split (смотрим другую вкладку вне пары) — узел не найден, isSplit=false,
  // но splitSide у обеих вкладок той пары не null → сайдбар показывает Columns2-индикатор.
  const activeSplitPairNode = findActiveSplitPairNode(sidebarNodes, activeId);
  const splitLeft  = activeSplitPairNode ? tabs.find((t) => t.id === activeSplitPairNode.leftTabId) : undefined;
  const splitRight = activeSplitPairNode ? tabs.find((t) => t.id === activeSplitPairNode.rightTabId) : undefined;
  const isSplit = !!splitLeft && !!splitRight;

  // Refs для использования актуальных значений внутри IPC-колбэков (замыкания).
  const isHubRef = useRef(isHub);
  isHubRef.current = isHub;
  const kindRef = useRef(kind);
  kindRef.current = kind;
  // tabErrorRef нужен в pushBounds: reserve не применяем когда показана страница ошибки.
  const tabErrorRef = useRef(tabError);
  tabErrorRef.current = tabError;
  // downloadsOpenRef: пока открыты Загрузки (оверлей), скрываем WebContentsView нулевыми bounds.
  const downloadsOpenRef = useRef(downloadsOpen);
  downloadsOpenRef.current = downloadsOpen;
  const pendingPermissionsRef = useRef(pendingPermissions);
  pendingPermissionsRef.current = pendingPermissions;

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
  // а не web-контент, что даёт видимую плашку при несовпадении). Нативный Electron API,
  // CSS-переменную сюда не прокинуть — литералы обязаны совпадать с токенами вручную
  // (Коммит 1: light --app-bg сменился на #F2F2F7, синхронизировано; dark --app-bg не менялся).
  // symbolColor = --text-body темы: light уже совпадал (#46443F), dark раньше был #EAE8E3 —
  // не совпадал с реальным --text-body dark (#CBC7D2), исправлено заодно.
  useEffect(() => {
    void window.oblako.setTitleBarOverlay({
      color: dark ? '#15131A' : '#F2F2F7',
      symbolColor: dark ? '#CBC7D2' : '#46443F',
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
      // Та же пара, что реально будет показана (findActiveSplitPairNode) — не первая в дереве
      // с нужным splitSide, иначе при 2+ парах ratio восстанавливался бы для чужой пары.
      const activePairNode = active ? findActiveSplitPairNode(s.nodes, active.id) : null;
      if (activePairNode) {
        setSplitRatioState(Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, activePairNode.ratio)));
      }
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

    // Ctrl+H — та же псевдо-вкладка, что и иконка в сайдбаре (см. onHistory prop у Sidebar
    // ниже): всегда создаёт новую (простая, предсказуемая семантика, как у обычного createTab —
    // без «переключиться на уже открытую, если есть»).
    const unsubHistory = window.oblako.onHistoryOpen(() => {
      void (async () => { setActiveId(await window.oblako.createSpecialTab('history')); })();
      setDownloadsOpen(false);
    });

    const unsubDownloadsOpen = window.oblako.onDownloadsOpen(() => {
      setDownloadsOpen((v) => !v);
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

  // VPN, шаг 3 — реальный статус подключения для тулбарной пилюли (см. VpnPill в Toolbar.tsx).
  useEffect(() => {
    void window.oblako.getVpnConnectionState().then(setVpnConn);
    const unsub = window.oblako.onVpnConnectionStateChanged(setVpnConn);
    return () => unsub();
  }, []);

  // Состояние полностраничного перевода для кнопки в тулбаре (см. PageTranslateManager.ts).
  useEffect(() => {
    void window.oblako.getPageTranslateState().then(setPageTranslateState);
    const unsub = window.oblako.onPageTranslateStateChanged(setPageTranslateState);
    return () => unsub();
  }, []);

  // Персистентная ширина AI-дока (заход 3) — читаем один раз при маунте (как hubMode/searchEngine
  // в Settings.tsx), дальше живёт в локальном стейте и обновляется во время драга.
  useEffect(() => {
    void window.oblako.getAiPanelWidth().then(setAiPanelWidthState);
  }, []);

  // Источник истины для aiPanelOpen — push из main на ЛЮБОЕ закрытие/открытие (крестик/Escape
  // внутри панели тоже сюда доезжают, не только тоггл в тулбаре — см. AiPanelManager.ts::setOpenState).
  useEffect(() => {
    const unsub = window.oblako.onAiPanelStateChanged(setAiPanelOpen);
    return () => unsub();
  }, []);

  // Прогресс перевода страницы (батч N/M + живой счётчик символов) — только push, без get: живёт
  // секунды, гонка старта окна ей не грозит (см. PageTranslateProgress в shared/ipc.ts).
  useEffect(() => {
    const unsub = window.oblako.onPageTranslateProgressChanged(setPageTranslateProgress);
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

  // ── Drag разделителя AI-дока (заход 3) — та же схема pointer capture, что у split-
  // разделителя выше, только ширина считается от ПРАВОГО края контейнера (тянем левый край
  // дока влево/вправо), а не ratio от левого. Контейнер — тот же самый div, что содержит и
  // contentRef, и этот разделитель, и spacer дока (см. JSX ниже) — его правая граница
  // совпадает с правым краем окна-контента.
  const aiPanelContainerRef = useRef<HTMLDivElement>(null);

  const handleAiDividerPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsAiPanelDragging(true);
  }, []);

  const handleAiDividerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    const container = aiPanelContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(AI_PANEL_WIDTH_MIN, Math.min(AI_PANEL_WIDTH_MAX, rect.right - e.clientX));
    setAiPanelWidthState(width);
    window.oblako.resizeAiPanel(width);
  }, []);

  const handleAiDividerPointerUp = useCallback((_e: React.PointerEvent) => {
    setIsAiPanelDragging(false);
  }, []);

  // ── Главное: измеряем "дырку" под контент и сообщаем main, ──
  // ── куда положить WebContentsView активной вкладки.       ──
  //
  // Callback стабилен (deps=[]), читает актуальные значения через рефы.
  const pushBounds = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    // Загрузки всё ещё оверлей (не тронуты этим заходом) — скрываем WebContentsView нулевыми
    // bounds, пока он открыт. История/Настройки — теперь псевдо-вкладки (view: null в TabManager,
    // тот же приём, что у хаба): activate() на них уже сам прячет любую ранее показанную реальную
    // вьюху (тот же путь, что при переключении на хаб), отдельный зов не нужен — подтверждено
    // чтением TabManager.activate()/repositionViews().
    if (downloadsOpenRef.current) {
      void window.oblako.setContentBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const r = el.getBoundingClientRect();
    // Дропдаун омнибокса больше НЕ резервирует место — нативная вью (SuggestDropdownManager.ts)
    // плавает поверх контента как самостоятельный оверлей (native z-order, addChildView), контенту
    // сдвигаться незачем (заход 5: устранена дублирующая система, см. Toolbar.tsx).
    // Inline-prompt разрешений: резерв только при наличии pending запроса на реальной странице
    // (kind==='page' — не хаб и не псевдо-вкладка История/Настройки).
    const permReserve = (pendingPermissionsRef.current.length > 0 && kindRef.current === 'page' && !tabErrorRef.current)
      ? PERMISSION_PROMPT_RESERVE : 0;
    void window.oblako.setContentBounds({
      x: r.left, y: r.top + permReserve,
      width: r.width, height: Math.max(0, r.height - permReserve),
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

  // Пересчёт bounds при смене очереди разрешений.
  useEffect(() => { pushBounds(); }, [pendingPermissions, pushBounds]);

  // когда переключаемся между хабом/страницей/псевдо-вкладкой (История/Настройки), геометрия
  // дырки та же, но main должен переотобразить вьюху — пушим bounds ещё раз. activeId один уже
  // покрывает переключение НА/С Истории и Настроек (это теперь обычная смена activeId, не
  // отдельное состояние) — специальных эффектов под них больше не нужно.
  useEffect(() => { pushBounds(); }, [activeId, isHub, pushBounds]);

  // То же для панели загрузок (всё ещё оверлей, не тронута этим заходом).
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
      {(isDragging || isAiPanelDragging) && (
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
        onExitSplit={(tabId) => { void window.oblako.exitSplit(tabId); }}
        onSettings={() => { void (async () => { setActiveId(await window.oblako.createSpecialTab('settings')); })(); setDownloadsOpen(false); }}
        onHistory={() => { void (async () => { setActiveId(await window.oblako.createSpecialTab('history')); })(); setDownloadsOpen(false); }}
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
          tab={active} allTabs={tabs} vpnOn={vpnConn?.state === 'running'} dark={dark}
          omniboxRef={omniboxRef}
          onToggleDark={() => setDark((d) => !d)}
          onBack={() => window.oblako.goBack(activeId)}
          onForward={() => window.oblako.goForward(activeId)}
          onReload={() => window.oblako.reload(activeId)}
          onSubmit={submit}
          onSuggestToggle={(open) => {
            // Заход 5: единственная система дропдауна — нативная вью (SuggestDropdownManager.ts),
            // старый React-портал удалён вместе с резервом места под него (см. pushBounds выше).
            void window.oblako.setSuggestDropdownOpen(open);
          }}
          downloadsActive={downloadsActive}
          downloadsOpen={downloadsOpen}
          onToggleDownloads={() => { setDownloadsOpen((v) => !v); }}
          onToggleAiPanel={() => { void window.oblako.toggleAiPanel(); }}
          pageTranslateState={pageTranslateState}
          pageTranslateProgress={pageTranslateProgress}
          onTogglePageTranslate={() => { window.oblako.togglePageTranslate(); }}
        />
        {/* Строка контент+док: contentRef (в неё же меряет pushBounds) + разделитель + spacer
            AI-дока (заход 3). Spacer ничего не рисует — реальный контент дока рисует main
            отдельной WebContentsView поверх этой же зарезервированной области (тот же приём,
            что и с вкладками: React рисует дырку, main кладёт вьюху). pushBounds НЕ меняется —
            contentRef и так становится у́же благодаря соседям по флексу. */}
        <div ref={aiPanelContainerRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
        {/* Контент-зона. Варианты: хаб, страница ошибки, split, "дырка" (WebContentsView).
            Margin — единственный источник воздуха: pushBounds меряет getBoundingClientRect()
            этого div, суженный margin'ом прямоугольник уезжает в main как есть, без правки
            формул bounds. Слева/сверху/снизу — всегда --gutter-shell (как у острова сайдбара).
            Справа — условно (заход 1, зазоры): при закрытой AI-панели тот же --gutter-shell
            до края окна; при открытой — 0, потому что зазор до AI-острова теперь целиком
            в DOM-хэндле (ISLAND_GAP, ниже), лишние 12px тут были бы паразитной прибавкой. */}
        <div ref={contentRef} style={{
          flex: 1, minWidth: 0, minHeight: 0, position: 'relative',
          marginTop: 'var(--gutter-shell)', marginBottom: 'var(--gutter-shell)', marginLeft: 'var(--gutter-shell)',
          marginRight: aiPanelOpen ? 0 : SHELL_MARGIN,
        }}>
          {downloadsOpen ? (
            <Downloads downloads={downloads} onClose={() => setDownloadsOpen(false)} />
          ) : kind === 'history' || kind === 'bookmarks' ? (
            <HistoryBookmarks defaultSection={kind} onClose={() => void window.oblako.closeTab(activeId)} />
          ) : kind === 'settings' ? (
            <Settings defaultSection={active?.section} onClose={() => void window.oblako.closeTab(activeId)} />
          ) : isSplit ? (
            <div style={{ display: 'flex', height: '100%' }}>
              {/* Левая панель — flex: splitRatio даёт долю от (ширина - ISLAND_GAP). Тот же остров,
                  что у одиночной вкладки (TAB_FRAME_STYLE) — каждая split-половина сама себе
                  «вкладка», bounds считает TabManager.applySplitBounds по этому же прямоугольнику. */}
              <div
                style={{ ...TAB_FRAME_VISUAL, position: 'relative', flex: splitRatio, minWidth: 0 }}
                onClick={() => {
                  if (activeId !== splitLeft!.id) void window.oblako.focusSplitPanel('left');
                }}
              >
                <SplitPanelHeader tab={splitLeft!} onClose={() => close(splitLeft!.id)} />
                {splitLeft!.tabError && (
                  <div style={{ position: 'absolute', top: SPLIT_HEADER_HEIGHT, left: 0, right: 0, bottom: 0 }}>
                    <TabError error={splitLeft!.tabError} url={splitLeft!.url}
                      onRetry={() => void window.oblako.reload(splitLeft!.id)} />
                  </div>
                )}
              </div>

              {/* Разделитель: ISLAND_GAP шириной, хват — капсула-грип по центру (не линия
                  во всю высоту — читается как ручка, не как шов). Колонка/хит-зона/pointer-
                  логика не менялись, поменялась только отрисовка внутри. */}
              <div
                style={{
                  flex: 'none', width: ISLAND_GAP, position: 'relative',
                  cursor: 'col-resize', userSelect: 'none',
                }}
                onPointerDown={handleDividerPointerDown}
                onPointerMove={handleDividerPointerMove}
                onPointerUp={handleDividerPointerUp}
                onPointerCancel={handleDividerPointerUp}
              >
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  width: 4, height: 32, transform: 'translate(-50%, -50%)',
                  borderRadius: 999, background: 'var(--divider-strong)', pointerEvents: 'none',
                }} />
              </div>

              {/* Правая панель — тот же остров, что у левой (TAB_FRAME_VISUAL). */}
              <div
                style={{ ...TAB_FRAME_VISUAL, position: 'relative', flex: 1 - splitRatio, minWidth: 0 }}
                onClick={() => {
                  if (activeId !== splitRight!.id) void window.oblako.focusSplitPanel('right');
                }}
              >
                <SplitPanelHeader tab={splitRight!} onClose={() => close(splitRight!.id)} />
                {splitRight!.tabError && (
                  <div style={{ position: 'absolute', top: SPLIT_HEADER_HEIGHT, left: 0, right: 0, bottom: 0 }}>
                    <TabError error={splitRight!.tabError} url={splitRight!.url}
                      onRetry={() => void window.oblako.reload(splitRight!.id)} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Обычный режим: хаб (прозрачный, без острова), либо реальная вкладка —
               остров-подложка позади неё (см. TAB_FRAME_STYLE) плюс ошибка поверх, если есть. */
            isHub
              ? <Hub
                  tabId={activeId} onSubmit={submit}
                  onOpenHistory={() => { void (async () => { setActiveId(await window.oblako.createSpecialTab('history')); })(); }}
                  onOpenSettings={() => { void (async () => { setActiveId(await window.oblako.createSpecialTab('settings')); })(); }}
                />
              : (
                <div style={TAB_FRAME_STYLE}>
                  {tabError && (
                    <TabError
                      error={tabError}
                      url={active?.url ?? ''}
                      onRetry={() => window.oblako.reload(activeId)}
                    />
                  )}
                </div>
              )
          )}
          {/* Рамка drag-to-split: видна когда вкладка тащится над контентом. kind==='page' уже
              покрывает хаб/Историю/Настройки одним условием — раньше это были 3 отдельных флага. */}
          {splitDragOver && !isSplit && kind === 'page' && !downloadsOpen && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 100, pointerEvents: 'none',
              border: '2px dashed var(--accent)', borderRadius: 'var(--radius-sm)',
            }} />
          )}

          {/* Inline-prompt разрешений: показываем первый из очереди. */}
          {/* Промпт в chrome-зоне, WebContentsView сдвинут вниз через pushBounds. */}
          {pendingPermissions.length > 0 && kind === 'page' && !tabError && !downloadsOpen && (
            <PermissionPrompt
              request={pendingPermissions[0]}
              onRespond={handlePermissionRespond}
            />
          )}
        </div>

        {/* Разделитель + spacer AI-дока — только когда док открыт. Та же схема pointer capture,
            что у split-разделителя выше, ширина — от правого края aiPanelContainerRef.
            Ширина = ISLAND_GAP: хэндл занимает весь межостровный зазор split↔AI целиком
            (contentRef справа больше воздуха не даёт, см. marginRight выше). Капсула-грип по
            центру — та же отрисовка, что у split-разделителя (не линия во всю высоту).
            drag-математика ниже (handleAiDividerPointerMove) считает по абсолютной позиции
            курсора от правого края контейнера — ширины хэндла не касается, чувствительность
            ресайза не меняется. */}
        {aiPanelOpen && (
          <>
            <div
              style={{
                flex: 'none', width: ISLAND_GAP, position: 'relative',
                cursor: 'col-resize', userSelect: 'none',
              }}
              onPointerDown={handleAiDividerPointerDown}
              onPointerMove={handleAiDividerPointerMove}
              onPointerUp={handleAiDividerPointerUp}
              onPointerCancel={handleAiDividerPointerUp}
            >
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                width: 4, height: 32, transform: 'translate(-50%, -50%)',
                borderRadius: 999, background: 'var(--divider-strong)', pointerEvents: 'none',
              }} />
            </div>
            <div style={{ flex: 'none', width: aiPanelWidth }} />
          </>
        )}
        </div>
      </div>
    </div>
  );
}
