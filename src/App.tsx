import { useEffect, useLayoutEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import Sidebar, { FaviconTile } from './components/Sidebar';
import Toolbar from './components/Toolbar';
import Hub from './components/Hub';
import TabError from './components/TabError';
import Settings from './components/Settings';
import HistoryBookmarks from './components/HistoryBookmarks';
import ImportDialog from './components/ImportDialog';
import Onboarding from './components/Onboarding';
import { SPLIT_DRAG_CARD_CAPTURE_WIDTH, SPLIT_DRAG_CARD_CAPTURE_MAX_HEIGHT } from './components/SplitDragCard';
import { islandPlate, chromeTintStyle, tintedPlateVars } from './styles/island';
import { buildChromeGround, islandColor, relLuminance } from '../shared/chromeGround';
import type { Ground } from '../shared/chromeGround';
import { loadNewTabSettings, subscribeNewTabSettings } from './newtab/settings';
import { subscribeScrim, dimColor } from './scrimState';
import { isDarkTheme } from '../shared/ipc';
import type { ContentBounds, SplitSwapHint, SyncState, TabState, DownloadEntry, SidebarNode, SplitPairNode, VpnConnectionState, PageTranslateState, PageTranslateProgress, ClusterProposal, ThemePrefs } from '../shared/ipc';
import { ISLAND_GAP, SHELL_MARGIN, SPLIT_HEADER_HEIGHT, SPLIT_PANE_INSET, SPLIT_PANE_RADIUS } from '../shared/layout';

const HUB_ID = 'hub';

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
// больше не отдаёт под контентную WebContentsView (см. shared/layout.ts). Клик по пустому месту
// всплывает к onClick панели (фокус), крестик сам себя останавливает и зовёт closeTab — тот же
// путь, что и обычное закрытие вкладки (TabManager.closeTab уже схлопывает сплит через exitSplit,
// отдельного пути не заводим).
//
// ⚠️ Своей нижней границы у шапки НЕТ, и это не упущение: страница лежит карточкой внутри панели
// (см. shared/layout.ts::SPLIT_PANE_INSET), и границу рисует кант этой карточки — чуть ниже.
// Прямая линия над кантом дублировала бы её и упиралась в скругление.
//
// Шапка — она же РУЧКА панели: за неё половину сплита перетаскивают на вторую панель (поменять
// местами) или в сайдбар (разорвать сплит). Логика жеста — в App (handlePanelDrag*).
//
// dragging — страницу этого острова несут в руке. Тогда шапка пустеет: см. ниже, почему это
// правильно и почему при этом сама полоса обязана остаться.
function SplitPanelHeader({ tab, active, onClose, dragging, dragHandlers }: {
  tab: TabState;
  active: boolean;
  onClose: () => void;
  dragging: boolean;
  dragHandlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}) {
  return (
    <div
      {...dragHandlers}
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: SPLIT_HEADER_HEIGHT,
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
        cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none',
      }}
    >
      {/* ⚠️ Пока страницу несут, на её острове НЕ ОСТАЁТСЯ НИЧЕГО от неё: ни значка, ни имени, ни
          крестика. Иначе пустой слот выглядит полноценной панелью, у которой почему-то пропало
          содержимое, — а на самом деле вся эта страница сейчас в руке, на карточке под курсором.
          ⚠️ Сама полоса при этом остаётся в DOM всегда, и это не формальность: на ней держится
          setPointerCapture. Убери мы её вместе с содержимым — жест оборвался бы на полуслове, а
          вместе с ним и возврат скрытой вьюхи (страница осталась бы невидимой). */}
      {!dragging && <FaviconTile tab={tab} size={12} />}
      {/* Активная панель заявляет о себе и текстом, не только кантом: цвет и насыщенность — тот
          же приём, что у активной вкладки в сайдбаре, одно правило на оба места. */}
      {!dragging && (
        <span style={{
          flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)',
          fontWeight: active ? 600 : 500,
          color: active ? 'var(--text-strong)' : 'var(--text-body)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          transition: 'color 120ms var(--ease-standard)',
        }}>{tab.title || tab.url || 'Загрузка…'}</span>
      )}
      {!dragging && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Закрыть"
          style={{
            border: 'none', background: 'transparent', cursor: 'default', padding: 2,
            borderRadius: 4, display: 'inline-flex', flex: 'none', color: 'var(--text-faint)',
          }}
        ><X size={12} /></button>
      )}
    </div>
  );
}

// Прямоугольник страницы внутри split-панели — тот же, что main отдаёт вьюхе
// (TabManager.#splitPaneBounds). Нужен дважды: под кант карточки и под страницу ошибки, которая
// обязана лежать ровно там, где лежала бы страница.
const SPLIT_PANE_RECT: CSSProperties = {
  position: 'absolute',
  top: SPLIT_HEADER_HEIGHT + SPLIT_PANE_INSET, left: SPLIT_PANE_INSET,
  right: SPLIT_PANE_INSET, bottom: SPLIT_PANE_INSET,
  borderRadius: SPLIT_PANE_RADIUS,
};

// Кант страницы внутри split-панели — граница между ней и панелью (страница лежит карточкой
// внутри, см. shared/layout.ts::SPLIT_PANE_INSET). Всегда нейтральный: какая половина активна,
// говорит обводка ВСЕГО острова (splitPanelStyle ниже), а не эта линия.
//
// ⚠️ Рисуется box-shadow'ом СНАРУЖИ прямоугольника карточки. Внутрь рисовать бесполезно: там
// лежит нативная вью страницы, она поверх React-слоя и закрыла бы любую рамку.
//
// empty — страницу несут в руке, обводить нечего: форму пустого слота держит кант самого острова
// (splitPanelStyle), а вторая линия внутри пустоты читалась бы как разметка неизвестно чего.
function SplitPaneEdge({ empty }: { empty: boolean }) {
  if (empty) return null;
  return (
    <div style={{ ...SPLIT_PANE_RECT, pointerEvents: 'none', boxShadow: '0 0 0 1px var(--divider)' }} />
  );
}

