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

// Партиция инкогнито-вкладок: БЕЗ префикса 'persist:' → сессия in-memory (куки/кэш/хранилище не
// пишутся на диск, живут только в памяти процесса). Общая для всех инкогнито-вкладок текущего
// запуска. Импортируется и main (создание сессии/привязка адблока/прокси), и TabManager
// (webPreferences.partition новой вьюхи). Данные чистятся при закрытии последней инкогнито-вкладки.
export const INCOGNITO_PARTITION = 'oblako-incognito';

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
  kind: 'page' | 'hub' | 'history' | 'settings' | 'bookmarks';
  // Начальный раздел для kind==='settings' (напр. 'ai') — необязателен, задаётся только когда
  // createSpecialTab('settings', section) вызван с разделом (см. AiPanelManager.ts кнопка "+" в
  // AI-панели). Для всех остальных kind не используется.
  section?: string;
}

// Атомарный снимок: вкладки + структура сайдбара в одном сообщении.
// Заменяет два раздельных push-канала TABS_CHANGED + SIDEBAR_NODES_CHANGED, чтобы
// renderer никогда не рендерил половинчатое состояние (узел пары есть, вкладка ещё нет).
export interface SyncState {
  tabs: TabState[];
  nodes: SidebarNode[];
  hasOrganizeSnapshot: boolean; // true = доступен откат последней AI-группировки
}

// Один предложенный кластер от TabOrganizer.ts → TabManager.applyOrganize().
export interface OrganizeCluster {
  nodeIds:   string[];                       // tabId (single) или leftTabId (split-pair)
  nodeTypes: ('single' | 'split-pair')[];   // по позиции
  label:     string;                         // название группы
}

// Тот же кластер, но для renderer-превью в App.tsx/Sidebar.tsx (до применения): titles — заголовки
// вкладок для показа списком, suggestedName — предложенное имя ДО того, как пользователь мог его
// принять (после «Применить» оно становится OrganizeCluster.label). Раньше жил в
// ClusteringService.ts (эмбеддинг-кластеризация, удалена) — тип пережил саму реализацию, всё ещё
// нужен для формы превью TabOrganizer.ts::suggestGroups().
export interface ClusterProposal {
  nodeIds: string[];
  nodeTypes: ('single' | 'split-pair')[];
  titles: string[];
  suggestedName: string;
}

