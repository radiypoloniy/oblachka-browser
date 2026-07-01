// Единый источник правды по форме данных, которыми обмениваются
// renderer (хром-UI) и main (движок вкладок). Импортируется обеими сторонами.

// ── Узлы сайдбара ─────────────────────────────────────────────────────────────
// Дискриминированное объединение для трёх типов узлов.
// Phase 0: создаются только SingleNode.
// Phase 2+: split-pair и group.
export interface SingleNode {
  type: 'single';
  tabId: string;
}
export interface SplitPairNode {
  type: 'split-pair';
  leftTabId: string;
  rightTabId: string;
  ratio: number; // 0.2..0.8
}
export interface GroupNode {
  type: 'group';
  id: string;           // стабильный UUID для dnd-kit
  label: string;
  color: string | null; // 'red'|'orange'|'yellow'|'green'|'blue'|'purple'|null
  children: SidebarNode[];
  collapsed: boolean;
}
export type SidebarNode = SingleNode | SplitPairNode | GroupNode;

export interface FindResult {
  activeMatch: number; // порядковый номер текущего совпадения (1-based)
  count: number;       // всего совпадений
}

export interface TabErrorState {
  type: 'load' | 'crash';
  code: number;   // errorCode из did-fail-load; 0 при краше
  url: string;    // URL, который не открылся — для показа и retry
}

export interface TabState {
  id: string;
  isActive: boolean;    // true = эта вкладка сейчас активна в main-процессе
  tabError: TabErrorState | null; // null = нет ошибки
  url: string;          // текущий реальный URL вкладки
  title: string;        // заголовок страницы (document.title)
  faviconUrl: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isHub: boolean;       // true = вкладка-хаб (наш UI), без WebContentsView
  isPinned: boolean;    // закреплена — переживает перезапуск, нельзя закрыть крестиком
  splitSide: 'left' | 'right' | null; // null = не в split-режиме
  isSleeping: boolean;  // WebContentsView выгружен, хранятся только url/title/favicon
}

// Атомарный снимок: вкладки + структура сайдбара в одном сообщении.
// Заменяет два раздельных push-канала TABS_CHANGED + SIDEBAR_NODES_CHANGED, чтобы
// renderer никогда не рендерил половинчатое состояние (узел пары есть, вкладка ещё нет).
export interface SyncState {
  tabs: TabState[];
  nodes: SidebarNode[];
  hasOrganizeSnapshot: boolean; // true = доступен откат последней AI-группировки
}

// Один предложенный кластер от ClusteringService → TabManager.applyOrganize().
export interface OrganizeCluster {
  nodeIds:   string[];                       // tabId (single) или leftTabId (split-pair)
  nodeTypes: ('single' | 'split-pair')[];   // по позиции
  label:     string;                         // название группы
}