// Остров split-панели: активную обводим целиком — вместе с полосой заголовка, потому что заголовок
// и страница это ОДИН остров, и обводка вокруг одной страницы читалась как рамка не пойми чего.
//
// ⚠️ Кант — снаружи прямоугольника (box-shadow без inset): внутри его закрыла бы нативная вью
// страницы, а снаружи он ложится в межостровный зазор (ISLAND_GAP = 10px, места хватает).
//
// empty — страницу этого острова сейчас несут в руке (см. panelDrag). Тогда остров обязан выглядеть
// ПУСТЫМ, а не полноценной панелью, у которой почему-то пропало содержимое: заливка становится
// прозрачной (сквозь неё работает стекло islandPlate — backdrop-filter никуда не делся), тень
// уходит (то, что не floats, не должно и отбрасывать), активная обводка тоже — она про «сюда идёт
// ввод», а в пустой слот ввод не идёт.
//
// ⚠️ Гасить остров целиком через opacity было бы проще, но неправильно: вместе с заливкой погас бы
// и кант, и на светлой теме слот стал бы неотличим от фона окна — пустая рамка превратилась бы в
// «поехавшую раскладку». Поэтому кант, наоборот, остаётся в полную силу и держит форму слота.
const splitPanelStyle = (active: boolean, flex: number, empty: boolean): CSSProperties => ({
  ...TAB_FRAME_VISUAL,
  position: 'relative', flex, minWidth: 0,
  ...(empty
    ? {
      background: 'color-mix(in srgb, var(--surface-solid) 32%, transparent)',
      boxShadow: 'inset 0 0 0 1px var(--divider)',
    }
    : {
      boxShadow: active
        ? 'var(--shadow-island), 0 0 0 1.5px color-mix(in srgb, var(--accent) 45%, transparent)'
        : 'var(--shadow-island)',
    }),
  transition: 'box-shadow 140ms var(--ease-standard), background 140ms var(--ease-standard)',
});

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