// Результат TabOrganizer.ts::suggestGroups() — та же форма кластеров (OrganizeCluster), что уже
// умеет применять TabManager.applyOrganize()/renderer-превью. modelWasCold — была ли модель
// незагруженной НА ВХОДЕ в вызов (on-demand режим): группировка сама триггерит холодную загрузку,
// не отказывает — UI использует этот флаг, чтобы решить, показывать ли предупреждение про долгую
// первую загрузку (см. App.tsx::handleOrganize). ok:false — тот же формат ошибки, что
// TranslateResult/AiActionOutcome (errorCode из ModelErrorCode, где применимо) — раньше здесь была
// узкая MODEL_NOT_LOADED, но с уходом гейта вызов может упасть на реальной загрузке модели
// (NO_MODEL_INSTALLED/MODEL_FILE_MISSING/т.п.), а не только по этой одной причине.
export type OrganizeProposal =
  | { ok: true; clusters: OrganizeCluster[]; modelWasCold: boolean }
  | { ok: false; error: string; errorCode?: ModelErrorCode };

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
  TAB_CREATE_INCOGNITO: 'tab:create-incognito', // приватная вкладка: in-memory сессия, без истории/автосейва
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
  // Заход «Защита» (шаг 2, без UI) — точечный геттер вместо всего AdBlockState.whitelist,
  // домен → в исключениях ли он. Пока без потребителя в window.oblako — заберёт поповер VPN-пилюли
  // через свой отдельный мост (см. preload-vpnpopover.ts), когда адблок-секция въедет туда.
  ADBLOCK_IS_WHITELISTED: 'adblock:is-whitelisted', // renderer → main: домен (или URL) → boolean
  // Заход «Защита» (шаг 3) — per-site счётчик из AdBlockManager.getBlockedCountForDomain (шаг 1).
  ADBLOCK_GET_SITE_BLOCK_COUNT: 'adblock:get-site-block-count', // renderer → main: домен (или URL) → number

  // История посещений
  HISTORY_GET:    'history:get',     // renderer → main: последние N записей
  HISTORY_SEARCH: 'history:search',  // renderer → main: поиск по url/title (string)
  HISTORY_DELETE: 'history:delete',  // renderer → main: удалить запись (id: number)
  HISTORY_CLEAR:  'history:clear',   // renderer → main: очистить за период ('hour'|'day'|'week'|'all')
  HISTORY_OPEN:   'history:open',    // main → renderer: открыть панель истории (Ctrl+H)
  // Умный поиск (лексика + FTS по тексту чанков, Qwen-реранк top-k кандидатов) — только по явному
  // действию (Enter), НЕ на каждый keystroke, см. HistorySearch.ts::searchHistorySmart.
  HISTORY_SEARCH_SMART: 'history:search-smart', // renderer → main: query -> SmartSearchResponse

  // Закладки — плоский список (parentId всегда null в Feature 1, см. BookmarkManager.ts)
  BOOKMARK_ADD:           'bookmark:add',            // renderer → main: (url, title) -> BookmarkEntry | null
  BOOKMARK_REMOVE:        'bookmark:remove',         // renderer → main: удалить по id (панель закладок)
  BOOKMARK_REMOVE_BY_URL: 'bookmark:remove-by-url',  // renderer → main: снять звезду по url (омнибокс)
  BOOKMARK_LIST:          'bookmark:list',            // renderer → main: весь плоский список корня
  BOOKMARK_IS_BOOKMARKED: 'bookmark:is-bookmarked',   // renderer → main: url -> boolean
  BOOKMARK_CHANGED:       'bookmark:changed',         // main → renderer: что-то изменилось (push, без пейлоада)
  // Импорт закладок из других браузеров (см. electron/bookmarkImport/) — пока только Chromium-
  // семейство (Chrome/Edge/Brave/Яндекс.Браузер), Firefox/Safari тем же интерфейсом позже.
  BOOKMARK_IMPORT_LIST_SOURCES: 'bookmark:import-list-sources', // renderer → main: реально найденные на диске браузеры
  BOOKMARK_IMPORT_RUN:          'bookmark:import-run',          // renderer → main: sourceId -> {inserted, skipped} | null

  // Общий импорт данных из других браузеров (закладки/история/пароли) — см. electron/browserImport/.
  // В отличие от BOOKMARK_IMPORT_* (панель закладок, только закладки) — это мультитиповый импорт с
  // выбором пользователя, что переносить (диалог импорта + онбординг первого запуска).
  IMPORT_LIST_SOURCES: 'import:list-sources', // renderer → main: ImportSource[] (браузер+профиль + доступные типы)
  IMPORT_RUN:          'import:run',          // renderer → main: (sourceId, dataTypes[]) -> ImportRunResult
  IMPORT_SHOULD_OFFER: 'import:should-offer', // renderer → main: показать ли онбординг импорта на этом старте
  IMPORT_MARK_OFFERED: 'import:mark-offered', // renderer → main: пометить, что предложение импорта уже показано

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
  TABS_SUGGEST_GROUPS:    'tabs:suggest-groups',    // renderer → main: TabOrganizer.ts::suggestGroups() → OrganizeProposal

  // Правая AI-панель (Заход 1: пустой каркас-оверлей, см. AiPanelManager.ts)
  AI_PANEL_TOGGLE: 'ai-panel:toggle', // renderer → main: тоггл по клику кнопки AI в тулбаре, вернёт новое состояние (open)
  // Заход 3: main → chrome, push при ЛЮБОМ закрытии/открытии дока (крестик и Escape ВНУТРИ
  // панели идут через свой ad-hoc ai-panel:close — то не долетало до chrome, из-за чего
  // резерв ширины в App.tsx оставался висеть после закрытия крестиком). Тот же паттерн, что
  // ADBLOCK_STATE_CHANGED/VPN_CONNECTION_STATE_CHANGED — main единственный источник истины,
  // chrome только слушает push, независимо от того, ЧЕМ панель закрыли.
  AI_PANEL_STATE_CHANGED: 'ai-panel:state-changed',

  // Полностраничный перевод (см. electron/PageTranslateManager.ts) — кнопка в тулбаре заменяет
  // текст прямо в DOM активной вкладки локальным Qwen (TranslationService.ts::translatePageBatch),
  // без поповера/панели. Только про АКТИВНУЮ вкладку — переключение вкладок само пересылает
  // актуальное состояние (тот же принцип, что PASSWORDS_INDICATOR_CHANGED).
  PAGE_TRANSLATE_TOGGLE:        'page-translate:toggle',         // renderer → main: тоггл для активной вкладки
  PAGE_TRANSLATE_GET_STATE:     'page-translate:get-state',      // renderer → main: текущее состояние активной вкладки (гонка старта — см. onPageTranslateStateChanged)
  PAGE_TRANSLATE_STATE_CHANGED: 'page-translate:state-changed',  // main → renderer: push PageTranslateState
  PAGE_TRANSLATE_PROGRESS_CHANGED: 'page-translate:progress-changed', // main → renderer: push PageTranslateProgress|null

  // Выбор движка перевода страниц (Qwen/Bergamot, см. electron/TranslationEngineRegistry.ts) —
  // настройки → секция AI. BERGAMOT_STATUS — только push, статус живёт в electron/BergamotService.ts
  // (спавнится/греется на старте main.ts независимо от того, какой движок выбран активным —
  // иначе переключатель в настройках не мог бы показать актуальный статус ДО первого переключения).
  TRANSLATION_ENGINE_GET:            'translation-engine:get',
  TRANSLATION_ENGINE_SET:            'translation-engine:set',
  TRANSLATION_ENGINE_GET_BERGAMOT_STATUS: 'translation-engine:get-bergamot-status',
  TRANSLATION_ENGINE_BERGAMOT_STATUS_CHANGED: 'translation-engine:bergamot-status-changed',

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

  // Настройки (поисковик по умолчанию + режим Hub, см. SettingsManager.ts)
  SETTINGS_GET_SEARCH_ENGINE: 'settings:get-search-engine', // renderer → main: текущий SearchEngineId
  SETTINGS_SET_SEARCH_ENGINE: 'settings:set-search-engine', // renderer → main: сменить движок поиска
  SETTINGS_GET_HUB_MODE:      'settings:get-hub-mode',      // renderer → main: текущий HubMode
  SETTINGS_SET_HUB_MODE:      'settings:set-hub-mode',      // renderer → main: сменить режим Hub (плитки/AI)
  SETTINGS_GET_MODEL_LOAD_MODE: 'settings:get-model-load-mode', // renderer → main: текущий ModelLoadMode
  SETTINGS_SET_MODEL_LOAD_MODE: 'settings:set-model-load-mode', // renderer → main: сменить режим загрузки модели
  // Ширина AI-дока (заход 3 — поповер → правый split-view-подобный док, см. AiPanelManager.ts).
  // Читается один раз при маунте chrome; живой ресайз идёт отдельным ad-hoc каналом
  // ai-panel:resize (не здесь — остальная AI-panel-механика уже сознательно вне typed-контракта).
  SETTINGS_GET_AI_PANEL_WIDTH: 'settings:get-ai-panel-width', // renderer → main: текущая ширина дока (px)

  // Заход D: ключ Gemini для AI-фактчека (см. AiKeyStore.ts) — ключ сам НИКОГДА не идёт в
  // renderer обратно, только булев статус «подключён/нет». connected-статус пушится и в чром
  // (эта секция настроек), и в AI-панель (см. preload-aipanel.ts) — оба слушателя одного и того
  // же source of truth в main, не два независимых состояния.
  AI_GET_KEY_STATUS:      'ai:get-key-status',      // renderer → main: connected: boolean
  AI_SAVE_KEY:            'ai:save-key',            // renderer → main: (key: string) → boolean (успех)
  AI_DELETE_KEY:          'ai:delete-key',          // renderer → main: удалить ключ
  AI_KEY_STATUS_CHANGED:  'ai:key-status-changed',  // main → renderer: push нового connected-статуса

  // Задел под web-grounding в AI-панели (SearXNG) — тот же контракт, что у ключа Gemini выше:
  // endpoint/токен никогда не возвращаются в renderer, только булев статус «настроено/нет»
  // (см. electron/SearxngKeyStore.ts).
  SEARXNG_GET_STATUS:      'searxng:get-status',      // renderer → main: configured: boolean
  SEARXNG_SAVE_CONFIG:     'searxng:save-config',     // renderer → main: ({endpoint, token}) → boolean (успех)
  SEARXNG_DELETE_CONFIG:   'searxng:delete-config',   // renderer → main: удалить конфиг
  SEARXNG_STATUS_CHANGED:  'searxng:status-changed',  // main → renderer: push нового configured-статуса

  // Реестр пользовательских AI-скиллов (см. Skill выше, electron/SkillsStore.ts) — CRUD-мост для
  // Settings (чром). AI-панель продолжает получать список отдельным ad-hoc каналом
  // (ai-panel:skills-list, preload-aipanel.ts) — не через этот typed-контракт, тот же source of
  // truth (skillsStore), просто два независимых слушателя одного onSkillsChanged.
  SKILLS_LIST:    'skills:list',     // renderer → main: Skill[]
  SKILLS_ADD:     'skills:add',      // renderer → main: ({label, prompt, icon?}) → boolean (id генерит main)
  SKILLS_UPDATE:  'skills:update',   // renderer → main: (id, {label?, prompt?, icon?, visible?}) → boolean
  SKILLS_REMOVE:  'skills:remove',   // renderer → main: (id) → boolean
  SKILLS_CHANGED: 'skills:changed',  // main → renderer: push актуального Skill[]

  // VPN, шаг 1 (см. electron/VpnParser.ts, VpnKeyStore.ts, VpnSubscription.ts) — подписка и
  // список серверов. Сама ссылка подписки и credential (uuid/пароль) каждого сервера НИКОГДА
  // не пересекают эту границу — только редактированный VpnServerMeta[] и общий статус.
  VPN_GET_STATUS:            'vpn:get-status',            // renderer → main: VpnStatus
  VPN_SET_SUBSCRIPTION:      'vpn:set-subscription',      // renderer → main: url → SubscriptionResult
  VPN_REFRESH_SUBSCRIPTION:  'vpn:refresh-subscription',  // renderer → main: повторный fetch по сохранённой ссылке
  VPN_DELETE_SUBSCRIPTION:   'vpn:delete-subscription',   // renderer → main: удалить подписку и список серверов
  VPN_LIST_SERVERS:          'vpn:list-servers',          // renderer → main: VpnServerMeta[] (без credential)
  VPN_STATUS_CHANGED:        'vpn:status-changed',        // main → renderer: push нового VpnStatus

  // VPN, шаг 2 (см. electron/VpnProcess.ts) — только процесс Xray + локальный SOCKS-порт.
  // session.setProxy ЕЩЁ НЕ подключён (шаг 3) — трафик вкладок пока НИКУДА не переключается,
  // "подключение" здесь означает только "процесс поднялся и порт отвечает".
  VPN_CONNECT:               'vpn:connect',                // renderer → main: serverId → { ok, error? }
  VPN_DISCONNECT:            'vpn:disconnect',             // renderer → main: остановить процесс
  VPN_GET_CONNECTION_STATE:  'vpn:get-connection-state',   // renderer → main: VpnConnectionState
  VPN_CONNECTION_STATE_CHANGED: 'vpn:connection-state-changed', // main → renderer: push VpnConnectionState

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
  PASSWORDS_AUTH_GET: 'passwords:auth-get', // renderer → main: включена ли OS-проверка перед показом пароля
  PASSWORDS_AUTH_SET: 'passwords:auth-set', // renderer → main: включить/выключить, возвращает актуальное значение

  // Favicon для адресов (список паролей и т.п.) — качается ТОЛЬКО с самого сайта, кэш в main.
  FAVICON_GET:        'favicon:get',        // renderer → main: host → data-URL иконки | null

  // Автозаполнение форм — адреса и карты (electron/AutofillManager.ts). НЕ логин/пароль (те —
  // PasswordManager). Номер карты шифруется; в renderer уходит только маска, полный — под Hello.
  AUTOFILL_ADDRESS_LIST:   'autofill:address-list',   // renderer → main: AddressProfile[]
  AUTOFILL_ADDRESS_ADD:    'autofill:address-add',    // renderer → main: AddressInput → boolean
  AUTOFILL_ADDRESS_UPDATE: 'autofill:address-update', // renderer → main: AddressUpdate → boolean
  AUTOFILL_ADDRESS_DELETE: 'autofill:address-delete', // renderer → main: id → boolean
  AUTOFILL_CARD_LIST:      'autofill:card-list',      // renderer → main: CardMeta[] (без полного номера)
  AUTOFILL_CARD_ADD:       'autofill:card-add',       // renderer → main: CardInput → boolean
  AUTOFILL_CARD_UPDATE:    'autofill:card-update',    // renderer → main: CardUpdate → boolean
  AUTOFILL_CARD_DELETE:    'autofill:card-delete',    // renderer → main: id → boolean
  AUTOFILL_CARD_REVEAL:    'autofill:card-reveal',    // renderer → main: id → полный номер | null (под Hello)
  AUTOFILL_CHANGED:        'autofill:changed',        // main → renderer: push после любой мутации

  // Менеджер паролей, шаг 2 (см. electron/preload-content.ts, electron/TabManager.ts) — канал
  // ГОСТЕВАЯ СТРАНИЦА ↔ TabManager, через per-view webContents.ipc (не общий ipcMain — main точно
  // знает, какая вкладка прислала сообщение). Content-preload НИКОГДА не шлёт origin — main сам
  // вычисляет его из wc.getURL() (доверенный источник), см. PasswordAutofillManager.ts.
  PASSWORDS_FORM_DETECTED:       'passwords:form-detected',       // гостевая страница → TabManager: { hasLoginForm, hasUsernameField }
  PASSWORDS_CREDENTIAL_SUBMITTED: 'passwords:credential-submitted', // гостевая страница → TabManager: { username, password }
  PASSWORDS_FILL:                'passwords:fill',                // TabManager → конкретная гостевая вкладка: { username?, password }, только fill, без submit. username отсутствует — не трогать поле логина (см. генератор пароля).
  // Иконка в самом поле пароля (не в тулбаре) — см. electron/preload-content.ts (closed Shadow DOM,
  // проверка event.isTrusted перед отправкой) + electron/PasswordPopoverManager.ts (тот же поповер,
  // просто заякорен на позицию поля вместо иконки в тулбаре). rect — координаты поля ОТНОСИТЕЛЬНО
  // вьюпорта страницы; TabManager транслирует их в оконные, прибавляя bounds вьюхи вкладки.
  PASSWORDS_FIELD_ICON_CLICK: 'passwords:field-icon-click', // гостевая страница → TabManager: { rect: {x,y,width,height} }

  // Автозаполнение форм — сигналы между гостевой страницей и TabManager (per-view webContents.ipc,
  // как у паролей). url НИКОГДА не из payload — main берёт wc.getURL(). Адреса/карты не привязаны к
  // origin (в отличие от паролей), url нужен лишь чтобы отсечь служебные схемы.
  AUTOFILL_FIELD_FOCUS: 'autofill:field-focus', // гостевая страница → TabManager: { rect, kind: 'address'|'card' }
  AUTOFILL_FILL_FIELDS: 'autofill:fill-fields', // TabManager → гостевая вкладка: карта значений полей для подстановки
  AUTOFILL_SUBMIT:      'autofill:submit',      // гостевая страница → TabManager: { kind, fields } при отправке формы (offer-save)

  // Менеджер паролей, шаг 2 — индикатор-«ключ» в omnibox + поповер (см. PasswordIndicatorPopover.tsx,
  // electron/PasswordAutofillManager.ts). Только про АКТИВНУЮ вкладку — переключение вкладок само
  // пересылает актуальное состояние (или null).
  PASSWORDS_INDICATOR_CHANGED: 'passwords:indicator-changed', // main → renderer: push PasswordIndicatorState | null
  PASSWORDS_INDICATOR_SAVE:    'passwords:indicator-save',    // renderer → main: подтвердить «Сохранить» → boolean
  PASSWORDS_INDICATOR_UPDATE:  'passwords:indicator-update',  // renderer → main: подтвердить «Обновить» → boolean
  PASSWORDS_INDICATOR_FILL:    'passwords:indicator-fill',    // renderer → main: явный клик «Подставить» по id → boolean
  PASSWORDS_INDICATOR_DISMISS: 'passwords:indicator-dismiss', // renderer → main: «Не сейчас» — сбросить оффер без записи
  // Иконка на пустом поле пароля без сохранённого логина (регистрация) — «Сгенерировать пароль».
  // Генерирует + сразу пишет в ТО ЖЕ поле (только пароль, логин не трогается), не в буфер обмена.
  PASSWORDS_INDICATOR_GENERATE: 'passwords:indicator-generate', // renderer → main: сгенерировать и заполнить активное поле → boolean

  // Нативная WebContentsView-вью поповера паролей (как FindBar/SuggestDropdown): chrome только
  // сообщает anchor-bounds и состояние, сама карточка рисуется поверх страницы отдельным слоем.
  PASSWORD_POPOVER_SET_BOUNDS: 'password-popover:set-bounds',
  PASSWORD_POPOVER_SHOW:       'password-popover:show',
  PASSWORD_POPOVER_CLOSE:      'password-popover:close',
  PASSWORD_POPOVER_CLOSED:     'password-popover:closed',

  // Поповер VPN-пилюли — тот же приём, что PASSWORD_POPOVER_* (см. electron/VpnPopoverManager.ts).
  // Отличие: SHOW не несёт payload — сам поповер запрашивает список серверов/статус подключения
  // через свой preload (см. preload-vpnpopover.ts), main здесь ничего не решает.
  VPN_POPOVER_SET_BOUNDS: 'vpn-popover:set-bounds',
  VPN_POPOVER_SHOW:       'vpn-popover:show',
  VPN_POPOVER_CLOSE:      'vpn-popover:close',
  VPN_POPOVER_CLOSED:     'vpn-popover:closed',
  // Заход «Защита» (шаг 3) — домен активной вкладки для адблок-секции поповера. Toolbar шлёт его
  // и при открытии, и при навигации в ТОЙ ЖЕ вкладке, пока поповер открыт (смена вкладки поповер
  // и так закрывает, см. Toolbar.tsx::useEffect по tab?.id). main форвардит в саму вью поповера
  // отдельным push'ем 'vpn-popover:active-url' (см. VpnPopoverManager.ts) — этот канал в IPC-словаре
  // только на renderer→main половину пути, ответной пары ADBLOCK_STATE_CHANGED-стиля у него нет.
  VPN_POPOVER_SET_ACTIVE_URL: 'vpn-popover:set-active-url',

  // Заход 10: живые suggest-подсказки текущего поисковика (см. SearchSuggestFetcher.ts) —
  // fetch ТОЛЬКО из main (CORS, см. комментарий в SearchSuggestFetcher.ts). Движок берётся main'ом
  // самостоятельно через SettingsManager.getSearchEngine() — тот же источник истины, что капсула.
  SEARCH_SUGGEST: 'search:suggest',

  // Старт: renderer → main, «React-оболочка отрисована». Окно создаётся show:false
  // (против белого экрана) и показывается по этому сигналу (см. main.ts::createWindow).
  CHROME_UI_READY: 'chrome:ui-ready',

  // Индикатор качества индекса умного поиска (см. Settings.tsx::HistoryBackfillSection) — сколько
  // страниц истории реально имеют извлечённый текст (chunks), а не только заголовок+домен.
  HISTORY_CONTENT_COVERAGE: 'history:content-coverage', // renderer → main: снимок охвата на момент запроса

  // Рискованный бэкфилл полного текста (см. electron/HistoryContentBackfill.ts) — тихое
  // переоткрытие старых URL. Только по явному действию в отдельной, явно промаркированной секции Settings.tsx.
  HISTORY_CONTENT_BACKFILL_START:    'history:content-backfill-start',
  HISTORY_CONTENT_BACKFILL_CANCEL:   'history:content-backfill-cancel',
  HISTORY_CONTENT_BACKFILL_STATUS:   'history:content-backfill-status',
  HISTORY_CONTENT_BACKFILL_PROGRESS: 'history:content-backfill-progress',

  // AI-чат на Hub (см. electron/HubChatManager.ts) — живёт в основном chrome-рендерере, честный
  // канал в этом контракте (в отличие от боковой AI-панели, у которой свой изолированный ad-hoc
  // IPC, см. preload-aipanel.ts) — Hub не оверлей, а обычный контент вкладки. Только локальная
  // модель (Qwen, тот же runChatMessage, что у AI-панели/quick-translate) — Gemini как вторая
  // модель это отдельный следующий заход, здесь его нет.
  HUB_CHAT_SEND:          'hub-chat:send',           // renderer → main: { tabId, text } (fire-and-forget, ответ идёт через chunk/result)
  HUB_CHAT_CHUNK:         'hub-chat:chunk',          // main → renderer: { tabId, text } — очередной чанк стрима
  HUB_CHAT_RESULT:        'hub-chat:result',         // main → renderer: { tabId, sessionId, outcome: HubChatOutcome }
  HUB_CHAT_LIST_SESSIONS: 'hub-chat:list-sessions',  // renderer → main: HubChatSessionMeta[]
  HUB_CHAT_GET_SESSION:   'hub-chat:get-session',    // renderer → main: sessionId → HubChatMessage[]
  HUB_CHAT_NEW_SESSION:   'hub-chat:new-session',    // renderer → main: tabId — сбросить текущий диалог вкладки
  HUB_CHAT_RESUME_SESSION: 'hub-chat:resume-session', // renderer → main: { tabId, sessionId } → HubChatMessage[] — продолжить старый диалог
  HUB_CHAT_DELETE_SESSION: 'hub-chat:delete-session', // renderer → main: sessionId

  // Детект железа (см. electron/HardwareInfo.ts) — задел под подбор GGUF-модели по VRAM. Read-only,
  // ленивый (без вызова на старте): первый запрос считает и кэширует, дальше отдаёт из кэша.
  HARDWARE_GET_SNAPSHOT: 'hardware:get-snapshot', // renderer → main: HardwareSnapshot (из кэша)

  // Принудительный пересчёт (HardwareInfo.ts::refresh) — в отличие от HARDWARE_GET_SNAPSHOT, не
  // отдаёт кэш. Нужен там, где vramFree/ramFree заведомо изменились (после unloadModel()) —
  // строка состояния памяти в ModelsSection.tsx иначе покажет цифру, актуальную на старте процесса.
  HARDWARE_REFRESH_SNAPSHOT: 'hardware:refresh-snapshot', // renderer → main: HardwareSnapshot (свежий пересчёт)

  // Загрузчик GGUF-моделей (см. electron/ModelDownloader.ts) — задел, потребителей в UI пока нет.
  // Тот же контракт, что HISTORY_CONTENT_BACKFILL_* (start/cancel fire-and-forget, status — invoke
  // для гонки старта монтирования, progress — push).
  MODEL_DOWNLOAD_START:    'model-download:start',    // renderer → main: ModelDownloadSpec
  MODEL_DOWNLOAD_CANCEL:   'model-download:cancel',   // renderer → main: (без параметров)
  MODEL_DOWNLOAD_STATUS:   'model-download:status',   // renderer → main: DownloadProgress
  MODEL_DOWNLOAD_PROGRESS: 'model-download:progress', // main → renderer: push DownloadProgress

  // Курируемый каталог моделей (см. electron/ModelCatalog.ts) — задел, потребителей в UI пока
  // нет. Read-only: считает HardwareSnapshot внутри и сразу отдаёт каталог с посчитанным fit.
  MODEL_CATALOG_GET: 'model-catalog:get', // renderer → main: CatalogEntry[]

  // Явная выгрузка текущей модели из VRAM (см. electron/TranslationService.ts::unloadModel) —
  // задел, потребителей в UI пока нет. invoke, не send: вызывающая сторона должна знать МОМЕНТ
  // фактического освобождения памяти (dispose дожидается текущей генерации), а не просто отправить
  // команду и гадать, когда она применится.
  MODEL_UNLOAD: 'model:unload', // renderer → main: (без параметров) -> void, после факта выгрузки

  // Удаление модели с диска (см. electron/ModelRegistry.ts::deleteModel) — задел, потребителей
  // в UI пока нет. Необратимая операция — invoke, вызывающая сторона обязана дождаться и увидеть
  // ok:false с причиной отказа (NOT_FOUND/LEGACY_NOT_DELETABLE/LAST_MODEL/FS_ERROR:...), а не
  // fire-and-forget.
  MODEL_DELETE: 'model:delete', // renderer → main: id: string -> DeleteModelResult

  // Проброс ModelRegistry.ts/TranslationService.ts наружу для UI управления моделями — read-only
  // (список установленных, дефолт) плюс смена дефолта. Дефолтная модель ≠ загруженная модель:
  // MODEL_LOADED_GET отдельно, т.к. смена дефолта не выгружает уже загруженную (см. MODEL_DEFAULT_SET).
  MODEL_INSTALLED_LIST: 'model:installed-list', // renderer → main: InstalledModel[]
  MODEL_DEFAULT_GET:    'model:default-get',    // renderer → main: string | null
  MODEL_DEFAULT_SET:    'model:default-set',    // renderer → main: id: string -> SetDefaultModelResult
  MODEL_LOADED_GET:     'model:loaded-get',     // renderer → main: string | null (id загруженной в VRAM модели)
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