// Геометрия "дырки" под контент в координатах окна (CSS-пиксели).
// Renderer измеряет область и сообщает main, куда класть WebContentsView.
export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Канал renderer -> main (invoke/send). Имена держим в одном месте.
export const IPC = {
  // Запросы (renderer -> main, ожидают ответ)
  TABS_GET_ALL: 'tabs:get-all',
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_ACTIVATE: 'tab:activate',
  TAB_NAVIGATE: 'tab:navigate',     // omnibox: URL или поисковый запрос
  TAB_GO_BACK: 'tab:go-back',
  TAB_GO_FORWARD: 'tab:go-forward',
  TAB_RELOAD: 'tab:reload',
  CONTENT_SET_BOUNDS: 'content:set-bounds',
  WINDOW_SET_OVERLAY: 'window:set-overlay', // обновить цвет иконок titleBarOverlay

  // Атомарный push: заменяет раздельные TABS_CHANGED + SIDEBAR_NODES_CHANGED.
  // Один IPC-пакет = один рендер = нет рассинхрона между вкладками и деревом узлов.
  SYNC_CHANGED: 'sync:changed',     // main → renderer: SyncState { tabs, nodes }
  SYNC_GET:     'sync:get',         // renderer → main: начальный атомарный запрос

  // События (main -> renderer, односторонние)
  TABS_CHANGED: 'tabs:changed',     // @deprecated → используй SYNC_CHANGED

  // Поиск по странице
  FIND_START:  'find:start',        // renderer → main: начать/обновить поиск
  FIND_NEXT:   'find:next',         // renderer → main: следующее/предыдущее совпадение
  FIND_STOP:   'find:stop',         // renderer → main: остановить поиск
  FIND_RESULT: 'find:result',       // main → renderer: результат (activeMatch, count)
  FIND_OPEN:   'find:open',         // main → renderer: открыть панель поиска (Ctrl+F)
  FIND_CLOSE:  'find:close',        // main → renderer: закрыть панель (навигация, Esc)

  // Омнибокс
  OMNIBOX_FOCUS: 'omnibox:focus',   // main → renderer: сфокусировать адресную строку (Ctrl+L)

  // Закреплённые вкладки
  TAB_PIN_TOGGLE: 'tab:pin-toggle', // renderer → main: закрепить / открепить вкладку
  TAB_SHOW_MENU:  'tab:show-menu',  // renderer → main: показать нативное ПКМ-меню вкладки

  // Split View
  TAB_ENTER_SPLIT:  'tab:enter-split',  // renderer → main: войти в split (правая вкладка)
  TAB_EXIT_SPLIT:   'tab:exit-split',   // renderer → main: выйти из split, обе вкладки остаются
  TAB_SPLIT_FOCUS:  'tab:split-focus',  // renderer → main: переключить фокус на панель
  TAB_SPLIT_RATIO:  'tab:split-ratio',  // renderer → main: новое соотношение панелей при drag

  // Переупорядочивание вкладок drag-and-drop
  TAB_REORDER: 'tab:reorder',           // renderer → main: { section, orderedIds } после drop
  TAB_MOVE_SECTION: 'tab:move-section', // renderer → main: перенос между секциями { tabId, targetSection, targetIndex }

  // Группы вкладок (Phase 3)
  SIDEBAR_NODES_GET:          'sidebar:nodes-get',          // renderer → main: запрос текущего SidebarNode[]
  SIDEBAR_NODES_CHANGED:      'sidebar:nodes-changed',      // main → renderer: push SidebarNode[] при любом изменении
  GROUP_CREATE:               'group:create',               // renderer → main: tabId → создать группу вокруг вкладки
  GROUP_ADD_TAB:              'group:add-tab',              // renderer → main: groupId, tabId → переместить в группу
  GROUP_REMOVE_TAB:           'group:remove-tab',           // renderer → main: groupId, tabId → вынуть из группы
  GROUP_RENAME:               'group:rename',               // renderer → main: groupId, label
  GROUP_COLOR:                'group:color',                // renderer → main: groupId, color | null
  GROUP_TOGGLE_COLLAPSE:      'group:toggle-collapse',      // renderer → main: groupId
  GROUP_DISBAND:              'group:disband',              // renderer → main: groupId → расформировать
  GROUP_REORDER_CHILDREN:     'group:reorder-children',     // renderer → main: groupId, orderedIds[]
  GROUP_SHOW_MENU:            'group:show-menu',            // renderer → main: нативный ПКМ заголовка группы
  GROUP_RENAME_PROMPT:        'group:rename-prompt',        // main → renderer: начать inline-переименование (push)

  // AdBlock
  ADBLOCK_GET_STATE:      'adblock:get-state',      // renderer → main: получить AdBlockState
  ADBLOCK_SET_ENABLED:    'adblock:set-enabled',    // renderer → main: вкл/выкл (boolean)
  ADBLOCK_ADD_DOMAIN:     'adblock:add-domain',     // renderer → main: домен в whitelist
  ADBLOCK_REMOVE_DOMAIN:  'adblock:remove-domain',  // renderer → main: убрать из whitelist
  ADBLOCK_RELOAD_TABS:    'adblock:reload-tabs',    // renderer → main: перезагрузить вкладки (domain?: string)
  ADBLOCK_STATE_CHANGED:  'adblock:state-changed',  // main → renderer: новый AdBlockState (push)

  // История посещений
  HISTORY_GET:    'history:get',     // renderer → main: последние N записей
  HISTORY_SEARCH: 'history:search',  // renderer → main: поиск по url/title (string)
  HISTORY_DELETE: 'history:delete',  // renderer → main: удалить запись (id: number)
  HISTORY_CLEAR:  'history:clear',   // renderer → main: очистить за период ('hour'|'day'|'week'|'all')
  HISTORY_OPEN:   'history:open',    // main → renderer: открыть панель истории (Ctrl+H)

  // Разрешения сайтов
  PERMISSION_REQUEST:  'permission:request',    // main → renderer: входящий запрос (PermissionRequest)
  PERMISSION_RESPONSE: 'permission:response',   // renderer → main: ответ пользователя (requestId, granted, remember)

  // Загрузки
  DOWNLOADS_GET_ALL:    'downloads:get-all',    // renderer → main: текущий список
  DOWNLOADS_CHANGED:    'downloads:changed',    // main → renderer: обновлённый список (push)
  DOWNLOADS_OPEN:       'downloads:open',       // main → renderer: открыть панель (Ctrl+J)
  DOWNLOAD_PAUSE:       'download:pause',       // renderer → main: пауза (id)
  DOWNLOAD_RESUME:      'download:resume',      // renderer → main: продолжить (id)
  DOWNLOAD_CANCEL:      'download:cancel',      // renderer → main: отмена (id)
  DOWNLOAD_CLEAR:       'download:clear',       // renderer → main: убрать из списка (id)
  DOWNLOAD_OPEN_FILE:   'download:open-file',   // renderer → main: открыть файл (id)
  DOWNLOAD_SHOW_FOLDER: 'download:show-folder', // renderer → main: показать в папке (id)
  DOWNLOAD_RETRY:       'download:retry',       // renderer → main: повторить загрузку (id)

  // AI-группировка вкладок (Phase 4)
  TABS_ORGANIZE_APPLY:    'tabs:organize-apply',    // renderer → main: OrganizeCluster[] → сгруппировать
  TABS_ORGANIZE_ROLLBACK: 'tabs:organize-rollback', // renderer → main: откатить последнюю группировку
} as const;

