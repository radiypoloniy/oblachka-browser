// Единый источник правды по форме данных, которыми обмениваются
// renderer (хром-UI) и main (движок вкладок). Импортируется обеими сторонами.

import type { SearchEngineId } from './searchEngines';

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
  // Вид содержимого вкладки — 'page' обычная страница (реальный WebContentsView), 'hub' —
  // единственный синглтон-хаб (isHub уже покрывает это, kind добавлен для полноты и симметрии
  // с history/settings). 'history'/'settings' — псевдо-вкладки без WebContentsView (view: null
  // в TabManager, тот же приём, что у хаба), обычные tabMap-записи: закрываемые, в нескольких
  // экземплярах, не участвуют в сессии/истории/усыплении (см. TabManager.createSpecialTab —
  // тот же путь #tabUrl()==='' → savable()===false / isHttpView(null)===false, что уже
  // естественно исключает их из session snapshot и sleep-таймера, без отдельных правок там).
  kind: 'page' | 'hub' | 'history' | 'settings';
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
  // Псевдо-вкладка (История/Настройки) — тот же tabMap/nodes-механизм, что обычная вкладка
  // (createTab), но без WebContentsView (kind вместо реального url). См. TabManager.createSpecialTab.
  TAB_CREATE_SPECIAL: 'tab:create-special',
  TAB_CLOSE: 'tab:close',
  TAB_ACTIVATE: 'tab:activate',
  TAB_NAVIGATE: 'tab:navigate',     // omnibox: URL или поисковый запрос
  TAB_GO_BACK: 'tab:go-back',
  TAB_GO_FORWARD: 'tab:go-forward',
  TAB_RELOAD: 'tab:reload',
  CONTENT_SET_BOUNDS: 'content:set-bounds',
  // Прямоугольник «таблетки» омнибокса (координаты окна, тот же формат, что CONTENT_SET_BOUNDS) —
  // фундамент под будущую нативную WebContentsView дропдауна подсказок (пока main его только
  // хранит, ничем не пользуется). Гоняется отдельно от CONTENT_SET_BOUNDS — геометрия контента
  // и геометрия омнибокса меняются по разным причинам (сайдбар/VPN-пилюля vs reserve-панели).
  OMNIBOX_SET_BOUNDS: 'omnibox:set-bounds',
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
  // Заход G, блок 7: векторный поиск для омнибокса (см. electron/HistorySearch.ts, блок 6).
  HISTORY_SEARCH_SEMANTIC: 'history:search-semantic', // renderer → main: query -> SemanticSearchResult[]
  // Умный поиск (Qwen-реранк top-k кандидатов от searchHistorySemantic) — только по явному
  // действию (Enter), НЕ на каждый keystroke, см. HistorySearch.ts::searchHistorySmart.
  HISTORY_SEARCH_SMART: 'history:search-smart', // renderer → main: query -> SemanticSearchResult[]

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

  // Правая AI-панель (Заход 1: пустой каркас-оверлей, см. AiPanelManager.ts)
  AI_PANEL_TOGGLE: 'ai-panel:toggle', // renderer → main: тоггл по клику кнопки AI в тулбаре, вернёт новое состояние (open)

  // Дропдаун подсказок омнибокса — временный тумблер нативной тестовой вью (заход 2/5 переезда
  // с chrome-DOM, см. SuggestDropdownManager.ts), вешается на тот же момент, что и старый
  // React-дропдаун (Toolbar.tsx::openDropdown/closeDropdown), который пока НЕ заменяет.
  SUGGEST_DROPDOWN_TOGGLE: 'suggest-dropdown:toggle',
  // Живой список подсказок (заход 3/5): chrome → main, тот же массив, что buildSuggestions
  // кладёт в setSuggestions() для старого дропдауна. Main пересылает его во вью дропдауна.
  SUGGEST_DROPDOWN_SET_ITEMS: 'suggest-dropdown:set-items',
  // Пользователь кликнул строку ВО вью дропдауна (другой webContents) — main пересылает выбор
  // обратно в chrome, где Toolbar.tsx вызывает свой существующий pickSuggestion(), не дублируя
  // его поведение (activateTab/навигация) во второй раз.
  SUGGEST_DROPDOWN_PICKED: 'suggest-dropdown:picked',
  // Клавиатурная подсветка (заход 4/5): chrome → main → вью, номер строки (-1 = снять подсветку).
  // Омнибокс — единственный владелец selectedIdx, вью только отрисовывает по этому номеру,
  // ничего не решая сама (Enter выполняется локально в омнибоксе, без обращения к вью).
  SUGGEST_DROPDOWN_HIGHLIGHT: 'suggest-dropdown:highlight',
  // Заход 5 (кардинальный фикс): main → chrome, реальный OS-фокус ушёл на контент АКТИВНОЙ
  // вкладки (другой webContents, клик мышью — см. TabManager.wirePageEvents::wc.on('focus')).
  // Единственный сигнал закрытия дропдауна для этого случая — вместо blur омнибокса (см. BACKLOG.md:
  // «blur НИКОГДА не использовать как механику закрытия» — тот же инвариант, что у поповера/FindBar).
  // Клик внутри chromeView (тулбар/сайдбар/хаб) закрывает дропдаун ДРУГИМ, локальным путём
  // (document-level mousedown-capture в Toolbar.tsx) — этот канал только для случая, когда фокус
  // реально ушёл в отдельный webContents страницы.
  SUGGEST_DROPDOWN_CONTENT_FOCUS: 'suggest-dropdown:content-focus',

  // Настройки (пока только поисковик по умолчанию, см. SettingsManager.ts)
  SETTINGS_GET_SEARCH_ENGINE: 'settings:get-search-engine', // renderer → main: текущий SearchEngineId
  SETTINGS_SET_SEARCH_ENGINE: 'settings:set-search-engine', // renderer → main: сменить движок поиска

  // Заход D: ключ Gemini для AI-фактчека (см. AiKeyStore.ts) — ключ сам НИКОГДА не идёт в
  // renderer обратно, только булев статус «подключён/нет». connected-статус пушится и в чром
  // (эта секция настроек), и в AI-панель (см. preload-aipanel.ts) — оба слушателя одного и того
  // же source of truth в main, не два независимых состояния.
  AI_GET_KEY_STATUS:      'ai:get-key-status',      // renderer → main: connected: boolean
  AI_SAVE_KEY:            'ai:save-key',            // renderer → main: (key: string) → boolean (успех)
  AI_DELETE_KEY:          'ai:delete-key',          // renderer → main: удалить ключ
  AI_KEY_STATUS_CHANGED:  'ai:key-status-changed',  // main → renderer: push нового connected-статуса

  // Менеджер паролей, шаг 1 (см. electron/VaultCrypto.ts, electron/PasswordManager.ts) — сейф
  // отдельный от settings.json/истории. Сам пароль пересекает IPC только по явному действию
  // пользователя (reveal) — список и copy никогда не отдают plaintext без явного запроса на него.
  PASSWORDS_LIST:     'passwords:list',     // renderer → main: PasswordMeta[] (без секретов)
  PASSWORDS_REVEAL:   'passwords:reveal',   // renderer → main: id → расшифрованный пароль | null
  PASSWORDS_COPY:     'passwords:copy',     // renderer → main: id, field → main сам кладёт в буфер
  PASSWORDS_ADD:      'passwords:add',      // renderer → main: PasswordAddInput → boolean
  PASSWORDS_UPDATE:   'passwords:update',   // renderer → main: PasswordUpdateInput → boolean
  PASSWORDS_DELETE:   'passwords:delete',   // renderer → main: id
  PASSWORDS_GENERATE: 'passwords:generate', // renderer → main: PasswordGenerateOptions → string
  PASSWORDS_EXPORT:   'passwords:export',   // renderer → main: passphrase → boolean (диалог сохранения в main)
  PASSWORDS_IMPORT:   'passwords:import',   // renderer → main: passphrase → число импортированных записей
  PASSWORDS_CHANGED:  'passwords:changed',  // main → renderer: push после любой мутации (тот же приём, что ADBLOCK_STATE_CHANGED)

  // Менеджер паролей, шаг 2 (см. electron/preload-content.ts, electron/TabManager.ts) — канал
  // ГОСТЕВАЯ СТРАНИЦА ↔ TabManager, через per-view webContents.ipc (не общий ipcMain — main точно
  // знает, какая вкладка прислала сообщение). Content-preload НИКОГДА не шлёт origin — main сам
  // вычисляет его из wc.getURL() (доверенный источник), см. PasswordAutofillManager.ts.
  PASSWORDS_FORM_DETECTED:       'passwords:form-detected',       // гостевая страница → TabManager: { hasLoginForm, hasUsernameField }
  PASSWORDS_CREDENTIAL_SUBMITTED: 'passwords:credential-submitted', // гостевая страница → TabManager: { username, password }
  PASSWORDS_FILL:                'passwords:fill',                // TabManager → конкретная гостевая вкладка: { username, password }, только fill, без submit

  // Заход 10: живые suggest-подсказки текущего поисковика (см. SearchSuggestFetcher.ts) —
  // fetch ТОЛЬКО из main (CORS, см. комментарий в SearchSuggestFetcher.ts). Движок берётся main'ом
  // самостоятельно через SettingsManager.getSearchEngine() — тот же источник истины, что капсула.
  SEARCH_SUGGEST: 'search:suggest',

  // Старт: renderer → main, «React-оболочка отрисована». Окно создаётся show:false
  // (против белого экрана) и показывается по этому сигналу (см. main.ts::createWindow).
  CHROME_UI_READY: 'chrome:ui-ready',

  // Заход G: эмбеддинги считаются ТОЛЬКО в renderer (embeddingService — WASM/WebGPU worker,
  // требует DOM lib, недоступен из electron/main.ts, см. electron/EmbedClient.ts). Общий канал
  // main→renderer→main: одна фраза → один вектор, ничего не знает о вызывающей стороне —
  // используется и индексатором истории (electron/HistoryIndexer.ts), и позже семантическим
  // поиском (блок 6). Логика «что делать с вектором» остаётся у вызывающего в main, не здесь.
  EMBED_REQUEST:  'embed:request',   // main → renderer: { requestId, text }
  EMBED_RESPONSE: 'embed:response',  // renderer → main: EmbedResponsePayload (fire-and-forget send)

  // Заход G, блок 5: разовый бэкфилл уже накопленной истории эмбеддингами. Запускается ТОЛЬКО
  // по явному действию пользователя (см. Settings.tsx::HistoryBackfillSection) — не автоматически.
  HISTORY_BACKFILL_START:    'history:backfill-start',    // renderer → main: запустить (no-op если уже идёт)
  HISTORY_BACKFILL_CANCEL:   'history:backfill-cancel',   // renderer → main: остановить между чанками
  HISTORY_BACKFILL_STATUS:   'history:backfill-status',   // renderer → main: текущий прогресс (синк при открытии панели)
  HISTORY_BACKFILL_PROGRESS: 'history:backfill-progress', // main → renderer: push прогресса
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