// ── Закладки ─────────────────────────────────────────────────────────────────
// parentId/position уже присутствуют, хотя Feature 1 UI работает только с корнем
// (parentId всегда null) — задел на будущие папки/сортировку без миграции формата,
// когда появится реальный UI под них.
export interface BookmarkEntry {
  id: number;
  url: string;
  title: string;
  parentId: number | null;
  position: number;
  createdAt: number;  // Unix ms
}

// Вход для BookmarkManager.bulkInsert — шов под будущий импорт из других браузеров
// (Chromium сначала, см. дорожную карту). Ничего в Feature 1 этот тип не использует.
export interface BulkBookmarkInput {
  parentId: number | null;
  url: string;
  title: string;
  position: number;
  createdAt?: number;
}

// Источник импорта закладок — реально найденный на диске браузер (см. electron/bookmarkImport/).
export interface BookmarkImportSource {
  id: string;     // 'chrome' | 'edge' | 'brave' | 'yandex' — стабильный id для BOOKMARK_IMPORT_RUN
  label: string;  // человекочитаемое имя для UI
}

export interface BookmarkImportResult {
  inserted: number;
  skipped: number;
}

// ── Общий импорт данных из браузеров (electron/browserImport/) ──────────────────
// Типы данных, которые умеем переносить из другого браузера. Автозаполнение (адреса/карты)
// сознательно НЕ входит — в браузере пока нет подсистемы автозаполнения форм, хранить нечего
// (дорожная карта п.3). Firefox/Safari добавятся тем же контрактом позже.
export type ImportDataType = 'bookmarks' | 'history' | 'passwords';