// Параметры titleBarOverlay для динамического обновления (смена темы).
export type TitleBarOpts = { color?: string; symbolColor?: string; height?: number };

// ── История посещений ────────────────────────────────────────────────────────
export interface HistoryEntry {
  id: number;
  url: string;
  title: string;
  lastVisit: number;  // Unix ms
  visitCount: number;
}

export type HistoryClearPeriod = 'hour' | 'day' | 'week' | 'all';

// ── Загрузки ─────────────────────────────────────────────────────────────────

export type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted';

export interface DownloadEntry {
  id: string;
  filename: string;
  url: string;
  savePath: string;       // пустая строка пока не завершено / пользователь не выбрал путь
  mime: string;
  totalBytes: number;     // 0 = неизвестен до получения Content-Length
  receivedBytes: number;
  state: DownloadState;
  startedAt: number;      // Unix ms
  isPaused: boolean;
  bytesPerSec: number;    // 0 = неизвестна или завершено
}

// ── AdBlock ─────────────────────────────────────────────────────────────────
export interface AdBlockState {
  enabled: boolean;
  whitelist: string[];        // нормализованные домены (без www., без схемы)
  sessionBlockCount: number;  // счётчик за текущую сессию (сбрасывается при перезапуске)
}

// ── Разрешения сайтов ────────────────────────────────────────────────────────

// Ключи разрешений (используются и как ключи в БД, и в UI).
// «camera+microphone» — виртуальный ключ для одновременного запроса обоих.
export type PermKey =
  | 'camera' | 'microphone' | 'camera+microphone'
  | 'geolocation' | 'notifications' | 'fullscreen'
  | 'clipboard-read' | 'clipboard-sanitized-write';

export interface PermissionRequest {
  requestId: string;
  origin: string;    // e.g. "https://meet.google.com"
  permission: PermKey;
}

// ── Перевод выделения ───────────────────────────────────────────────────────

// Любая пара языков после автоопределения ('fr->ru', 'ru->en', ...), не только ru/en.
export type TranslateDirection = `${string}->${string}`;

export type TranslateOutcome =
  | { ok: true; out: string; dirUsed: TranslateDirection; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string };

// Тип API, который preload пробрасывает в window.oblako
export interface OblakoApi {
  // Атомарный начальный запрос + подписка (заменяют getAllTabs+getSidebarNodes+onTabsChanged+onSidebarNodesChanged).
  getSyncState(): Promise<SyncState>;
  onSyncChanged(cb: (state: SyncState) => void): () => void;