// Заход G, блок 6/7 — результат векторного поиска. id/lastVisit/visitCount присутствуют
// намеренно (не только url/title/score) — так результат напрямую совместим с HistoryEntry
// и сливается в тот же byUrl-конвейер Toolbar.tsx::buildSuggestions, что и обычный поиск
// по истории, без отдельной ветки логики дедупа.
export interface SemanticSearchResult {
  id: number;
  url: string;
  title: string;
  lastVisit: number;
  visitCount: number;
  score: number;
}

// ── Эмбеддинги (заход G) ─────────────────────────────────────────────────────
// Общий транспорт main↔renderer: текст на входе, вектор на выходе. requestId — корреляция
// ответа с запросом (в main может быть несколько requestEmbedding() в полёте одновременно).
export interface EmbedRequestPayload {
  requestId: number;
  text: string;
}
export type EmbedResponsePayload =
  | { requestId: number; ok: true; vector: Float32Array; dims: number; modelVersion: string }
  | { requestId: number; ok: false; error: string };

// Заход G, блок 5 — прогресс разового бэкфилла истории.
export interface BackfillProgress {
  processed: number;
  total: number;
  running: boolean;
  cancelled: boolean;
}

// ── Загрузки ─────────────────────────────────────────────────────────────────

// ── Менеджер паролей, шаг 1 (сейф, см. electron/PasswordManager.ts) ───────────
// PasswordMeta — то, что уходит в renderer массово (список): без secret/notes. Сам пароль
// приходит только через revealPassword/copyPasswordField, по явному действию пользователя.
export interface PasswordMeta {
  id: number;
  origin: string;
  url: string;
  username: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface PasswordAddInput {
  url: string;
  username: string;
  password: string;
  title: string;
  notes?: string;
}

// undefined-поля не меняются при update; password: undefined — оставить прежний секрет как есть.
export type PasswordUpdateInput = Partial<Omit<PasswordAddInput, 'password'>> & {
  id: number;
  password?: string;
};

export type PasswordCopyField = 'username' | 'password';

export interface PasswordGenerateOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
}