// Источник импорта = конкретный ПРОФИЛЬ конкретного браузера, реально найденный на диске.
// id — составной (вендор + каталог профиля), непрозрачен для renderer, только для IMPORT_RUN.
export interface ImportSource {
  id: string;               // напр. 'chrome::Default' — стабильный ключ для IMPORT_RUN
  label: string;            // 'Google Chrome' или 'Google Chrome — Профиль 1' (если профилей несколько)
  dataTypes: ImportDataType[]; // типы, которые для ЭТОГО источника И доступны на диске, И уже поддержаны
}

// Результат по одному типу. unsupported — записи, которые физически нельзя перенести (напр. пароли
// с App-Bound-шифрованием Chrome 127+, требующим SYSTEM-прав) — отдельно от skipped (дубли/уже были).
export interface ImportTypeResult {
  inserted: number;
  skipped: number;
  unsupported?: number;
}

// Ключи — из ImportDataType; присутствуют только реально запрошенные типы. null-значение типа —
// импортёр этого типа упал целиком (в отличие от {inserted:0} — отработал, но нечего было переносить).
export type ImportRunResult = Partial<Record<ImportDataType, ImportTypeResult | null>>;

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
  snippet?: string;
}

// Ответ умного поиска (searchHistorySmart) — degraded:true означает, что Qwen-реранк не
// отработал (упал/недоступна модель) и results — это cosine top-k без участия LLM, не то,
// что пользователь запросил кнопкой «умный поиск». false — реранк реально отработал (даже
// если вернул пустой список: это ЕГО осознанный ответ «ничего релевантного», не деградация).
export interface SmartSearchResponse {
  results: SemanticSearchResult[];
  degraded: boolean;
}