  getAllTabs(): Promise<TabState[]>;
  createTab(url?: string): Promise<string>;       // вернёт id новой вкладки
  closeTab(id: string): Promise<void>;
  activateTab(id: string): Promise<void>;
  navigate(id: string, input: string): Promise<void>;
  goBack(id: string): Promise<void>;
  goForward(id: string): Promise<void>;
  reload(id: string): Promise<void>;
  setContentBounds(bounds: ContentBounds): Promise<void>;
  setTitleBarOverlay(opts: TitleBarOpts): Promise<void>;
  onTabsChanged(cb: (tabs: TabState[]) => void): () => void; // вернёт unsubscribe

  // Поиск по странице
  findStart(query: string, forward: boolean): Promise<void>;
  findNext(forward: boolean): Promise<void>;
  findStop(): Promise<void>;
  onFindResult(cb: (r: FindResult) => void): () => void;
  onFindOpen(cb: () => void): () => void;
  onFindClose(cb: () => void): () => void;

  // Омнибокс
  onOmniboxFocus(cb: () => void): () => void;

  // Закреплённые вкладки
  togglePinTab(id: string): Promise<void>;
  showTabMenu(id: string): Promise<void>;

  // Split View
  enterSplit(rightId: string): Promise<void>;       // текущая активная → левая, rightId → правая
  exitSplit(): Promise<void>;                       // схлопнуть split, обе вкладки остаются
  focusSplitPanel(side: 'left' | 'right'): Promise<void>; // переключить активную панель
  setSplitRatio(ratio: number): Promise<void>;      // drag разделителя: 0.2..0.8

  // Переупорядочивание drag-and-drop
  reorderTabs(section: 'normal' | 'pinned', orderedIds: string[]): Promise<void>;
  moveTabSection(tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number): Promise<void>;

  // Структура сайдбара (дерево узлов)
  getSidebarNodes(): Promise<SidebarNode[]>;
  onSidebarNodesChanged(cb: (nodes: SidebarNode[]) => void): () => void;

  // Группы вкладок
  createGroup(tabId: string): Promise<void>;
  addTabToGroup(groupId: string, tabId: string): Promise<void>;
  removeTabFromGroup(groupId: string, tabId: string): Promise<void>;
  renameGroup(groupId: string, label: string): Promise<void>;
  setGroupColor(groupId: string, color: string | null): Promise<void>;
  toggleGroupCollapse(groupId: string): Promise<void>;
  disbandGroup(groupId: string): Promise<void>;
  reorderGroupChildren(groupId: string, orderedIds: string[]): Promise<void>;
  showGroupMenu(groupId: string): Promise<void>;
  onGroupRenamePrompt(cb: (groupId: string) => void): () => void;

  // AdBlock
  getAdBlockState(): Promise<AdBlockState>;
  setAdBlockEnabled(enabled: boolean): Promise<void>;
  adBlockAddDomain(domain: string): Promise<void>;
  adBlockRemoveDomain(domain: string): Promise<void>;
  adBlockReloadTabs(domain?: string): Promise<void>;
  onAdBlockStateChanged(cb: (state: AdBlockState) => void): () => void;

  // История посещений
  getHistory(limit?: number): Promise<HistoryEntry[]>;
  searchHistory(query: string): Promise<HistoryEntry[]>;
  deleteHistoryEntry(id: number): Promise<void>;
  clearHistory(period: HistoryClearPeriod): Promise<void>;
  onHistoryOpen(cb: () => void): () => void;

  // Разрешения сайтов
  respondPermission(requestId: string, granted: boolean, remember: boolean): Promise<void>;
  onPermissionRequest(cb: (req: PermissionRequest) => void): () => void;

  // Загрузки
  getDownloads(): Promise<DownloadEntry[]>;
  pauseDownload(id: string): Promise<void>;
  resumeDownload(id: string): Promise<void>;
  cancelDownload(id: string): Promise<void>;
  clearDownload(id: string): Promise<void>;
  openDownloadFile(id: string): Promise<void>;
  showDownloadFolder(id: string): Promise<void>;
  retryDownload(id: string): Promise<void>;
  onDownloadsChanged(cb: (entries: DownloadEntry[]) => void): () => void;
  onDownloadsOpen(cb: () => void): () => void;

  // AI-группировка вкладок (Phase 4)
  organizeApply(clusters: OrganizeCluster[]): Promise<void>;
  organizeRollback(): Promise<void>;

  // Флаг предзагрузки эмбеддинг-модели: false при OBLAKO_PRELOAD_EMBED=0.
  readonly embedPreload: boolean;
}