// Разрешает CSS-цвет (в том числе color-mix, который getComputedStyle отдаёт формулой) в #rrggbb.
// Нужен нативному API титлбара: полоса системных кнопок рисуется ОС и принимает только готовый
// цвет. Пробный элемент — единственный способ заставить браузер посчитать формулу; живёт он один
// кадр и за пределами экрана.
function resolveColor(css: string): string {
  try {
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;left:-9999px;top:0;width:1px;height:1px;background:${css}`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

    // ⚠️ У color-mix() Chromium отдаёт НЕ rgb(), а `color(srgb 0.83 0.89 0.97)` — доли, не байты.
    // Разбор, ждавший только rgb(), возвращал пустую строку, вызывающий уходил на фолбэк, и полоса
    // системных кнопок оставалась цвета --app-bg поверх цветного окна. Проверено замером.
    const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
    if (srgb) return '#' + srgb.slice(1, 4).map((v) => hex(Number(v) * 255)).join('');

    const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
    if (rgb) return '#' + rgb.slice(1, 4).map((v) => hex(Number(v))).join('');
    return '';
  } catch {
    return '';
  }
}

export default function App() {
  console.log('[renderer-alive] App смонтирован')

  const [tabs, setTabs] = useState<TabState[]>([]);
  const [sidebarNodes, setSidebarNodes] = useState<SidebarNode[]>([]);
  // Роль своего окна (см. shared/ipc.ts::WindowRole). Спрашивается один раз: окно не меняет роль
  // за свою жизнь. До ответа считаем окно полным — это состояние живёт доли секунды и только в
  // главном окне выглядит правильно; в лёгком лишние кнопки просто исчезнут первым же ответом.
  const [isLightWindow, setIsLightWindow] = useState(false);
  const [activeId, setActiveId] = useState(HUB_ID);
  // VPN, шаг 3 — реальное состояние вместо мока (было: локальный boolean, всегда true при старте,
  // «Финляндия» захардкожена в Toolbar.tsx). Индикатор, который не отражает, действительно ли
  // сейчас блокируется/маршрутизируется трафик, — прямая противоположность тому, что должен
  // давать fail-closed (см. electron/main.ts::applyVpnProxy). null — статус ещё не загружен.
  const [vpnConn, setVpnConn] = useState<VpnConnectionState | null>(null);
  const [pageTranslateState, setPageTranslateState] = useState<PageTranslateState>('idle');
  const [pageTranslateProgress, setPageTranslateProgress] = useState<PageTranslateProgress | null>(null);
  // Оформление (см. ThemePrefs в shared/ipc.ts). Владеет значением main — оно на диске и одно на
  // все окна; здесь только копия для отрисовки. До первого ответа держим светлую — она же дефолт
  // настроек, поэтому мигания «тёмная → светлая» на старте не будет.
  const [themePrefs, setThemePrefs] = useState<ThemePrefs>({ mode: 'light', palette: 'charcoal', systemDark: false });
  const dark = isDarkTheme(themePrefs);
  // Импорт данных из другого браузера — модалка поверх всего chrome. 'manual' — открыта кнопкой
  // из настроек, 'onboarding' — авто-предложение первого запуска (мягче тон + «Пропустить»),
  // null — закрыта. См. ImportDialog.tsx / electron/browserImport/.
  const [importDialog, setImportDialog] = useState<'manual' | null>(null);
  // Открытый раздел настроек, по id вкладки. ⚠️ Живёт ЗДЕСЬ, а не в самом Settings: вкладка
  // настроек — псевдо-вкладка, её компонент размонтируется при уходе на другую вкладку и уносит
  // свой стейт, из-за чего человек каждый раз возвращался на верхний раздел. App.tsx — корень
  // хрома, он переживает переключение вкладок. По id, а не одним значением: вкладок настроек
  // можно открыть несколько, и у каждой своё место. В main это НЕ уезжает — контракт IPC ради
  // такого не трогаем, а дальше перезапуска помнить и нечего: псевдо-вкладки в сессию не идут.
  const [settingsSection, setSettingsSection] = useState<Record<string, string>>({});
  // Экран первого запуска — рассказ о браузере + перенос данных (см. Onboarding.tsx). Отдельно
  // от importDialog: тот остался ручным импортом из настроек, с другим тоном и объёмом.
  const [onboarding, setOnboarding] = useState(false);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [splitRatio, setSplitRatioState] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);

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
  const [hasRenameSnapshot, setHasRenameSnapshot] = useState(false);
  // Сколько имён уже придумано из скольких — вторая половина «навести порядок» идёт секундами
  // на вкладку, и без счётчика она выглядит зависанием.
  const [renameProgress, setRenameProgress] = useState<{ done: number; total: number } | null>(null);
  // Баннер отката человек уже видел и закрыл (или он погас сам по таймеру). Снимок в main при
  // этом жив — но навязывать плашку до конца сеанса незачем.
  const [undoDismissed, setUndoDismissed] = useState(false);
  // Какой текст показывать в 'computing' — спрашиваем факт (getLoadedModelId()) ДО вызова
  // suggestGroups(), а не гадаем по времени: таймер на фиксированный порог однажды дал ложное
  // срабатывание (тёплый прогон уложился в 4070мс при пороге 4000мс — сообщение о загрузке начало
  // бы мелькать при уже тёплой модели). См. handleOrganize.
  const [organizeLongWait, setOrganizeLongWait] = useState(false);

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
  // Активна ли приватная вкладка — тогда весь chrome (острова, тулбар, титлбар) уходит в тёмный
  // «инкогнито»-режим (как отдельное окно инкогнито в Chrome, но у нас — по активной вкладке).
  const activeIncognito = active?.incognito ?? false;
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

  // Реф с актуальным значением — нужен для organize (читается вне рендер-цикла, при построении
  // titles для превью из ответа suggestGroups()).
  const allTabsRef = useRef(tabs);
  allTabsRef.current = tabs;

  // ⚠️ ПРЕДОХРАНИТЕЛЬ ОТ ДРОПА ФАЙЛА В САМ ИНТЕРФЕЙС. Слой хрома — обычная веб-страница, и по
  // умолчанию Chromium на брошенный файл её ПЕРЕОТКРЫВАЕТ: у нас это означало голое окно без
  // вкладок и адресной строки (а в худшем случае — подмену самого интерфейса браузера файлом).
  // Ни одного места, где такой жест что-то осмысленно значит, в чроме нет: адресная строка
  // обрабатывает дроп сама и до сюда его не пускает (stopPropagation), перетаскивание вкладок
  // живёт на pointer-событиях dnd-kit и HTML5-драга не использует вовсе. Поэтому здесь глухая
  // заглушка, а не разбор случаев.
  useEffect(() => {
    const swallow = (e: DragEvent) => { e.preventDefault(); };
    document.addEventListener('dragover', swallow);
    document.addEventListener('drop', swallow);
    return () => {
      document.removeEventListener('dragover', swallow);
      document.removeEventListener('drop', swallow);
    };
  }, []);

  // Тема. Инкогнито принудительно тёмный (data-theme="dark") + флаг data-incognito, который в
  // theme-dark.css перекрашивает острова в «приятно-чёрный» (см. блок [data-incognito]).
  useEffect(() => {
    window.oblako.getWindowRole()
      .then((role) => setIsLightWindow(role === 'light'))
      .catch(() => { /* роль не пришла — остаёмся полным окном, как было до многооконности */ });
  }, []);

  // Выбор темы живёт в main (settings.json): читаем при старте и слушаем изменения — их шлёт и
  // соседнее окно, где человек ткнул настройку, и сама система при смене светлой/тёмной.
  useEffect(() => {
    void window.oblako.getTheme().then(setThemePrefs).catch(() => { /* останемся на светлой */ });
    return window.oblako.onThemeChanged(setThemePrefs);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', (dark || activeIncognito) ? 'dark' : 'light');
    // Палитра — вторая ось (см. palettes.css). В инкогнито она тоже проставляется, но правил там
    // не даёт: приватный режим обязан выглядеть одинаково независимо от вкуса, иначе он перестаёт
    // читаться как режим.
    root.setAttribute('data-palette', themePrefs.palette);
    if (activeIncognito) root.setAttribute('data-incognito', 'true');
    else root.removeAttribute('data-incognito');
    // Раздаём ту же тему во все отдельные chrome-вью (поповеры/дропдаун живут в своих document,
    // этот атрибут сам по себе до них не дойдёт) — см. main.ts::broadcastChromeTheme.
    void window.oblako.setChromeTheme(dark || activeIncognito, activeIncognito, themePrefs.palette);
  }, [dark, activeIncognito, themePrefs.palette]);

  // Онбординг: однократное предложение импорта из другого браузера при первом запуске (если на
  // диске реально найден источник). shouldOfferImport вернёт false после первого показа (флаг
  // importOffered в SettingsManager) и при отсутствии источников. Помечаем показанным сразу —
  // чтобы не всплывать повторно, даже если пользователь просто закрыл окно. Модалка ложится поверх
  // Хаба (первый запуск = активна вкладка Хаба, контент-область не перекрыта WebContentsView).
  useEffect(() => {
    let cancelled = false;
    void window.oblako.shouldShowOnboarding().then((show) => {
      if (cancelled || !show) return;
      setOnboarding(true);
      void window.oblako.markOnboardingShown();
    });
    return () => { cancelled = true; };
  }, []);

  // Синхронизируем фон и цвет иконок зоны системных кнопок с темой.
  // color = --app-bg темы (прозрачность не работает: Windows рисует backgroundColor окна,
  // а не web-контент, что даёт видимую плашку при несовпадении). Нативный Electron API,
  // CSS-переменную сюда не прокинуть — литералы обязаны совпадать с токенами вручную
  // (Коммит 1: light --app-bg сменился на #F2F2F7, синхронизировано; dark --app-bg не менялся).
  // symbolColor = --text-body темы: light — Apple label (#3C3C43), dark раньше был #EAE8E3 —
  // не совпадал с реальным --text-body dark, исправлено заодно; значения = --app-bg темы.
  // Затемнён ли чром модалкой (см. src/scrimState.ts) — от этого зависит цвет зоны системных
  // кнопок: она нативная, и CSS-затемнение до неё не достаёт.
  // Цветной фон окна — та же настройка, что раньше называлась «цветной сайдбар» (ключ в хранилище
  // не менялся, чтобы не терять уже сделанный выбор). Красит теперь всё окно.
  const [groundPrefs, setGroundPrefs] = useState(() => loadNewTabSettings().sidebar);
  useEffect(() => subscribeNewTabSettings(() => setGroundPrefs(loadNewTabSettings().sidebar)), []);
  const chromeTinted = groundPrefs.tinted;

  // ⚠️ Земля считается в JS, а не формулами CSS: нужны поворот тона и притемнение ПО СВЕТИМОСТИ
  // (см. shared/chromeGround.ts). Ни того, ни другого color-mix не умеет, а без них цветной фон
  // в тёмной теме становится СВЕТЛЕЕ островов и выворачивает иерархию.
  // ⚠️ Считается в ЭФФЕКТЕ, а не в useMemo, и это несущее различие. Токены темы проставляет
  // ДРУГОЙ эффект (data-theme/data-palette на корне), а useMemo выполняется во время рендера —
  // то есть ДО него. Земля успевала посчитаться по СТАРЫМ токенам, и после переключения светлая ↔
  // тёмная фон оставался прежним, пока человек не трогал что-нибудь ещё (живая жалоба: «приходится
  // менять тему на другую, чтобы всё пришло в норму»). Эффект стоит ПОСЛЕ того, который применяет
  // тему: порядок объявления = порядок выполнения, тот же приём, что у полосы системных кнопок ниже.
  const [ground, setGround] = useState<(Ground & { island: string }) | null>(null);
  useEffect(() => {
    if (!chromeTinted) { setGround(null); return; }
    const tint = resolveColor('var(--sidebar-tint)');
    const appBg = resolveColor('var(--app-bg)');
    const surface = resolveColor('var(--surface)');
    if (!tint || !appBg || !surface) { setGround(null); return; }
    const island = islandColor(tint, surface);
    const built = buildChromeGround({
      tint, appBg, amount: groundPrefs.amount,
      islandLum: relLuminance(island), dark: dark || activeIncognito,
    });
    setGround({ ...built, island });
    // themePrefs.palette — ради ПЕРЕЧИТЫВАНИЯ токенов: палитра меняет их, не меняя dark.
  }, [chromeTinted, groundPrefs.amount, dark, activeIncognito, themePrefs.palette]);

  const [scrimActive, setScrimActive] = useState(false);
  useEffect(() => subscribeScrim(setScrimActive), []);

  useEffect(() => {
    // ⚠️ Фон берём из ЖИВОГО значения --app-bg, а не из литерала: с палитрами (см. palettes.css)
    // теней у этого токена стало восемь, и любой захардкоженный хекс означал бы полосу системных
    // кнопок чужого цвета в большинстве палитр. Эффект стоит ПОСЛЕ того, который проставляет
    // data-theme/data-palette (порядок объявления = порядок выполнения), поэтому читается уже
    // применённая палитра. Фолбэк — прежний литерал светлой темы, если строка вдруг не хекс.
    // ⚠️ При включённом ЦВЕТНОМ ФОНЕ берём ВЕРХНЮЮ СТУПЕНЬ подкраски, а не --app-bg: полоса
    // системных кнопок Windows не участвует в web-раскладке вовсе (её рисует ОС по цвету из
    // setTitleBarOverlay), поэтому градиент до неё не доезжает и она оставалась серым
    // прямоугольником поверх цветного окна. Ось градиента специально вертикальная — тогда цвет
    // верхней кромки в точности равен этой ступени (см. CHROME_TINT_TOP в styles/island.ts).
    // ⚠️ Значение приходится РАЗРЕШАТЬ пробным элементом: это color-mix(), а getComputedStyle
    // вернул бы формулу, а не цвет.
    const raw = chromeTinted
      ? (ground?.top ?? '')
      : getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim();
    const base = /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#F2F2F7';
    void window.oblako.setTitleBarOverlay({
      // Под модалкой титлбар темнеет ровно на ту же долю, что и фон под scrim'ом, — иначе
      // светлый прямоугольник с кнопками остаётся единственным незатемнённым местом экрана.
      color: scrimActive ? dimColor(base) : base,
      // На затемнённом фоне символы всегда светлые: тёмные на сером читались бы хуже в обеих темах.
      symbolColor: scrimActive ? '#FFFFFF' : (dark || activeIncognito) ? '#EBEBF5' : '#3C3C43',
    });
    // themePrefs.palette в зависимостях не ради самого значения, а ради ПЕРЕЧИТЫВАНИЯ --app-bg:
    // палитра меняет его, не меняя ни dark, ни incognito. chromeTinted — по той же причине:
    // включение цветного фона меняет цвет полосы кнопок, не трогая ни тему, ни палитру.
  }, [dark, activeIncognito, scrimActive, themePrefs.palette, chromeTinted, ground]);

  // Атомарная подписка: tabs + nodes в одном IPC-сообщении → один рендер, нет рассинхрона.
  useEffect(() => {
    const applySync = (s: SyncState) => {
      setTabs(s.tabs);
      setSidebarNodes(s.nodes);
      setHasOrganizeSnapshot(s.hasOrganizeSnapshot);
      setHasRenameSnapshot(s.hasRenameSnapshot);
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
      
    });

    const unsubDownloadsOpen = window.oblako.onDownloadsOpen(() => {
      void (async () => { setActiveId(await window.oblako.createSpecialTab('downloads')); })();
    });

    return () => {
      unsubOmnibox();
      unsubHistory(); unsubDownloadsOpen();
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
  // side — край, за который тянули: вкладка встаёт именно туда, куда её вели (см. TabDropResult).
  const handleDropOnContent = useCallback((tabId: string, side?: 'left' | 'right') => {
    setSplitRatioState(0.5);
    void window.oblako.enterSplit(tabId, side);
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

  // ── Перетаскивание половины сплита за её шапку ────────────────────────────────────────────
  // Жест живёт в рабочей области, а не в сайдбаре: тянешь панель за шапку и либо кладёшь на
  // вторую панель (половины меняются местами), либо уводишь в сайдбар (сплит разрывается, обе
  // вкладки остаются, активной становится ТА, которую не тащили). Всё прочее — отмена.
  //
  // ⚠️ Почему setPointerCapture, а не dnd-kit и не опрос курсора в main. Капчур удерживает
  // pointermove в чроме даже когда курсор ушёл над нативные вьюхи страниц (в Electron/Aura все
  // вьюхи в одном HWND) — на этом уже держится разделитель сплита выше. Значит зону считает сам
  // renderer, по clientX/clientY, и вся правда о геометрии остаётся там, где её и меряют.
  //
  // ⚠️ А вот РИСУЕТ всё оверлей, растянутый на время жеста на всё окно (DropZoneManager): и
  // подсветку панелей, и карточку в руке. Своей карточки у чрома нет намеренно — он лежит ПОД
  // нативными вьюхами страниц, и стоило курсору уехать вверх, к тулбару, как низ карточки уходил
  // под страницу, будто она в неё провалилась.
  const leftPanelRef  = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  // Живое состояние жеста — в ref: обработчик зовётся десятки раз в секунду, и решение о зоне не
  // должно зависеть от того, успел ли перерисоваться React. Прямоугольники снимаются ОДИН раз, на
  // старте: за время жеста раскладка не меняется, а getBoundingClientRect на каждое движение
  // заставлял бы браузер считать layout заново.
  const panelDragRef = useRef<{
    tabId: string;
    siblingId: string;
    side: 'left' | 'right';       // какую половину тащат — цель это ВТОРАЯ
    title: string;                // бланк карточки; берётся на старте, дальше не меняется
    favicon: string | null;
    otherRect: DOMRect | null;    // панель-цель, координаты окна
    contentLeft: number;          // левый край области контента — левее него только остров сайдбара
    hint: SplitSwapHint | null;   // готовый payload подсветки, пересылается при смене зоны
    startX: number; startY: number;
    x: number; y: number;
    started: boolean;
    zone: 'swap' | 'sidebar' | null;
    cursorFrame: number | null;   // rAF: курсор уходит в main не чаще кадра
    thumb: string | null;         // снимок панели; приходит позже начала жеста, см. ниже
  } | null>(null);
  // Чрому от жеста нужно немногое: подкрасить шапку несомой панели и обвести сайдбар, когда
  // отпускание вернёт половину туда. Карточку и подсветку панелей рисует оверлей.
  const [panelDrag, setPanelDrag] = useState<
    { tabId: string; zone: 'swap' | 'sidebar' | null } | null
  >(null);

  // ⚠️ Пока превью показывает обмен, местами меняются и ЗАГОЛОВКИ. Страницы переезжает main
  // (нативные вьюхи), а шапки рисует React — не поменяй мы их, под шапкой одной страницы стояла бы
  // другая, и предпросмотр врал бы именами. Слоты при этом остаются на месте: превью — это картина
  // будущего, а не досрочная правка модели.
  const previewSwap = panelDrag?.zone === 'swap';
  const headerLeft  = previewSwap ? splitRight : splitLeft;
  const headerRight = previewSwap ? splitLeft  : splitRight;

  const endPanelDrag = useCallback((apply: boolean) => {
    const d = panelDragRef.current;
    panelDragRef.current = null;
    if (!d?.started) return;
    if (d.cursorFrame !== null) cancelAnimationFrame(d.cursorFrame);
    setPanelDrag(null);
    window.oblako.sendSplitDragCursor(null);

    // ⚠️ ИСХОД — ПЕРВЫМ, снятие подсветки — вторым, и порядок тут не косметический. Раскладку
    // жеста в main держит то же сообщение, что и подсветку (см. SPLIT_SWAP_HINT): сними мы её
    // раньше, панели сначала прыгнули бы в исходное положение, и только потом применился бы
    // обмен — то есть на глазах уехало бы туда и обратно. А исход, наоборот, забирает раскладку
    // себе: он уже знает, что вторая панель стоит на новом месте.
    if (apply) {
      if (d.zone === 'swap')         void window.oblako.swapSplitPanels(d.tabId);
      else if (d.zone === 'sidebar') void window.oblako.exitSplit(d.tabId, d.siblingId);
    }
    void window.oblako.setSplitSwapHint(null);
  }, []);

  const handlePanelDragPointerDown = useCallback((
    tabId: string, siblingId: string, side: 'left' | 'right', title: string, favicon: string | null,
  ) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Крестик в шапке — своя кнопка, драг с неё не начинаем.
    if ((e.target as HTMLElement).closest('button')) return;
    // ⚠️ Без preventDefault: он гасит совместимостные mouse-события, а вместе с ними рискует унести
    // и click — а клик по шапке обязан по-прежнему фокусировать панель (onClick рамки). Выделение
    // текста при протяжке снимает userSelect:'none' на самой шапке, отдельный preventDefault не нужен.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panelDragRef.current = {
      tabId, siblingId, side, title, favicon,
      otherRect: null, contentLeft: 0, hint: null,
      startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
      started: false, zone: null, cursorFrame: null, thumb: null,
    };

    // ⚠️ Снимок панели заказываем УЖЕ на нажатии, до порога начала драга. capturePage ждёт
    // следующего скомпонованного кадра (в ScreenshotManager.ts это записано замером: на
    // загруженной машине заметно), и закажи мы его в момент старта — карточка появлялась бы с
    // опозданием ровно тогда, когда человек ждёт отклика. Цена — один лишний снимок на клик по
    // шапке (клик фокусирует панель): он ничего не блокирует и никуда не уходит, кроме мусора.
    void window.oblako.captureSplitPane(
      tabId, SPLIT_DRAG_CARD_CAPTURE_WIDTH, SPLIT_DRAG_CARD_CAPTURE_MAX_HEIGHT,
    ).then((thumb) => {
      const d = panelDragRef.current;
      if (!d || d.tabId !== tabId || !thumb) return;
      d.thumb = thumb;
      // Драг мог начаться раньше, чем пришёл снимок — тогда карточка подменяет подпись на ходу.
      if (d.started) window.oblako.sendSplitDragThumb(thumb);
    });
  }, []);

  const handlePanelDragPointerMove = useCallback((e: React.PointerEvent) => {
    const d = panelDragRef.current;
    if (!d) return;
    d.x = e.clientX;
    d.y = e.clientY;

    if (!d.started) {
      // Порог, как у остальных драгов в проекте: клик по шапке (фокус панели) не должен
      // становиться перетаскиванием.
      if (Math.abs(e.clientX - d.startX) < 5 && Math.abs(e.clientY - d.startY) < 5) return;
      d.started = true;
      const other = (d.side === 'left' ? rightPanelRef : leftPanelRef).current;
      d.otherRect   = other?.getBoundingClientRect() ?? null;
      d.contentLeft = contentRef.current?.getBoundingClientRect().left ?? 0;
      // Координаты окна как есть: оверлей на время жеста растянут на всё окно (см. SplitSwapHint).
      const toRect = (r: DOMRect): ContentBounds =>
        ({ x: r.left, y: r.top, width: r.width, height: r.height });
      d.hint = d.otherRect
        ? { tabId: d.tabId, target: toRect(d.otherRect), title: d.title, favicon: d.favicon, zone: null }
        : null;
      if (d.hint) void window.oblako.setSplitSwapHint(d.hint);
      // Снимок мог прийти ДО начала жеста — тогда оверлея ещё не существовало и сообщение о нём
      // было бы выброшено. Отправляем сразу после подсветки, которая эту вью и поднимает.
      if (d.thumb) window.oblako.sendSplitDragThumb(d.thumb);
      setPanelDrag({ tabId: d.tabId, zone: null });
    }

    // ⚠️ Курсор вне окна — исхода нет. Капчур продолжает слать нам события и за краем окна, и без
    // этой проверки «утащил половину влево за пределы окна» попадало бы в ветку сайдбара
    // (clientX < 0) и рвало сплит. Вынести половину в новое окно этот жест не умеет — значит
    // снаружи он не делает ничего.
    const inWindow = e.clientX >= 0 && e.clientY >= 0
      && e.clientX <= window.innerWidth && e.clientY <= window.innerHeight;
    const r = d.otherRect;
    const zone: 'swap' | 'sidebar' | null = !inWindow ? null
      : r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
        ? 'swap'
        // Левее области контента в окне нет ничего, кроме острова сайдбара.
        : e.clientX < d.contentLeft ? 'sidebar'
        : null;

    if (zone !== d.zone) {
      d.zone = zone;
      if (d.hint) {
        d.hint = { ...d.hint, zone };
        void window.oblako.setSplitSwapHint(d.hint);
      }
      setPanelDrag({ tabId: d.tabId, zone });
    }

    // Курсор — в main не чаще кадра: он идёт потоком, а нужен ровно для того, чтобы карточка ехала
    // за рукой. Один send на кадр драга дешевле, чем рывки вместо анимации.
    if (d.cursorFrame === null) {
      d.cursorFrame = requestAnimationFrame(() => {
        const cur = panelDragRef.current;
        if (!cur) return;
        cur.cursorFrame = null;
        window.oblako.sendSplitDragCursor({ x: cur.x, y: cur.y });
      });
    }
  }, []);

  const handlePanelDragPointerUp     = useCallback(() => endPanelDrag(true),  [endPanelDrag]);
  const handlePanelDragPointerCancel = useCallback(() => endPanelDrag(false), [endPanelDrag]);

  // Пара исчезла посреди жеста (страница закрыла себя, вкладку убили из другого окна) — обрываем
  // драг вместе с ней: иначе на отпускании исход применился бы к паре, которой уже нет, а оверлей
  // остался бы висеть поверх страницы и глотать клики.
  useEffect(() => {
    if (!panelDrag || isSplit) return;
    endPanelDrag(false);
  }, [panelDrag, isSplit, endPanelDrag]);

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
  // Отсечение повторов: pushBounds дёргается из ResizeObserver, window.resize и нескольких
  // эффектов сразу, и они регулярно приходят с ОДНИМ И ТЕМ ЖЕ прямоугольником. Каждое сообщение
  // заставляет main синхронно переставлять WebContentsView активной вкладки (см. чек-лист
  // производительности: «главный поток заблокирован» + «чрезмерный IPC»), поэтому молчание при
  // отсутствии изменений — не микрооптимизация, а снятие лишней работы с main-потока.
  // Модуль-скоуп для ref не годится (компонент один, но так честнее к React) — храним в ref ниже.
  const lastContentBoundsRef = useRef('');
  const sendContentBounds = useCallback((b: { x: number; y: number; width: number; height: number }) => {
    const key = `${b.x},${b.y},${b.width},${b.height}`;
    if (key === lastContentBoundsRef.current) return;
    lastContentBoundsRef.current = key;
    void window.oblako.setContentBounds(b);
  }, []);

  const pushBounds = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    // Загрузки теперь такая же псевдо-вкладка, как История и Настройки (view: null в
    // TabManager, приём хаба): activate() сам прячет ранее показанную реальную вьюху, и
    // отдельное «спрятать контент нулевыми bounds» для оверлея больше не нужно.
    const r = el.getBoundingClientRect();
    // Дропдаун омнибокса больше НЕ резервирует место — нативная вью (SuggestDropdownManager.ts)
    // плавает поверх контента как самостоятельный оверлей (native z-order, addChildView), контенту
    // сдвигаться незачем (заход 5: устранена дублирующая система, см. Toolbar.tsx).
    // ⚠️ Резерва под запрос разрешения здесь больше НЕТ. Приглашение переехало в собственную
    // WebContentsView поверх страницы (electron/PermissionPopoverManager.ts) — раньше оно
    // откусывало 64 px сверху и роняло вёрстку живой страницы вниз-вверх на каждый вопрос.
    sendContentBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
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

  // когда переключаемся между хабом/страницей/псевдо-вкладкой (История/Настройки), геометрия
  // дырки та же, но main должен переотобразить вьюху — пушим bounds ещё раз. activeId один уже
  // покрывает переключение НА/С Истории и Настроек (это теперь обычная смена activeId, не
  // отдельное состояние) — специальных эффектов под них больше не нужно.
  useEffect(() => { pushBounds(); }, [activeId, isHub, pushBounds]);

  // То же для панели загрузок (всё ещё оверлей, не тронута этим заходом).

  // Количество незакреплённых, негруппированных вкладок-единиц верхнего уровня.
  // GroupNode и pinned в счёт не идут — только top-level single + split-pair.
  const organizeTabsCount = sidebarNodes.filter(
    (n) => n.type === 'single' || n.type === 'split-pair',
  ).length;

  const handleOrganize = useCallback(() => {
    if (organizeState === 'computing') return
    setOrganizeState('computing');
    // Спрашиваем факт (была ли модель загружена ДО вызова), а не гадаем по времени — см. комментарий
    // у organizeLongWait. Если модель загрузится между этим вызовом и suggestGroups() (маловероятно,
    // но возможно) — покажем длинное сообщение зря на секунду-другую, ответ придёт быстро и оно
    // само исчезнет; ложная тревога в редком случае лучше, чем мелькание в обычном.
    void window.oblako.getLoadedModelId().then((loadedId) => {
      setOrganizeLongWait(loadedId === null);
      return window.oblako.suggestGroups();
    }).then((proposal) => {
      if (!proposal.ok) { setOrganizeState('model-error'); return; }
      // suggestGroups() возвращает OrganizeCluster[] (без titles) — превью в Sidebar рисует titles
      // (см. ClusterProposal), достаём их здесь же из актуального списка вкладок.
      const tabMap = new Map(allTabsRef.current.map((x) => [x.id, x]));
      const proposals: ClusterProposal[] = proposal.clusters.map((c) => ({
        nodeIds: c.nodeIds,
        nodeTypes: c.nodeTypes,
        titles: c.nodeIds.map((id) => tabMap.get(id)?.title ?? ''),
        suggestedName: c.label,
      }));
      setOrganizeProposal(proposals);
      setOrganizeState('preview');
    }).catch(() => {
      setOrganizeState('model-error');
    });
  }, [organizeState]);

  // Прогресс массового переименования: приезжает push'ем из main по одному имени.
  useEffect(() => window.oblako.onRenameProgress((p) => {
    setRenameProgress(p.done >= p.total ? null : p);
  }), []);

  // ⚠️ Баннер отката гаснет сам. Раньше он висел, пока человек не тронет вкладки руками, —
  // то есть в спокойном сеансе бесконечно, занимая место в полосе вкладок и намекая на
  // незавершённое действие. Пятнадцать секунд — столько живёт «Отменить» у почтовых клиентов:
  // хватает передумать, но плашка не становится частью интерфейса.
  useEffect(() => {
    if (undoDismissed) return;
    if (!hasOrganizeSnapshot && !hasRenameSnapshot) return;
    if (renameProgress) return; // пока имена ещё придумываются, отсчёт не начинаем
    const t = setTimeout(() => setUndoDismissed(true), 15000);
    return () => clearTimeout(t);
  }, [hasOrganizeSnapshot, hasRenameSnapshot, renameProgress, undoDismissed]);

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
    // «Навести порядок» — это два действия подряд: разложить по группам и назвать по-человечески.
    // Второе запускаем сразу за первым, не спрашивая отдельно: человек уже сказал, чего хочет.
    setUndoDismissed(false);
    void window.oblako.renameAllTabs();
  }, [organizeProposal]);

  const handleOrganizeCancel = useCallback(() => {
    setOrganizeState('idle');
    setOrganizeProposal([]);
  }, []);

  // Три отката: только названия, только группы, всё разом. Порознь — потому что «навести
  // порядок» делает два разных дела, и человеку может понравиться одно, но не другое.
  const handleOrganizeRollback = useCallback(() => {
    void window.oblako.organizeRollback();
    setUndoDismissed(true);
  }, []);

  const handleRenameRollback = useCallback(() => {
    void window.oblako.rollbackRenames();
    setUndoDismissed(true);
  }, []);

  const handleRollbackAll = useCallback(() => {
    void window.oblako.rollbackRenames();
    void window.oblako.organizeRollback();
    setUndoDismissed(true);
  }, []);

  const downloadsActive = downloads.some((d) => d.state === 'progressing');
  // Совокупный прогресс всех идущих загрузок — по БАЙТАМ, а не как среднее процентов: иначе
  // мелкий файл рядом с большим тянул бы шкалу вперёд, хотя работа почти не сдвинулась.
  // null — считать нечего (нечего качать либо ни у одного файла неизвестен размер).
  const downloadsProgress = (() => {
    const live = downloads.filter((d) => d.state === 'progressing' && d.totalBytes > 0);
    if (live.length === 0) return null;
    const total = live.reduce((n, d) => n + d.totalBytes, 0);
    const done = live.reduce((n, d) => n + d.receivedBytes, 0);
    return total > 0 ? Math.min(1, done / total) : null;
  })();
  // Тик «началась новая загрузка» — сигнал для анимации прилёта в кнопку. Считаем по ПОЯВЛЕНИЮ
  // нового id, а не по downloadsActive: тот истинен всё время скачивания, и анимация по нему
  // играла бы один раз на пачку файлов либо повторялась на каждом кадре прогресса.
  const seenDownloadIds = useRef<Set<string> | null>(null);
  const [downloadStartTick, setDownloadStartTick] = useState(0);
  useEffect(() => {
    const ids = new Set(downloads.map((d) => d.id));
    // Первый приход списка — это восстановление с диска, а не новые загрузки: запоминаем молча.
    if (seenDownloadIds.current === null) { seenDownloadIds.current = ids; return; }
    // ⚠️ Ловим ЛЮБОЙ новый id, а не только 'progressing'. Мелкий файл успевает докачаться до
    // того, как список доедет до рендерера, и приходит уже 'completed' — по прежнему условию
    // такая загрузка проходила молча, то есть анимация не играла именно на быстрых файлах.
    const fresh = downloads.some((d) => !seenDownloadIds.current!.has(d.id));
    seenDownloadIds.current = ids;
    if (fresh) setDownloadStartTick((n) => n + 1);
  }, [downloads]);

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
    // ⚠️ Цветной фон рисуется ЗДЕСЬ, одним слоем на всё окно. Раньше он жил в Sidebar.tsx и
    // красил только сайдбар — из-за чего тот и выглядел боковой плашкой: цветной прямоугольник
    // слева, серое окно справа. Подкраска это свойство ОКНА, а не панели: одна земля от края до
    // края, под сайдбаром и в зазорах вокруг страницы, а острова лежат на ней сверху.
    // --sidebar-plate (фон выделенных элементов) и --plate-* ставятся тем же слоем: они
    // наследуются вниз сами, и протаскивать флаг через каждый уровень не нужно.
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', overflow: 'hidden',
      ...(ground ? chromeTintStyle(ground.backgroundImage) : null),
      ...(ground ? tintedPlateVars(ground.island) : null),
      ['--sidebar-plate' as string]: ground ? ground.island : 'var(--surface)',
    }}>
      {/* Оверлей во время drag разделителя: держит col-resize курсор по всей ширине
          и служит страховкой на случай если setPointerCapture не перехватит события
          над нативными WebContentsViews. */}
      {(isDragging || isAiPanelDragging) && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          cursor: 'col-resize', userSelect: 'none',
        }} />
      )}
      {/* AI-группировка вкладок живёт в приложении в одном экземпляре и принадлежит полному окну,
          поэтому в лёгком её кнопки нет: organizeTabsCount=0 гасит её тем же условием, что и
          «вкладок слишком мало» (см. Sidebar.tsx). */}
      <Sidebar
        tabs={tabs} activeId={activeId}
        collapsed={effectiveCollapsed}
        onCollapsedChange={handleSidebarCollapse}
        onSelect={select} onClose={close} onNewTab={newTab} onNewTabMenu={() => { void window.oblako.showNewTabMenu(); }}
        onTabMenu={(id) => { void window.oblako.showTabMenu(id); }}
        onSplit={(id) => { setSplitRatioState(0.5); void window.oblako.enterSplit(id); }}
        onExitSplit={(tabId) => { void window.oblako.exitSplit(tabId); }}
        onSettings={() => { void (async () => { setActiveId(await window.oblako.createSpecialTab('settings')); })();  }}
        onHistory={() => { void (async () => { setActiveId(await window.oblako.createSpecialTab('history')); })();  }}
        onReorder={(section, ids) => { void window.oblako.reorderTabs(section, ids); }}
        onMoveSection={(tabId, section, idx) => { void window.oblako.moveTabSection(tabId, section, idx); }}
        sidebarNodes={sidebarNodes}
        onDropOnContent={handleDropOnContent}
        returnHint={panelDrag?.zone === 'sidebar'}
        organizeTabsCount={isLightWindow ? 0 : organizeTabsCount}
        organizeState={organizeState}
        organizeLongWait={organizeLongWait}
        organizeProposal={organizeProposal}
        hasOrganizeSnapshot={hasOrganizeSnapshot}
        hasRenameSnapshot={hasRenameSnapshot}
        renameProgress={renameProgress}
        undoDismissed={undoDismissed}
        onRenameRollback={handleRenameRollback}
        onRollbackAll={handleRollbackAll}
        onDismissUndo={() => setUndoDismissed(true)}
        onOrganize={handleOrganize}
        onOrganizeApply={handleOrganizeApply}
        onOrganizeCancel={handleOrganizeCancel}
        onOrganizeRollback={handleOrganizeRollback}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Toolbar
          tab={active} allTabs={tabs} vpnOn={vpnConn?.state === 'running'}
          isLightWindow={isLightWindow}
          omniboxRef={omniboxRef}
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
          downloadsProgress={downloadsProgress}
          downloadStartTick={downloadStartTick}
          onToggleAiPanel={() => { void window.oblako.toggleAiPanel(); }}
          aiPanelOpen={aiPanelOpen}
          pageTranslateState={pageTranslateState}
          pageTranslateProgress={pageTranslateProgress}
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
          {kind === 'history' || kind === 'bookmarks' || kind === 'downloads' ? (
            // Загрузки теперь третья секция того же острова, а не свой экран — см. HistoryBookmarks.
            // ⚠️ section перекрывает kind: так «Что я отслеживаю» открывается существующим видом
            // вкладки ('history') с секцией 'tracking' — новый вид попал бы в session.json, а
            // менять формат сессии с реальными вкладками человека ради одного экрана несоразмерно.
            <HistoryBookmarks defaultSection={(active?.section as typeof kind) ?? kind} downloads={downloads} onClose={() => void window.oblako.closeTab(activeId)} />
          ) : kind === 'settings' ? (
            <Settings
              // Раздел берём из своей памяти, если человек уже щёлкал по меню в ЭТОЙ вкладке;
              // иначе — тот, с которым вкладку открыли (кнопка «+» AI-панели открывает сразу 'ai').
              defaultSection={settingsSection[activeId] ?? active?.section}
              onSectionChange={(s) => setSettingsSection((prev) => ({ ...prev, [activeId]: s }))}
              onClose={() => void window.oblako.closeTab(activeId)}
              onOpenImport={() => setImportDialog('manual')}
            />
          ) : isSplit ? (
            <div style={{ display: 'flex', height: '100%' }}>
              {/* Левая панель — flex: splitRatio даёт долю от (ширина - ISLAND_GAP). Тот же остров,
                  что у одиночной вкладки (TAB_FRAME_STYLE) — каждая split-половина сама себе
                  «вкладка», bounds считает TabManager.applySplitBounds по этому же прямоугольнику. */}
              <div
                ref={leftPanelRef}
                style={splitPanelStyle(
                  activeId === headerLeft!.id, splitRatio,
                  panelDrag?.tabId === headerLeft!.id,
                )}
                onClick={() => {
                  if (activeId !== splitLeft!.id) void window.oblako.focusSplitPanel('left');
                }}
              >
                <SplitPanelHeader
                  tab={headerLeft!} onClose={() => close(headerLeft!.id)}
                  active={activeId === headerLeft!.id}
                  dragging={panelDrag?.tabId === headerLeft!.id}
                  dragHandlers={{
                    onPointerDown: handlePanelDragPointerDown(
                      headerLeft!.id, headerRight!.id, 'left',
                      headerLeft!.title || headerLeft!.url || 'Вкладка', headerLeft!.faviconUrl,
                    ),
                    onPointerMove: handlePanelDragPointerMove,
                    onPointerUp: handlePanelDragPointerUp,
                    onPointerCancel: handlePanelDragPointerCancel,
                  }}
                />
                <SplitPaneEdge empty={panelDrag?.tabId === headerLeft!.id} />
                {/* Страница ошибки — тоже содержимое этой вкладки, поэтому и она следует за
                    заголовком (headerLeft, не splitLeft: на время превью они меняются местами) и
                    исчезает, пока страницу несут. */}
                {panelDrag?.tabId !== headerLeft!.id && headerLeft!.tabError && (
                  <div style={{ ...SPLIT_PANE_RECT, overflow: 'hidden' }}>
                    <TabError error={headerLeft!.tabError} url={headerLeft!.url}
                      onRetry={() => void window.oblako.reload(headerLeft!.id)}
                      canGoBack={headerLeft!.canGoBack}
                      onBack={() => void window.oblako.goBack(headerLeft!.id)} />
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
                ref={rightPanelRef}
                style={splitPanelStyle(
                  activeId === headerRight!.id, 1 - splitRatio,
                  panelDrag?.tabId === headerRight!.id,
                )}
                onClick={() => {
                  if (activeId !== splitRight!.id) void window.oblako.focusSplitPanel('right');
                }}
              >
                <SplitPanelHeader
                  tab={headerRight!} onClose={() => close(headerRight!.id)}
                  active={activeId === headerRight!.id}
                  dragging={panelDrag?.tabId === headerRight!.id}
                  dragHandlers={{
                    onPointerDown: handlePanelDragPointerDown(
                      headerRight!.id, headerLeft!.id, 'right',
                      headerRight!.title || headerRight!.url || 'Вкладка', headerRight!.faviconUrl,
                    ),
                    onPointerMove: handlePanelDragPointerMove,
                    onPointerUp: handlePanelDragPointerUp,
                    onPointerCancel: handlePanelDragPointerCancel,
                  }}
                />
                <SplitPaneEdge empty={panelDrag?.tabId === headerRight!.id} />
                {panelDrag?.tabId !== headerRight!.id && headerRight!.tabError && (
                  <div style={{ ...SPLIT_PANE_RECT, overflow: 'hidden' }}>
                    <TabError error={headerRight!.tabError} url={headerRight!.url}
                      onRetry={() => void window.oblako.reload(headerRight!.id)}
                      canGoBack={headerRight!.canGoBack}
                      onBack={() => void window.oblako.goBack(headerRight!.id)} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Обычный режим: хаб (прозрачный, без острова), либо реальная вкладка —
               остров-подложка позади неё (см. TAB_FRAME_STYLE) плюс ошибка поверх, если есть. */
            isHub
              ? <Hub
                  tabId={activeId} onSubmit={submit} isLightWindow={isLightWindow}
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
                      canGoBack={active?.canGoBack ?? false}
                      onBack={() => void window.oblako.goBack(activeId)}
                    />
                  )}
                </div>
              )
          )}
          {/* ⚠️ Подсказки «куда отпустить вкладку» здесь НЕТ и быть не может: нативная вью
              страницы лежит поверх React-слоя, и всё, что чром рисует в области контента,
              физически не видно. Зоны рисует своя прозрачная вью поверх страницы — см.
              electron/DropZoneManager.ts и src/dropzones.tsx. */}

          {/* ⚠️ Запроса разрешений здесь тоже нет — по той же причине, что и зон дропа выше:
              он рисуется своей вью поверх страницы (electron/PermissionPopoverManager.ts). */}
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

      {/* Диалог импорта из другого браузера — модалка поверх всего chrome (fixed). Открывается
          только из раздела настроек «Браузер»: первый запуск теперь ведёт Onboarding ниже. */}
      {importDialog && <ImportDialog onClose={() => setImportDialog(null)} />}

      {/* ⚠️ Карточки перетаскиваемой панели здесь НЕТ намеренно: чром лежит под нативными вьюхами
          страниц, и стоило курсору уехать вверх, к тулбару, как низ карточки скрывался под
          страницей — она будто проваливалась внутрь. Всю картинку жеста рисует оверлей, который на
          это время растянут на всё окно (src/dropzones.tsx, electron/DropZoneManager.ts). */}

      {/* Экран первого запуска. Поверх всего и без закрытия кликом мимо — см. Onboarding.tsx. */}
      {onboarding && <Onboarding onFinish={() => setOnboarding(false)} />}
    </div>
  );
}