// ── Дропдаун подсказок омнибокса (нативная вью, заход 3/5) ───────────────────────────────────
// Та же форма, что локальный SuggestItem в Toolbar.tsx (переиспользуется оттуда напрямую) —
// пересекает IPC-границу chrome ↔ main ↔ вью дропдауна, поэтому здесь, а не ad-hoc в одном файле.
// 'suggest' — заход 10, живая веб-подсказка от suggest-API поисковика (не посещённая страница
// и не открытая вкладка — просто фраза-автодополнение, ведёт на её результаты поиска).
export type SuggestKind = 'history' | 'tab' | 'search' | 'suggest';
export interface SuggestDropdownItem {
  kind: SuggestKind;
  label: string;
  sub?: string;
  url: string;
  tabId?: string;
}

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

// ── AI-действия над выделением (перевод / пересказ / объяснение / выжимка) ───
// Общая труба: выделение → координаты → Qwen (промпт зависит от action) → поповер → стриминг.
// Добавить новое действие = добавить пункт меню (TabManager.ts) + промпт (TranslationService.ts) —
// без нового поповер-кода, см. AiActionOutcome ниже (один контракт результата на все действия).

export type AiAction = 'translate' | 'summarize' | 'simplify' | 'explain';

// Любая пара языков после автоопределения ('fr->ru', 'ru->en', ...), не только ru/en.
// Заполняется только для action:'translate' — остальные действия отвечают на языке оригинала,
// у них нет пары src->tgt.
export type TranslateDirection = `${string}->${string}`;