// Заход G, блок 5 — прогресс разового бэкфилла истории.
export interface BackfillProgress {
  processed: number;
  total: number;
  running: boolean;
  cancelled: boolean;
}

// Индикатор качества индекса умного поиска (см. HistoryManager.ts::countHistoryWithContent) —
// withContent считает страницы с реально извлечённым текстом, не только заголовок+домен
// (который получает КАЖДАЯ проиндексированная строка, включая шумные/непроверенные).
export interface HistoryContentCoverage {
  withContent: number;
  total: number;
}

// ── Загрузки ─────────────────────────────────────────────────────────────────

// ── VPN, шаг 1 (подписка + список серверов, см. electron/VpnSubscription.ts) ──
// Редактированная версия VpnServer (electron/VpnParser.ts) для renderer — без credential
// (uuid/пароль). Показывать/копировать эти значения пользователю в UI незачем (не пароль
// сайта, который иногда нужно скопировать в другое место) — поэтому не «спрятано до reveal»,
// как у PasswordMeta, а не отдаётся вообще никогда.
export interface VpnServerMeta {
  id: string;
  protocol: 'vless' | 'trojan';
  remark: string;
  address: string;
  port: number;
  security: 'none' | 'tls' | 'reality';
  transport: 'tcp' | 'ws' | 'grpc' | 'xhttp';
}

export interface VpnStatus {
  hasSubscription: boolean;
  serverCount: number;
  fetchedAt: number | null;
}

export interface VpnSubscriptionResult {
  ok: boolean;
  error?: string;
  count?: number;
  skipped?: number;
}

// VPN, шаг 2 — состояние процесса Xray. serverId/remark — какой сервер сейчас активен (или
// последняя попытка) для подсветки в списке. error — только человекочитаемое сообщение,
// НЕ сырой лог Xray (тот может содержать SNI/адреса — см. VpnProcess.ts::getRecentLogs,
// отдельный канал не заведён в шаге 2, лог наружу пока вообще не уходит).
export interface VpnConnectionState {
  state: 'stopped' | 'starting' | 'running' | 'error';
  serverId: string | null;
  serverRemark: string | null;
  error?: string;
}

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

// Менеджер паролей, шаг 2 — состояние индикатора-«ключа» в omnibox для АКТИВНОЙ вкладки.
// Пароль НИКОГДА не входит в этот тип — только origin/username/id, само значение секрета
// остаётся в main до explicit save/update/fill (см. electron/PasswordAutofillManager.ts).
export interface PasswordIndicatorMatch {
  id: number;
  username: string;
}
export type PasswordIndicatorState =
  | { kind: 'has-saved'; origin: string; matches: PasswordIndicatorMatch[] }
  | { kind: 'offer-save'; origin: string; username: string }
  | { kind: 'offer-update'; origin: string; username: string; matchId: number }
  // Клик по иконке в пустом поле пароля БЕЗ сохранённого логина для origin (похоже на форму
  // регистрации) — предложить сгенерировать пароль. Ничего не расшифровываем/не подставляем,
  // пока пользователь сам не нажмёт «Сгенерировать» в поповере.
  | { kind: 'offer-generate'; origin: string };

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
  // Подпись секции (по образцу Safari — «Предложения Google» / «Закладки и история») — ставится
  // ТОЛЬКО на первый элемент новой секции (Toolbar.tsx::buildSuggestions). Вью дропдауна ничего
  // не решает сама, просто рисует подпись, если она есть — источник группировки остаётся в
  // Toolbar.tsx, не размазывается по двум местам.
  sectionHeader?: string;
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

// ── Полностраничный перевод (см. electron/PageTranslateManager.ts) ───────────
// 'idle' — не переведена (или отключена: hub/history/settings, см. Toolbar.tsx). 'translating' —
// идёт батчевый прогон через Qwen. 'translated' — все батчи применены, повторный клик кнопки
// откатывает на оригинал (см. PAGE_TRANSLATE_TOGGLE) обратно в 'idle'.
export type PageTranslateState = 'idle' | 'translating' | 'translated';

// Прогресс во время 'translating' — batchIndex/batchCount (батч из скольких известен сразу после
// обхода DOM, см. PageTranslateManager.ts::runTranslation) и charsStreamed — суммарные символы,
// сгенерированные моделью с начала перевода СТРАНИЦЫ (растёт непрерывно по мере токен-стриминга
// внутри каждого батча, не только на границах батчей) — единственная задача этого поля: дать
// тулбару "живой" сигнал вместо голого спиннера на все 7-10+ секунд одного батча. null — сейчас
// не 'translating' (см. pushProgress в PageTranslateManager.ts — гасится вместе с состоянием).
export interface PageTranslateProgress {
  batchIndex: number;
  batchCount: number;
  charsStreamed: number;
}

// Движки полностраничного перевода (см. electron/ITranslationEngine.ts::ITranslationEngine) — общий
// тип, нужен и main (electron/TranslationEngineRegistry.ts, electron/SettingsManager.ts), и renderer
// (Settings.tsx), поэтому живёт здесь, а не в electron/-only файле.
export type TranslationEngineId = 'qwen' | 'bergamot';

// Статус Bergamot-движка (см. electron/BergamotService.ts) — только push, не завязан на то, какой
// движок сейчас АКТИВЕН в настройках: греется в фоне независимо (см. main.ts), чтобы переключатель
// в Settings.tsx мог показать актуальный статус ДО того, как пользователь вообще попробует его
// выбрать. 'unavailable' — воркер не поднялся или файлов моделей нет (см. живой лог main-процесса),
// UI показывает «модель перевода не загружена», TranslationEngineRegistry тихо остаётся на Qwen.
export type BergamotStatus = 'loading' | 'ready' | 'unavailable';

// ── AI-чат на Hub ───────────────────────────────────────────────────────────
export type HubMode = 'tiles' | 'ai';

// Режим загрузки GGUF-модели (SettingsManager.ts): 'startup' — прогрев сразу после показа окна
// (см. main.ts, warmupTranslation), модель занимает ~6 ГБ RAM постоянно, но первый AI-ответ
// быстрый. 'on-demand' (дефолт) — прогрев откладывается до явного намерения пользователя
// поработать с AI (открытие AI-панели/хаба в режиме AI, см. main.ts), экономит память, но первый
// ответ ждёт полную загрузку модели (~30с). Не путать с Bergamot — тот всегда греется безусловно
// (свой лёгкий движок, к GGUF отношения не имеет).
export type ModelLoadMode = 'startup' | 'on-demand';

export interface HubChatMessage {
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

export interface HubChatSessionMeta {
  id: number;
  title: string;      // начало первого сообщения пользователя
  updatedAt: number;
}

export type HubChatOutcome =
  | { ok: true; out: string }
  | { ok: false; error: string };

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

// Дискриминируемый код причины отказа генерации, когда она известна (реестр GGUF-моделей,
// см. electron/ModelRegistry.ts) — рядом с человекочитаемым error, а не вместо него. Опционально:
// прочие ошибки (не про модель — франк, парсинг и т.п.) errorCode не выставляют, как и раньше.
export type ModelErrorCode = 'NO_MODEL_INSTALLED' | 'MODEL_FILE_MISSING' | 'LOAD_FAILED';

// Снапшот железа (см. electron/HardwareInfo.ts) — задел под подбор GGUF-модели по доступной VRAM.
// vram*/gpuBackend — null, если детект упал (нет подходящего GPU/драйвера) или ещё не запускался;
// ram*/cpuCores — всегда заполнены (через os, от llama/GPU не зависят). error — причина отказа
// детекта VRAM/GPU, если она есть; null означает "vram*/gpuBackend успешно определены".
export interface HardwareSnapshot {
  vramTotalBytes: number | null;
  vramFreeBytes: number | null;
  gpuBackend: string | null;
  ramTotalBytes: number;
  ramFreeBytes: number;
  cpuCores: number;
  detectedAt: number;
  error: string | null;
}

// Загрузчик GGUF-моделей (см. electron/ModelDownloader.ts) — задел, потребителей в UI пока нет.
// Одновременно допускается только одна загрузка на процесс. modelId — slug (та же slugify(), что
// у ModelRegistry.ts) целевого файла, известен с самого начала (до появления файла на диске).
export interface DownloadProgress {
  modelId: string | null;
  receivedBytes: number;
  totalBytes: number | null;
  running: boolean;
  cancelled: boolean;
  error: string | null;
}

// Параметры одной загрузки — курируемый каталог моделей будет отдельным заходом (6c), сейчас
// приходят снаружи как есть.
export interface ModelDownloadSpec {
  url: string;
  fileName: string;
  label: string;
  // Эталонный SHA256 (см. electron/ModelDownloader.ts) — сверяется потоково во время скачивания,
  // без отдельного прохода по файлу после. null — модель без снятого хэша (см. CatalogModel),
  // тогда проверка пропускается с предупреждением в лог, а не блокирует загрузку.
  expectedSha256?: string | null;
}

// Курируемый каталог моделей (см. electron/ModelCatalog.ts::CatalogModel/ModelFit) — структурно
// идентичная копия здесь, а не импорт: shared/ipc.ts бандлится и в renderer (Vite), а
// ModelCatalog.ts тянет ModelRegistry.ts → 'electron' (app.getPath), которые в renderer-бандл
// тащить нельзя. Тот же приём, что Skill/SkillsStore.ts ниже.
export interface CatalogModel {
  id: string;
  fileName: string;
  label: string;
  quant: string;
  url: string;
  sizeBytes: number;
  totalLayers: number;
  vramFullOffloadBytes: number;
  contextVramPerToken: number;
  contextVramBaseBytes: number;
  // Разреженная нумерация (шаг 10: 10/20/30/40/50/...) — НАМЕРЕННО, не 1/2/3/4/5: вставка новой
  // ступени между существующими (напр. Gemma 4 12B между 9B и 27B) получает своё число из
  // промежутка (45) и не требует перенумеровывать соседей. number, а не union конкретных значений —
  // union пришлось бы расширять на каждую новую ступень (см. историю этого поля).
  qualityTier: number;
  // lfs.oid с HF API (tree/main) — сверяется потоково при скачивании (см. ModelDownloader.ts).
  // null допустим (модель без снятого хэша) — тогда проверка при загрузке пропускается,
  // не блокирует её.
  expectedSha256: string | null;
}

export type FitCategory = 'light' | 'recommended' | 'heavy' | 'not-recommended';

export interface ModelFit {
  fitQuality: FitCategory;
  // maxContextTokens калибрована ТОЛЬКО для случая, когда модель целиком помещается в GPU —
  // если fitsFullyOnGpu===false, число недостоверно (формула не учитывает частичный оффлоад на
  // CPU). contextEstimateReliable дублирует fitsFullyOnGpu как явный сигнал для UI: не показывать
  // число контекста, когда false, а не полагаться на то, что потребитель сам вспомнит про эту связь.
  maxContextTokens: number;
  fitsFullyOnGpu: boolean;
  contextEstimateReliable: boolean;
  note: string | null;
}

// Роль модели ОТНОСИТЕЛЬНО ВСЕГО КАТАЛОГА на данном железе (см. electron/ModelCatalog.ts::assignRoles)
// — в отличие от ModelFit.fitQuality (объективная характеристика ОДНОЙ модели самой по себе).
export type ModelRole = 'light' | 'recommended' | 'heavy';

export interface CatalogEntry {
  model: CatalogModel;
  fit: ModelFit;
  role: ModelRole | null; // null = вне окна рекомендаций — модель остаётся в массиве, но скрыта по умолчанию
  visibleByDefault: boolean;
}

// Результат удаления модели (см. electron/ModelRegistry.ts::deleteModel) — структурно идентичная
// копия здесь, а не импорт: та же причина, что у CatalogModel/ModelFit выше — ModelRegistry.ts
// тянет 'electron' (app.getPath), чего в renderer-бандл тащить нельзя. reason — свободная строка
// (не union литералов): NOT_FOUND/LEGACY_NOT_DELETABLE/LAST_MODEL — фиксированные, но FS_ERROR
// включает динамический текст исключения ФС.
export type DeleteModelResult = { ok: true } | { ok: false; reason: string };

// Установленная на диске модель (см. electron/ModelRegistry.ts::InstalledModel) — структурно
// идентичная копия здесь, а не импорт: та же причина, что у CatalogModel/DeleteModelResult выше —
// ModelRegistry.ts тянет 'electron' (app.getPath), чего в renderer-бандл тащить нельзя. filePath
// отдаётся как есть, включая легаси-записи вне userData — UI сам решает, что показать пользователю.
export interface InstalledModel {
  id: string;
  label: string;
  filePath: string;
  sizeBytes: number;
  source: 'legacy' | 'downloaded';
}

// Результат смены дефолтной модели (см. electron/ModelRegistry.ts::setDefault). Валидация id
// (NOT_FOUND) сделана на уровне IPC-обработчика в main.ts — само ModelRegistry.setDefault() при
// неизвестном id молча ничего не делает (void), а не сообщает об ошибке. Важно: успешная смена
// дефолта НЕ выгружает уже загруженную модель из VRAM — та остаётся прежней до явного unloadModel(),
// UI обязан отражать дефолт и загруженную модель как два независимых состояния.
export type SetDefaultModelResult = { ok: true } | { ok: false; reason: string };

export type AiActionOutcome =
  | { ok: true; out: string; action: AiAction; dirUsed?: TranslateDirection; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string; errorCode?: ModelErrorCode };

// ── Реестр пользовательских AI-скиллов (prompt-кнопок AI-панели) ─────────────────────────────
// Источник истины — electron/SkillsStore.ts::Skill (не трогаем, стор готов) — структурно
// идентичная копия здесь, а не импорт: shared/ipc.ts бандлится и в renderer (Vite), а
// SkillsStore.ts тянет 'electron'/node fs/path, которые в renderer-бандл тащить нельзя.
// ⚠️ Держать поля в синхроне с electron/SkillsStore.ts::Skill вручную при любой правке одного из них.
export interface Skill {
  id: string;
  label: string;
  prompt: string;
  icon?: string;
  builtin?: boolean;
  // Видимость кнопки в AI-панели — независима от builtin, тумблер в Settings может спрятать
  // даже встроенный скилл, не удаляя его (см. SkillsStore.ts::remove — builtin по-прежнему
  // неудаляем). Не optional — старые skills.json без этого поля мигрируются в SkillsStore.ts.
  visible: boolean;
}

// ── Автозаполнение форм (electron/AutofillManager.ts) ──────────────────────────
// Адрес — все поля PII, шифруются одним блобом at rest (наружу отдаём в полном виде: renderer —
// доверенный chrome-UI). Набор полей — прагматичный, покрывает типовые формы доставки/контактов.
export interface AddressProfile {
  id: number;
  fullName: string;
  organization: string;
  email: string;
  phone: string;
  street: string;      // улица + дом, одной строкой
  city: string;
  region: string;      // область/штат/край
  postalCode: string;
  country: string;
  createdAt: number;
  updatedAt: number;
}
export type AddressInput = Omit<AddressProfile, 'id' | 'createdAt' | 'updatedAt'>;
export interface AddressUpdate extends AddressInput { id: number; }

// Карта: CVC НЕ хранится (PCI, как во всех браузерах). Полный номер шифруется и наружу массово не
// уходит — только маска last4 + бренд; полный номер — через revealCardNumber (под Windows Hello).
export interface CardMeta {
  id: number;
  cardholder: string;
  brand: string;       // 'Visa' | 'Mastercard' | 'Amex' | 'Mir' | … | '' — вычисляется по номеру
  last4: string;
  expMonth: number;    // 1..12
  expYear: number;     // полный год, напр. 2029
  createdAt: number;
  updatedAt: number;
}
export interface CardInput {
  cardholder: string;
  number: string;      // полный номер (цифры/пробелы) — только на вход, наружу не возвращается
  expMonth: number;
  expYear: number;
}
export interface CardUpdate {
  id: number;
  cardholder?: string;
  number?: string;     // undefined — номер не менять
  expMonth?: number;
  expYear?: number;
}

// Категории полей формы для автозаполнения — общий словарь между детектором (preload-content) и
// значениями, которые main шлёт на подстановку. Адресные + карточные (карты — заход 3).
export type AutofillFieldKey =
  | 'fullName' | 'givenName' | 'familyName' | 'email' | 'phone'
  | 'street' | 'addressLine2' | 'city' | 'region' | 'postalCode' | 'country' | 'organization'
  | 'ccName' | 'ccNumber' | 'ccExpMonth' | 'ccExpYear' | 'ccExp';

// Плоская карта «категория поля → значение» для подстановки (AUTOFILL_FILL_FIELDS). preload-content
// заполняет те поля, для которых нашёл категорию на странице; лишние ключи игнорируются.
export type AutofillFillFields = Partial<Record<AutofillFieldKey, string>>;

// Тип API, который preload пробрасывает в window.oblako
export interface OblakoApi {
  // Атомарный начальный запрос + подписка (заменяют getAllTabs+getSidebarNodes+onTabsChanged+onSidebarNodesChanged).
  getSyncState(): Promise<SyncState>;
  onSyncChanged(cb: (state: SyncState) => void): () => void;