export type AiActionOutcome =
  | { ok: true; out: string; action: AiAction; dirUsed?: TranslateDirection; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string };

// Тип API, который preload пробрасывает в window.oblako
export interface OblakoApi {
  // Атомарный начальный запрос + подписка (заменяют getAllTabs+getSidebarNodes+onTabsChanged+onSidebarNodesChanged).
  getSyncState(): Promise<SyncState>;
  onSyncChanged(cb: (state: SyncState) => void): () => void;

  getAllTabs(): Promise<TabState[]>;
  createTab(url?: string): Promise<string>;       // вернёт id новой вкладки
  // Псевдо-вкладка (История/Настройки) — та же жизнь (закрытие/активация), что у обычной,
  // просто без WebContentsView. См. shared/ipc.ts::TabState.kind, TabManager.createSpecialTab.
  createSpecialTab(kind: 'history' | 'settings'): Promise<string>;
  closeTab(id: string): Promise<void>;
  activateTab(id: string): Promise<void>;
  navigate(id: string, input: string): Promise<void>;
  goBack(id: string): Promise<void>;
  goForward(id: string): Promise<void>;
  reload(id: string): Promise<void>;
  setContentBounds(bounds: ContentBounds): Promise<void>;
  // Прямоугольник омнибокса — see IPC.OMNIBOX_SET_BOUNDS. Пока только сохраняется в main,
  // без вью-потребителя (см. shared/ipc.ts::IPC).
  setOmniboxBounds(bounds: ContentBounds): Promise<void>;
  setTitleBarOverlay(opts: TitleBarOpts): Promise<void>;
  // Сигнал «оболочка отрисована» — main показывает скрытое до этого окно (см. IPC.CHROME_UI_READY).
  chromeUiReady(): void;
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
  clearHistory(period: HistoryClearPeriod): Promise<boolean>; // false — очистка не выполнилась, см. HistoryManager.ts::clearHistory
  onHistoryOpen(cb: () => void): () => void;
  // Заход G, блок 7 — векторный поиск (см. electron/HistorySearch.ts, блок 6).
  searchHistorySemantic(query: string): Promise<SemanticSearchResult[]>;
  // Умный поиск — Qwen-реранк top-k кандидатов, только по явному Enter (см. HistorySearch.ts).
  searchHistorySmart(query: string): Promise<SemanticSearchResult[]>;