  getAllTabs(): Promise<TabState[]>;
  createTab(url?: string): Promise<string>;       // вернёт id новой вкладки
  createIncognitoTab(url?: string): Promise<string>; // приватная вкладка (in-memory сессия, без истории)
  // Псевдо-вкладка (История/Настройки) — та же жизнь (закрытие/активация), что у обычной,
  // просто без WebContentsView. См. shared/ipc.ts::TabState.kind, TabManager.createSpecialTab.
  // section — необязательный начальный раздел Settings (см. TabState.section выше), для
  // history/bookmarks игнорируется.
  createSpecialTab(kind: 'history' | 'settings' | 'bookmarks', section?: string): Promise<string>;
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
  exitSplit(tabId: string): Promise<void>;           // схлопнуть пару, содержащую tabId; обе вкладки остаются
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
  // Умный поиск — Qwen-реранк top-k кандидатов, только по явному Enter (см. HistorySearch.ts).
  // degraded:true в ответе — реранк не отработал, results это лексика+FTS top-k без LLM (см. SmartSearchResponse).
  searchHistorySmart(query: string): Promise<SmartSearchResponse>;

  // Закладки — плоский список (parentId всегда null в Feature 1)
  addBookmark(url: string, title: string): Promise<BookmarkEntry | null>;
  removeBookmark(id: number): Promise<void>;
  removeBookmarkByUrl(url: string): Promise<void>;
  listBookmarks(): Promise<BookmarkEntry[]>;
  isBookmarked(url: string): Promise<boolean>;
  onBookmarksChanged(cb: () => void): () => void;
  // Импорт из других браузеров (см. electron/bookmarkImport/) — пока только Chromium-семейство.
  listBookmarkImportSources(): Promise<BookmarkImportSource[]>;
  runBookmarkImport(sourceId: string): Promise<BookmarkImportResult | null>;

  // Общий мультитиповый импорт (закладки/история/пароли) — диалог импорта + онбординг первого
  // запуска (см. electron/browserImport/). Отдельно от bookmark-only каналов выше.
  listImportSources(): Promise<ImportSource[]>;
  runImport(sourceId: string, dataTypes: ImportDataType[]): Promise<ImportRunResult>;
  // Онбординг: показывать ли предложение импорта на этом старте (первый запуск + есть источники).
  shouldOfferImport(): Promise<boolean>;
  markImportOffered(): Promise<void>;

  // Индикатор качества индекса умного поиска — сколько страниц реально имеют извлечённый текст.
  getHistoryContentCoverage(): Promise<HistoryContentCoverage>;

  // Рискованный бэкфилл полного текста (electron/HistoryContentBackfill.ts) — тихое переоткрытие
  // старых URL. Тот же прогресс-контракт (BackfillProgress), но
  // отдельные каналы/методы — это независимый, гораздо более тяжёлый и рискованный процесс.
  startHistoryContentBackfill(): void;
  cancelHistoryContentBackfill(): void;
  getHistoryContentBackfillStatus(): Promise<BackfillProgress>;
  onHistoryContentBackfillProgress(cb: (p: BackfillProgress) => void): () => void;

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
  // TabOrganizer.ts::suggestGroups() — Qwen-группировка открытых вкладок (заменяет
  // ClusteringService.ts как источник предложений, тот же формат применения через
  // organizeApply выше). Request/response, не fire-and-forget — как searchHistorySmart.
  suggestGroups(): Promise<OrganizeProposal>;

  // Правая AI-панель (заход 3 — правый split-view-подобный док, см. AiPanelManager.ts)
  toggleAiPanel(): Promise<boolean>;
  getAiPanelWidth(): Promise<number>;
  resizeAiPanel(widthPx: number): void; // ad-hoc, fire-and-forget — тот же принцип, что остальная ai-panel:* механика
  // Источник истины для aiPanelOpen в App.tsx — единственный на ЛЮБОЕ закрытие/открытие
  // (крестик/Escape внутри панели, тоггл в тулбаре, будущие пути) — не полагаться на
  // возвращаемое значение toggleAiPanel() как на единственный сигнал.
  onAiPanelStateChanged(cb: (open: boolean) => void): () => void;

  // Полностраничный перевод (см. electron/PageTranslateManager.ts) — тоггл для активной вкладки,
  // fire-and-forget: актуальное состояние приходит через onPageTranslateStateChanged (main сам
  // решает idle/translating/translated, renderer ничего не считает сам). getPageTranslateState —
  // явный запрос на монтирование (та же пара get+onChanged, что getAdBlockState/onAdBlockStateChanged) —
  // push мог уйти ДО того, как renderer подписался (гонка старта окна).
  togglePageTranslate(): void;
  getPageTranslateState(): Promise<PageTranslateState>;
  onPageTranslateStateChanged(cb: (state: PageTranslateState) => void): () => void;
  // Прогресс во время 'translating' — только push, без get: коротко живёт (секунды), гонка старта
  // окна ей не грозит (пока подписка не пришла, идёт максимум idle→translating, кнопка и так уже
  // рисует спиннер по state). См. PageTranslateProgress.
  onPageTranslateProgressChanged(cb: (progress: PageTranslateProgress | null) => void): () => void;

  // Выбор движка перевода страниц (Settings.tsx, секция AI) — get+set как у searchEngine/hubMode
  // (SettingsManager.ts персистит значение). getBergamotStatus+onBergamotStatusChanged — та же
  // пара, что getPageTranslateState/onPageTranslateStateChanged: Bergamot греется в фоне на старте
  // main.ts независимо от того, что сейчас выбрано, и warmup мог УЖЕ завершиться до того, как
  // Settings.tsx смонтируется и подпишется — без явного get секция настроек молча зависла бы на
  // "Загрузка…" (гонка старта).
  getTranslationEngine(): Promise<TranslationEngineId>;
  setTranslationEngine(id: TranslationEngineId): Promise<void>;
  getBergamotStatus(): Promise<BergamotStatus>;
  onBergamotStatusChanged(cb: (status: BergamotStatus) => void): () => void;

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
  getHubMode(): Promise<HubMode>;
  setHubMode(mode: HubMode): Promise<void>;
  getModelLoadMode(): Promise<ModelLoadMode>;
  setModelLoadMode(mode: ModelLoadMode): Promise<void>;

  // AI-чат на Hub (см. electron/HubChatManager.ts) — только локальная модель в этом заходе.
  // send — fire-and-forget, ответ идёт стримом через onHubChatChunk/onHubChatResult.
  // grounding — тоггл-глобус в хабе (свой, не общий с AI-панелью, см. Hub.tsx::AiChatView).
  sendHubChatMessage(tabId: string, text: string, grounding: boolean): void;
  onHubChatChunk(cb: (payload: { tabId: string; text: string }) => void): () => void;
  onHubChatResult(cb: (payload: { tabId: string; sessionId: number; outcome: HubChatOutcome }) => void): () => void;
  listHubChatSessions(): Promise<HubChatSessionMeta[]>;
  getHubChatSession(sessionId: number): Promise<HubChatMessage[]>;
  newHubChatSession(tabId: string): Promise<void>;
  resumeHubChatSession(tabId: string, sessionId: number): Promise<HubChatMessage[]>;
  deleteHubChatSession(sessionId: number): Promise<void>;

  // Заход D — ключ Gemini (AI-фактчек). Сам ключ никогда не приходит в renderer — только статус.
  getAiKeyStatus(): Promise<boolean>;
  saveAiKey(key: string): Promise<boolean>;
  deleteAiKey(): Promise<void>;
  onAiKeyStatusChanged(cb: (connected: boolean) => void): () => void;

  // Задел под web-grounding (SearXNG) — тот же контракт: endpoint/токен никогда не приходят
  // в renderer, только статус «настроено/нет» (см. electron/SearxngKeyStore.ts).
  getSearxngStatus(): Promise<boolean>;
  saveSearxngConfig(config: { endpoint: string; token: string }): Promise<boolean>;
  deleteSearxngConfig(): Promise<void>;
  onSearxngStatusChanged(cb: (configured: boolean) => void): () => void;

  // Реестр пользовательских AI-скиллов (см. Skill выше, electron/SkillsStore.ts) — CRUD для
  // редактора в Settings. id генерит main (crypto.randomUUID()) — renderer его не шлёт, см.
  // SKILLS_ADD. visible в patch — тумблер видимости на панели (доступен и для builtin).
  listSkills(): Promise<Skill[]>;
  addSkill(input: { label: string; prompt: string; icon?: string }): Promise<boolean>;
  updateSkill(id: string, patch: { label?: string; prompt?: string; icon?: string; visible?: boolean }): Promise<boolean>;
  removeSkill(id: string): Promise<boolean>;
  onSkillsChanged(cb: (skills: Skill[]) => void): () => void;

  // VPN, шаг 1 — подписка + список серверов (см. electron/VpnSubscription.ts). Ссылка подписки
  // и credential серверов никогда не приходят в renderer — см. VpnServerMeta/VpnStatus выше.
  getVpnStatus(): Promise<VpnStatus>;
  setVpnSubscription(url: string): Promise<VpnSubscriptionResult>;
  refreshVpnSubscription(): Promise<VpnSubscriptionResult>;
  deleteVpnSubscription(): Promise<void>;
  listVpnServers(): Promise<VpnServerMeta[]>;
  onVpnStatusChanged(cb: (status: VpnStatus) => void): () => void;

  // VPN, шаг 2 — только процесс + локальный SOCKS-порт, session.setProxy ещё не подключён
  // (см. electron/VpnProcess.ts). "connect" пока не переключает трафик вкладок.
  vpnConnect(serverId: string): Promise<{ ok: boolean; error?: string }>;
  vpnDisconnect(): Promise<void>;
  getVpnConnectionState(): Promise<VpnConnectionState>;
  onVpnConnectionStateChanged(cb: (state: VpnConnectionState) => void): () => void;

  // Менеджер паролей, шаг 1 (см. electron/PasswordManager.ts). Пароль пересекает IPC только
  // через revealPassword/generatePassword — listPasswords им не отдаёт, copyPasswordField сам
  // кладёт значение в буфер в main и наружу его не возвращает.
  listPasswords(): Promise<PasswordMeta[]>;
  revealPassword(id: number): Promise<string | null>;
  copyPasswordField(id: number, field: PasswordCopyField): Promise<boolean>;

  // Favicon сайта (data-URL) или null — тянется только с самого домена, кэш в main (FaviconService).
  getFavicon(host: string): Promise<string | null>;

  // OS-проверка (нативный диалог Windows) перед показом/копированием пароля — тумблер в настройках.
  getPasswordAuthEnabled(): Promise<boolean>;
  setPasswordAuthEnabled(enabled: boolean): Promise<boolean>;

  // Автозаполнение форм — адреса и карты (electron/AutofillManager.ts). Полный номер карты наружу
  // массово не отдаётся: list — только маска, полный номер — revealCardNumber под Windows Hello.
  listAddresses(): Promise<AddressProfile[]>;
  addAddress(input: AddressInput): Promise<boolean>;
  updateAddress(input: AddressUpdate): Promise<boolean>;
  deleteAddress(id: number): Promise<boolean>;
  listCards(): Promise<CardMeta[]>;
  addCard(input: CardInput): Promise<boolean>;
  updateCard(input: CardUpdate): Promise<boolean>;
  deleteCard(id: number): Promise<boolean>;
  revealCardNumber(id: number): Promise<string | null>;
  onAutofillChanged(cb: () => void): () => void;
  addPassword(input: PasswordAddInput): Promise<boolean>;
  updatePassword(input: PasswordUpdateInput): Promise<boolean>;
  deletePassword(id: number): Promise<void>;
  generatePassword(opts: PasswordGenerateOptions): Promise<string>;
  // Диалог сохранения/открытия файла — целиком в main (см. main.ts::registerIpc). Возвращает
  // false/0, если пользователь отменил диалог или passphrase не подошла — не бросает наружу.
  exportPasswords(passphrase: string): Promise<boolean>;
  importPasswords(passphrase: string): Promise<number>;
  onPasswordsChanged(cb: () => void): () => void;

  // Менеджер паролей, шаг 2 — индикатор-«ключ» + поповер (см. shared/ipc.ts::PasswordIndicatorState).
  onPasswordIndicatorChanged(cb: (state: PasswordIndicatorState | null) => void): () => void;
  savePendingPassword(): Promise<boolean>;
  updatePendingPassword(): Promise<boolean>;
  fillSavedPassword(id: number): Promise<boolean>;
  dismissPendingPassword(): Promise<void>;
  // Иконка на пустом поле пароля (offer-generate) — генерирует и сразу пишет в поле, без буфера.
  generatePendingPassword(): Promise<boolean>;
  setPasswordPopoverAnchorBounds(bounds: ContentBounds): Promise<void>;
  showPasswordPopover(state: PasswordIndicatorState): Promise<void>;
  closePasswordPopover(): Promise<void>;
  onPasswordPopoverClosed(cb: () => void): () => void;

  // Поповер VPN-пилюли (см. shared/ipc.ts::IPC.VPN_POPOVER_*, electron/VpnPopoverManager.ts) —
  // сама карточка сама запрашивает список серверов/статус через preload-vpnpopover.ts, здесь
  // только геометрия анкора и открытие/закрытие.
  setVpnPopoverAnchorBounds(bounds: ContentBounds): Promise<void>;
  showVpnPopover(): Promise<void>;
  closeVpnPopover(): Promise<void>;
  onVpnPopoverClosed(cb: () => void): () => void;
  // Домен активной вкладки для адблок-секции поповера (см. IPC.VPN_POPOVER_SET_ACTIVE_URL) —
  // Toolbar шлёт при открытии и при навигации в той же вкладке, пока поповер открыт.
  setVpnPopoverActiveUrl(url: string): Promise<void>;

  // Детект железа (см. electron/HardwareInfo.ts) — задел под подбор модели, потребителей в UI
  // пока нет. Read-only, из кэша main-процесса (или первый расчёт, если кэша ещё нет).
  getHardwareSnapshot(): Promise<HardwareSnapshot>;
  // Принудительный пересчёт снапшота — не кэш, см. HARDWARE_REFRESH_SNAPSHOT.
  refreshHardwareSnapshot(): Promise<HardwareSnapshot>;

  // Загрузчик GGUF-моделей (см. electron/ModelDownloader.ts) — задел, потребителей в UI пока нет.
  startModelDownload(spec: ModelDownloadSpec): void;
  cancelModelDownload(): void;
  getModelDownloadProgress(): Promise<DownloadProgress>;
  onModelDownloadProgress(cb: (p: DownloadProgress) => void): () => void;

  // Курируемый каталог моделей (см. electron/ModelCatalog.ts) — задел, потребителей в UI пока нет.
  getModelCatalog(): Promise<CatalogEntry[]>;

  // Явная выгрузка текущей модели из VRAM (см. electron/TranslationService.ts::unloadModel) —
  // задел, потребителей в UI пока нет.
  unloadModel(): Promise<void>;

  // Удаление модели с диска (см. electron/ModelRegistry.ts::deleteModel) — задел, потребителей
  // в UI пока нет. Необратимо.
  deleteModel(id: string): Promise<DeleteModelResult>;

  // Список установленных моделей (см. electron/ModelRegistry.ts::list) — задел, потребителей
  // в UI пока нет. Read-only.
  getInstalledModels(): Promise<InstalledModel[]>;

  // Дефолтная модель (см. electron/ModelRegistry.ts::getDefault/setDefault) — задел, потребителей
  // в UI пока нет. Смена дефолта НЕ выгружает уже загруженную модель — см. SetDefaultModelResult.
  getDefaultModelId(): Promise<string | null>;
  setDefaultModel(id: string): Promise<SetDefaultModelResult>;

  // Модель, сейчас загруженная в VRAM (см. electron/TranslationService.ts::getLoadedModelId) —
  // задел, потребителей в UI пока нет. Read-only.
  getLoadedModelId(): Promise<string | null>;
}