  // Заход G — общий канал эмбеддингов main→renderer→main (см. electron/EmbedClient.ts,
  // src/services/EmbedRequestBridge.ts). embeddingService живёт только в renderer.
  onEmbedRequest(cb: (req: EmbedRequestPayload) => void): () => void;
  sendEmbedResponse(res: EmbedResponsePayload): void;

  // Заход G, блок 5 — разовый бэкфилл истории (см. electron/HistoryBackfill.ts).
  startHistoryBackfill(): void;
  cancelHistoryBackfill(): void;
  getHistoryBackfillStatus(): Promise<BackfillProgress>;
  onHistoryBackfillProgress(cb: (p: BackfillProgress) => void): () => void;

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

  // Правая AI-панель (оверлей поверх контента, см. AiPanelManager.ts)
  toggleAiPanel(): Promise<boolean>;

  // Дропдаун подсказок омнибокса — временный тумблер тестовой нативной вью (заход 2/5,
  // см. SuggestDropdownManager.ts). Прямоугольник омнибокса — см. setOmniboxBounds выше.
  setSuggestDropdownOpen(open: boolean): Promise<void>;
  // Живой список подсказок (заход 3/5) — тот же массив, что buildSuggestions строит для
  // старого дропдауна, пересылается во вью нативного дропдауна.
  setSuggestDropdownItems(items: SuggestDropdownItem[]): Promise<void>;
  // Пользователь кликнул строку во вью дропдауна — Toolbar.tsx вызывает свой pickSuggestion().
  onSuggestDropdownPicked(cb: (item: SuggestDropdownItem) => void): () => void;
  // Клавиатурная подсветка (заход 4/5) — номер строки, -1 снимает подсветку. Омнибокс держит
  // selectedIdx, вью только рисует по этому номеру.
  setSuggestDropdownHighlight(idx: number): Promise<void>;
  // Заход 5 — реальный OS-фокус ушёл на контент активной вкладки (независимый от blur сигнал
  // закрытия дропдауна, см. IPC.SUGGEST_DROPDOWN_CONTENT_FOCUS).
  onSuggestDropdownContentFocus(cb: () => void): () => void;

  // Заход 10 — живые suggest-подсказки текущего поисковика (см. SearchSuggestFetcher.ts).
  // Пустой массив на любой сбой (нет сети/таймаут/лимит) — never throws, вызывающая сторона
  // (Toolbar.tsx::buildSuggestions) не обязана оборачивать в try/catch отдельно.
  fetchSuggestions(query: string): Promise<string[]>;

  // Настройки
  getSearchEngine(): Promise<SearchEngineId>;
  setSearchEngine(id: SearchEngineId): Promise<void>;

  // Заход D — ключ Gemini (AI-фактчек). Сам ключ никогда не приходит в renderer — только статус.
  getAiKeyStatus(): Promise<boolean>;
  saveAiKey(key: string): Promise<boolean>;
  deleteAiKey(): Promise<void>;
  onAiKeyStatusChanged(cb: (connected: boolean) => void): () => void;

  // Менеджер паролей, шаг 1 (см. electron/PasswordManager.ts). Пароль пересекает IPC только
  // через revealPassword/generatePassword — listPasswords им не отдаёт, copyPasswordField сам
  // кладёт значение в буфер в main и наружу его не возвращает.
  listPasswords(): Promise<PasswordMeta[]>;
  revealPassword(id: number): Promise<string | null>;
  copyPasswordField(id: number, field: PasswordCopyField): Promise<boolean>;
  addPassword(input: PasswordAddInput): Promise<boolean>;
  updatePassword(input: PasswordUpdateInput): Promise<boolean>;
  deletePassword(id: number): Promise<void>;
  generatePassword(opts: PasswordGenerateOptions): Promise<string>;
  // Диалог сохранения/открытия файла — целиком в main (см. main.ts::registerIpc). Возвращает
  // false/0, если пользователь отменил диалог или passphrase не подошла — не бросает наружу.
  exportPasswords(passphrase: string): Promise<boolean>;
  importPasswords(passphrase: string): Promise<number>;
  onPasswordsChanged(cb: () => void): () => void;

  // Флаг предзагрузки эмбеддинг-модели: false при OBLAKO_PRELOAD_EMBED=0.
  readonly embedPreload: boolean;
}
