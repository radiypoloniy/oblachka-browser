
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
  // Активировать вкладку в ДРУГОМ окне (находка смыслового поиска по всем окнам). Отдельный
  // канал, а не параметр к TAB_ACTIVATE: тот адресуется окну-отправителю, и подмешивать к нему
  // чужое окно значило бы менять смысл вызова, которым пользуется весь сайдбар.
  TAB_ACTIVATE_IN_WINDOW: 'tab:activate-in-window',
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
  // Роль окна (см. WindowRole ниже). Спрашивается один раз при монтировании чрома: от неё
  // зависит, что окно вообще рисует.
  WINDOW_GET_ROLE: 'window:get-role',
  WINDOW_OPEN: 'window:open', // открыть новое (лёгкое) окно — Ctrl+N, пункт меню
  // Перенести вкладку в новое окно: живая страница уезжает целиком (история «назад», прокрутка,
  // введённое в форму), а не открывается заново по адресу. См. TabManager.detachTabForMove.
  WINDOW_MOVE_TAB: 'window:move-tab',
  // Обратный жест: вернуть вкладку в УЖЕ ОТКРЫТОЕ окно (перетаскиванием на него, пунктом меню
  // «Вернуть в главное окно», хоткеем). Без него вытащенное по ошибке окно можно было только
  // закрыть, потеряв страницу.
  WINDOW_MOVE_TAB_TO: 'window:move-tab-to',
  // Перетаскивание вкладки: показать/убрать зоны дропа поверх страницы. Конец возвращает зону,
  // в которой отпустили, — по ней сайдбар и решает, что сделать (см. TabDropZone).
  TAB_DRAG_START: 'tab:drag-start',
  TAB_DRAG_END: 'tab:drag-end',
  TAB_DRAG_ZONE: 'tab:drag-zone',   // main → чром: зона под курсором, пока тащат вкладку

  // Атомарный push: заменяет раздельные каналы вкладок и дерева узлов, которые были тут раньше.
  // Один IPC-пакет = один рендер = нет рассинхрона между вкладками и деревом узлов.
  SYNC_CHANGED: 'sync:changed',     // main → renderer: SyncState { tabs, nodes }
  SYNC_GET:     'sync:get',         // renderer → main: начальный атомарный запрос

  // Поиск по странице. Панель findbar живёт своей WebContentsView (см. FindBarManager) — открывает
  // и закрывает её main напрямую, поэтому каналов «открой/закрой панель» тут нет.
  FIND_START:  'find:start',        // renderer → main: начать/обновить поиск
  FIND_NEXT:   'find:next',         // renderer → main: следующее/предыдущее совпадение
  FIND_STOP:   'find:stop',         // renderer → main: остановить поиск
  FIND_RESULT: 'find:result',       // main → renderer: результат (activeMatch, count)
  FIND_SMART:  'find:smart',        // findbar → main: найти фрагменты ПО СМЫСЛУ (см. SmartFind.ts)
  FIND_SMART_SHOW: 'find:smart-show', // findbar → main: подсветить конкретную цитату из ответа

  // Поповер сведений о сайте у замочка в омнибоксе (см. electron/SitePopoverManager.ts)
  SITE_POPOVER_TOGGLE: 'site-popover:toggle',        // renderer → main: открыть/закрыть
  SITE_POPOVER_BOUNDS: 'site-popover:bounds',        // renderer → main: где стоит замочек
  SITE_POPOVER_CLOSED: 'site-popover:closed',        // main → renderer: поповер закрылся сам
  SITE_POPOVER_ACTIVE_TAB: 'site-popover:active-tab',// поповер → main: адрес и заголовок активной вкладки

  // Вопрос «этот файл уже скачан» — показывается своим поповером у значка загрузок
  DOWNLOAD_DUPLICATE_ASK:    'download:duplicate-ask',    // main → chrome: открой поповер с вопросом
  DOWNLOAD_DUPLICATE_PROMPT: 'download:duplicate-prompt', // main → поповер: сам вопрос
  DOWNLOAD_DUPLICATE_DECIDE: 'download:duplicate-decide', // поповер → main: ответ человека

  // Правила-автоматизации (см. shared/rules.ts, RuleParser.ts, RuleEngine.ts)
  RULES_PARSE:       'rules:parse',        // renderer → main: фраза → черновик правила (модель)
  RULES_ADD:         'rules:add',          // renderer → main: сохранить утверждённый черновик
  RULES_LIST:        'rules:list',         // renderer → main: список правил
  RULES_SET_ENABLED: 'rules:set-enabled',  // renderer → main: включить/выключить правило
  RULES_REMOVE:      'rules:remove',       // renderer → main: удалить правило
  RULES_CHANGED:     'rules:changed',      // main → renderer: список изменился

  DESKTOP_GEN_SPEC: 'desktop:gen-spec',    // renderer → main: фраза → спека своего виджета (тип + данные, по грамматике)
  DESKTOP_GEN_WEB: 'desktop:gen-web',      // renderer → main: сходить по ссылке человека (фид или JSON) через сессию Electron
  DESKTOP_GEN_PROGRESS: 'desktop:gen-progress', // main → renderer: ход сборки (стадия + объём)

  // Омнибокс
  OMNIBOX_FOCUS: 'omnibox:focus',   // main → renderer: сфокусировать адресную строку (Ctrl+L)

  // Закреплённые вкладки
  TAB_PIN_TOGGLE: 'tab:pin-toggle', // renderer → main: закрепить / открепить вкладку
  TAB_SET_MUTED: 'tab:set-muted',   // renderer → main: выключить/включить звук вкладки
  TAB_SHOW_MENU:  'tab:show-menu',  // renderer → main: показать нативное ПКМ-меню вкладки
  NEW_TAB_SHOW_MENU: 'tab:new-menu', // renderer → main: ПКМ по кнопке «Новая вкладка» (обычная/инкогнито/восстановить)
  CHROME_THEME_SET: 'chrome:theme-set', // renderer → main: тема chrome (dark+incognito+палитра) для раздачи во все поповеры/вью
  // Выбор человека: светлая/тёмная/как в системе + нейтральная палитра (см. ThemePrefs ниже).
  // Живёт в main (settings.json), а не в localStorage рендерера: тему обязаны знать ВСЕ окна и
  // каждый поповер со своим document — источник истины должен быть один и переживать перезапуск.
  THEME_GET:     'theme:get',
  THEME_SET:     'theme:set',
  THEME_CHANGED: 'theme:changed', // main → renderer: выбор сменили в другом окне ИЛИ система переключила тему
  WEATHER_GET: 'weather:get', // renderer → main: погода по городу для виджета новой вкладки (WeatherService)
  HOLIDAY_GET: 'holiday:get',   // renderer → main: ближайший праздник (виджет стола)
  CURRENCY_GET: 'currency:get', // renderer → main: курсы ЦБ РФ для виджета новой вкладки (CurrencyRates)
  CRYPTO_GET: 'crypto:get', // renderer → main: курсы криптовалют для виджета «Крипта» (CryptoRates)
  NEWTAB_PHOTO_GET: 'newtab:photo-get', // renderer → main: «фото дня» для фона вкладки (data-URL), кэш на день
  // renderer → main: «другое фото» — шаг назад по календарю Wikimedia. Не случайный сид: там на
  // каждый день ровно одна картинка, отобранная людьми, поэтому вчерашняя тоже хорошая.
  NEWTAB_PHOTO_SHUFFLE: 'newtab:photo-shuffle',
  NOTEBOOK_EXTRACT_URL: 'notebook:extract-url', // renderer → main: извлечь читаемый текст URL-источника блокнота
  NOTEBOOK_STUDIO_GEN:  'notebook:studio-gen',  // renderer → main: (kind, context) → материал Студии (текст/спек)

  // Граф-воркспейс (electron/GraphStore.ts + GraphEngine.ts). Структуру пишет renderer,
  // результаты узлов — только движок, см. шапку GraphStore.
  GRAPH_LIST:     'graph:list',     // renderer → main: список воркспейсов (GraphMeta[])
  GRAPH_CREATE:   'graph:create',   // renderer → main: title → GraphMeta
  GRAPH_GET:      'graph:get',      // renderer → main: graphId → GraphDoc
  GRAPH_SAVE:     'graph:save',     // renderer → main: (graphId, GraphStructure) — дебаунс на стороне холста
  GRAPH_RENAME:   'graph:rename',   // renderer → main: (graphId, title)
  GRAPH_DELETE:   'graph:delete',   // renderer → main: graphId
  GRAPH_RUN:      'graph:run',      // renderer → main: (graphId, nodeId|null) fire-and-forget, ход идёт через GRAPH_PROGRESS
  GRAPH_CANCEL:   'graph:cancel',   // renderer → main: graphId — не начинать следующий узел (текущий не прервать)
  GRAPH_PRESETS_LIST:  'graph:presets-list',   // renderer → main: пользовательские пресеты картинок
  GRAPH_PRESET_SAVE:   'graph:preset-save',    // renderer → main: создать/обновить свой пресет
  GRAPH_PRESET_DELETE: 'graph:preset-delete',  // renderer → main: удалить свой пресет
  GRAPH_SAVE_OUTPUT: 'graph:save-output',  // renderer → main: диалог «сохранить результат узла в файл»
  GRAPH_NODE_HISTORY: 'graph:node-history',  // renderer → main: прошлые результаты узла
  // Узел-диалог с локальной моделью. send — fire-and-forget, ответ идёт стримом.
  GRAPH_CHAT_LIST:  'graph:chat-list',   // renderer → main: переписка узла
  GRAPH_CHAT_SEND:  'graph:chat-send',   // renderer → main: (graphId, nodeId, text)
  GRAPH_CHAT_CLEAR: 'graph:chat-clear',  // renderer → main: очистить переписку узла
  GRAPH_CHAT_CHUNK: 'graph:chat-chunk',  // main → renderer: { graphId, nodeId, text }
  GRAPH_CHAT_DONE:  'graph:chat-done',   // main → renderer: { graphId, nodeId, ok, text?, error? }
  GRAPH_PICK_FILE: 'graph:pick-file',  // renderer → main: нативный диалог выбора документа для узла-файла
  GRAPH_PICK_IMAGE: 'graph:pick-image',      // renderer → main: диалог выбора картинки для узла-картинки
  GRAPH_IMAGE_PREVIEW: 'graph:image-preview',// renderer → main: путь → data-URL уменьшенного превью | null
  GRAPH_CHANGED:  'graph:changed',   // main → renderer: граф пополнился извне (ПКМ «Добавить в граф»)
  GRAPH_PROGRESS: 'graph:progress', // main → renderer: GraphProgress (статусы + стрим-чанки)

  // Узел-веб-приложение: чужой AI-сайт в панели 1:1. Обмен только через руку человека —
  // автоматической отправки нет по замыслу (см. electron/graphWebApps.ts).
  GRAPH_WEBAPP_SHOW:    'graph:webapp-show',    // renderer → main: (graphId, nodeId, url, bounds) — показать сайт в панели
  GRAPH_WEBAPP_BOUNDS:  'graph:webapp-bounds',  // renderer → main: (graphId, nodeId, bounds) — нулевой прямоугольник = скрыть окно
  GRAPH_WEBAPP_RAISE:   'graph:webapp-raise',   // renderer → main: поднять окно узла над остальными
  GRAPH_WEBAPP_CLOSE:   'graph:webapp-close',   // renderer → main: (graphId, nodeId) — уничтожить вью узла
  GRAPH_WEBAPP_INSERT:  'graph:webapp-insert',  // renderer → main: (graphId, nodeId) → положить промпт графа в поле ввода
  GRAPH_WEBAPP_CAPTURE: 'graph:webapp-capture', // renderer → main: (graphId, nodeId, mode) → забрать ответ в результат узла
  GRAPH_WEBAPP_CAPTURE_IMAGE: 'graph:webapp-capture-image', // renderer → main: забрать картинку из чата на диск

  // Split View
  TAB_ENTER_SPLIT:  'tab:enter-split',  // renderer → main: войти в split (вкладка + сторона)
  TAB_REPLACE_PANEL: 'tab:replace-panel', // renderer → main: занять половину сплита, выселенная уходит в список
  TAB_EXIT_SPLIT:   'tab:exit-split',   // renderer → main: выйти из split, обе вкладки остаются
  TAB_SPLIT_FOCUS:  'tab:split-focus',  // renderer → main: переключить фокус на панель
  TAB_SPLIT_RATIO:  'tab:split-ratio',  // renderer → main: новое соотношение панелей при drag
  TAB_SPLIT_SWAP:   'tab:split-swap',   // renderer → main: поменять половины пары местами (ширины слотов остаются)
  SPLIT_SWAP_HINT:  'split:swap-hint',  // renderer → main: подсветить панель-цель, пока половину тащат за шапку
  SPLIT_CAPTURE_PANE: 'split:capture-pane', // renderer → main: снимок панели для карточки в руке
  SPLIT_DRAG_THUMB:   'split:drag-thumb',   // renderer → main → оверлей: тот же снимок, чтобы карточка была одна
  // renderer → main (поток, send): курсор в координатах ОКНА, null — курсор ушёл из окна.
  // Нужен, чтобы карточка ехала за курсором: рисует её оверлей — единственный слой поверх
  // нативных вьюх страниц. Один раз на кадр, только пока идёт перетаскивание.
  SPLIT_DRAG_CURSOR: 'split:drag-cursor',

  // Переупорядочивание вкладок drag-and-drop
  TAB_REORDER: 'tab:reorder',           // renderer → main: { section, orderedIds } после drop
  TAB_MOVE_SECTION: 'tab:move-section', // renderer → main: перенос между секциями { tabId, targetSection, targetIndex }

  // Группы вкладок (Phase 3)
  SIDEBAR_NODES_GET:          'sidebar:nodes-get',          // renderer → main: запрос текущего SidebarNode[]
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
  // ⚠️ СИНХРОННЫЙ канал (ipcRenderer.sendSync), единственный в проекте, и это не небрежность.
  // Скриптлеты обязаны выполниться РАНЬШЕ инлайн-скриптов страницы, а штатный путь Ghostery —
  // асинхронный invoke из preload плюс executeJavaScript обратно — всегда опаздывает на два
  // перехода. Для YouTube это решает всё: ytInitialPlayerResponse с adPlacements ставится ранним
  // инлайн-скриптом, и set-constant/json-prune обязаны успеть до него. Замер цены блокировки
  // рендерера: 0,69 мс на YouTube (30 скриптлетов), 0,06–0,09 мс на обычных сайтах.
  // Зовётся ТОЛЬКО из top-frame гостевой страницы — см. preload-content.ts.
  ADBLOCK_BOOT_SCRIPTLETS: 'adblock:boot-scriptlets', // гостевая страница → main (sync): код скриптлетов или null

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
  BOOKMARK_LIST_TREE:     'bookmark:list-tree',       // renderer → main: всё дерево с папками (сайдбар)
  BOOKMARK_SHOW_MENU:     'bookmark:show-menu',       // renderer → main: звезда/Ctrl+D — сохранить и предложить папку
  BOOKMARK_CREATE_FOLDER: 'bookmark:create-folder',   // renderer → main: (title, parentId) -> BookmarkEntry | null
  BOOKMARK_RENAME:        'bookmark:rename',          // renderer → main: (id, title) -> boolean
  BOOKMARK_MOVE:          'bookmark:move',            // renderer → main: (id, parentId) -> boolean, в конец уровня
  BOOKMARK_REORDER:       'bookmark:reorder',         // renderer → main: (parentId, orderedIds) -> boolean
  // Умная раскладка: SUGGEST только считает и ничего не меняет, APPLY выполняет уже одобренное.
  // Два канала, а не один, — ровно потому, что между ними стоит согласие человека.
  BOOKMARK_ORGANIZE_SUGGEST: 'bookmark:organize-suggest', // renderer → main: -> BookmarkFolderProposal[]
  BOOKMARK_ORGANIZE_APPLY:   'bookmark:organize-apply',   // renderer → main: (proposals) -> number (разложено)
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
  // Пароли из CSV-экспорта другого браузера. Отдельный путь от IMPORT_RUN: пароли Chrome 127+
  // (App-Bound v20) с диска физически не читаются без прав SYSTEM, а лезть туда — техника
  // инфостилера; санкционированный путь — экспорт CSV из самого браузера. Диалог выбора файла —
  // целиком в main. См. shared/csvPasswords.ts.
  IMPORT_PASSWORDS_CSV: 'import:passwords-csv', // renderer → main: () -> CsvPasswordImport
  // Браузер по умолчанию (см. electron/DefaultBrowser.ts). ⚠️ Назначить себя программно нельзя —
  // REQUEST только открывает системный выбор, решение принимает человек.
  // Спрашивать ли папку для каждой загрузки (по умолчанию нет, см. electron/DownloadManager.ts).
  DOWNLOADS_GET_ASK_LOCATION: 'downloads:get-ask-location',
  DOWNLOADS_SET_ASK_LOCATION: 'downloads:set-ask-location',

  // Открыть AI-панель сразу на нужном приложении (иконки калькулятора и прочих на рабочем
  // столе новой вкладки — сами приложения живут в панели, см. electron/AiPanelManager.ts).
  AI_PANEL_OPEN_APP: 'ai-panel:open-app-request',
  // Ряд значений курса за последние дни — спарклайн виджета «Курс ЦБ».
  CURRENCY_HISTORY: 'currency:history',
  // То же для виджета «Крипта» (см. electron/CryptoRates.ts) — отдельный канал, потому что
  // отдельный источник и другой ритм обновления, а не потому что данные другой формы.
  CRYPTO_HISTORY: 'crypto:history',

  DEFAULT_BROWSER_IS: 'default-browser:is',
  DEFAULT_BROWSER_REQUEST: 'default-browser:request',

  // Экран первого запуска (рассказ о браузере + перенос данных, см. src/components/Onboarding.tsx).
  // ⚠️ Показывается независимо от того, нашлись ли браузеры для импорта: рассказ нужен и тому, у
  // кого переносить нечего. Флаг на диске по-прежнему зовётся importOffered — переименовывать поле
  // значило бы городить миграцию settings.json ради названия.
  ONBOARDING_SHOULD_SHOW: 'onboarding:should-show', // renderer → main: первый ли это запуск
  ONBOARDING_MARK_SHOWN: 'onboarding:mark-shown',   // renderer → main: экран показан, больше не предлагать

  // Разрешения сайтов. Сам вопрос в хром больше НЕ уходит — его рисует своя WebContentsView
  // (electron/PermissionPopoverManager.ts), и канал показа у неё свой, маленький
  // (permission-popover:request), как у findbar/translate-popover. Ответ остался общим каналом:
  // труба разрешений не менялась, поменялась только вью, в которой задают вопрос.
  PERMISSION_RESPONSE: 'permission:response',   // поповер → main: ответ пользователя (requestId, granted, remember)
  // Раздел настроек «Разрешения сайтов» — посмотреть и поменять уже принятые решения.
  PERMISSION_LIST:   'permission:list',    // renderer → main: -> PermissionRecord[]
  PERMISSION_SET:    'permission:set',     // renderer → main: (origin, key, decision)
  PERMISSION_REVOKE: 'permission:revoke',  // renderer → main: (origin, key?) — забыть, а не запретить

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
  // Имя по содержимому (см. electron/DownloadNamer.ts). ⚠️ Каналов ДВА, и разделены они
  // намеренно: «предложить» ничего не трогает на диске, «переименовать» необратимо. Между ними
  // стоит человек, увидевший предложенное имя.
  // Поиск по настройкам фразой — ВТОРОЙ эшелон (см. electron/SettingsSearch.ts). Основной путь,
  // поиск по ключевым словам, живёт целиком в renderer и в main не ходит вовсе.
  SETTINGS_SEARCH_SMART: 'settings:search-smart', // renderer → main: фраза → индексы SETTINGS_INDEX
  DOWNLOAD_SUGGEST_NAME: 'download:suggest-name', // renderer → main: id → DownloadNameSuggestion
  DOWNLOAD_RENAME:       'download:rename',       // renderer → main: (id, имя) → DownloadRenameResult

  // AI-группировка вкладок (Phase 4)
  TABS_ORGANIZE_APPLY:    'tabs:organize-apply',    // renderer → main: OrganizeCluster[] → сгруппировать
  TABS_ORGANIZE_ROLLBACK: 'tabs:organize-rollback', // renderer → main: откатить последнюю группировку
  // Массовое переименование — вторая половина «навести порядок». Имена приезжают в UI по одному
  // обычным SYNC_CHANGED (человек видит, как список приводится в порядок), поэтому канал ничего
  // не возвращает кроме факта завершения.
  TABS_RENAME_ALL:      'tabs:rename-all',      // renderer → main: придумать имена всем вкладкам
  TABS_RENAME_ROLLBACK: 'tabs:rename-rollback', // renderer → main: вернуть прежние названия
  TABS_RENAME_PROGRESS: 'tabs:rename-progress', // main → renderer: { done, total } для индикатора
  TABS_SUGGEST_GROUPS:    'tabs:suggest-groups',    // renderer → main: TabOrganizer.ts::suggestGroups() → OrganizeProposal
  // Поиск вкладки ПО СМЫСЛУ (см. electron/TabSearch.ts) — второй эшелон омнибокса, дёргается
  // только когда обычное совпадение по заголовку/адресу не нашло ничего. Отдаёт id вкладок.
  TABS_SEARCH_SMART:      'tabs:search-smart',      // renderer → main: запрос → id подходящих вкладок

  // «Итоги дня» — несколько строк о том, чем человек сегодня занимался (см. electron/DayDigest.ts).
  // GET ничего не считает и модель не трогает; BUILD — явное действие человека, ему позволено
  // дождаться загрузки модели.
  DIGEST_GET:   'digest:get',
  DIGEST_BUILD: 'digest:build',

  // «Вы это уже читали» — связанные страницы из своей истории для открытой вкладки
  // (см. electron/RelatedHistory.ts). Пусто — нечего показать, и это нормальный ответ.
  HISTORY_RELATED: 'history:related',
  // «Что изменилось с прошлого раза» (см. electron/PageChanges.ts) — поповер замочка спрашивает
  // про АКТИВНУЮ вкладку, адрес main берёт у себя (рендерер мог отстать от навигации).
  PAGE_CHANGES_GET: 'page:changes-get',
  // «Куда я это дел» — один поиск по истории, закладкам и загрузкам (см. electron/StuffSearch.ts).
  STUFF_SEARCH: 'stuff:search',
  // Отслеживание товаров (см. electron/TrackingStore.ts, PRICE-TRACKING.md).
  PRODUCT_STATE:  'product:state',   // main → chrome: что за товар на активной вкладке (или null)
  PRODUCT_MENU:   'product:menu',    // chrome → main: показать меню у индикатора в тулбаре
  // chrome → main: меню «⋯» в адресной строке — действия над ЭТОЙ страницей, которым не нужна
  // постоянная кнопка (перевод, отслеживание цены). Состояние меню main берёт у себя, renderer
  // ничего не передаёт: иначе оно разъезжалось бы с настоящим.
  OMNIBOX_MORE_MENU: 'omnibox:more-menu',
  TRACKING_LIST:  'tracking:list',   // renderer → main: список отслеживаемого с историей цен
  TRACKING_UNTRACK: 'tracking:untrack', // renderer → main: снять с отслеживания (id)
  TRACKING_CHANGED: 'tracking:changed', // main → chrome: список изменился
  TRACKING_CHECK_NOW: 'tracking:check-now', // renderer → main: проверить всё сейчас (кнопка)
  TRACKING_EVENTS: 'tracking:events',       // renderer → main: журнал событий
  TRACKING_NOTIFY_GET: 'tracking:notify-get', // renderer → main: включены ли уведомления
  TRACKING_NOTIFY_SET: 'tracking:notify-set', // renderer → main: включить/выключить
  TRACKING_SUGGESTIONS: 'tracking:suggestions',   // renderer → main: предложения склейки
  TRACKING_MERGE: 'tracking:merge',               // renderer → main: объединить (aId, bId)
  TRACKING_MERGE_DISMISS: 'tracking:merge-dismiss', // renderer → main: не объединять
  TRACKING_UNGROUP: 'tracking:ungroup',           // renderer → main: вынуть из группы (id)
  // Буфер скопированного со страниц (см. electron/ClipboardBuffer.ts). ⚠️ Только в памяти и
  // только на сеанс: источник — событие copy на странице, системный буфер мы не опрашиваем.
  CLIPBOARD_COPIED:   'clipboard:copied',      // гостевая страница → TabManager: { text, title }
  // Копирование в САМОМ ИНТЕРФЕЙСЕ браузера (адресная строка, история, закладки) — отдельный канал,
  // а не тот же. Сообщение от гостевой страницы приходит и в ipcMain тоже, поэтому общий канал
  // означал бы вторую, необлагороженную запись каждой копии со страницы — В ОБХОД проверки на
  // инкогнито, которая живёт в TabManager.
  CLIPBOARD_COPIED_UI: 'clipboard:copied-ui',

  CLIPBOARD_LIST:     'clipboard:list',        // поповер → main: записи буфера
  // chrome → main: СКОЛЬКО записей в буфере. Отдельно от CLIPBOARD_LIST намеренно: тулбару нужно
  // одно число, а список несёт тексты и разметку скопированного — гонять его в слой хрома ради
  // счётчика значит раздавать содержимое буфера туда, где оно не нужно.
  CLIPBOARD_COUNT:    'clipboard:count',
  CLIPBOARD_PUT:      'clipboard:put',         // поповер → main: положить запись в буфер обмена ОС
  // Поповер → main: положить в буфер ОС ОДИН адрес из записи (когда нужна сама ссылка, а не текст).
  // ⚠️ Принимает id записи и url, а НЕ произвольную строку: main проверяет, что такой адрес в этой
  // записи действительно есть. Писать в системный буфер что угодно по слову рендерера мы не даём.
  CLIPBOARD_PUT_LINK: 'clipboard:put-link',
  CLIPBOARD_OPEN_SOURCE: 'clipboard:open-source', // поповер → main: открыть страницу-источник и подсветить фрагмент
  CLIPBOARD_REMOVE:   'clipboard:remove',      // поповер → main: убрать одну запись
  // Поповер → main: закрепить/открепить. Закреплённое идёт первым, не вытесняется пределом и
  // ПЕРЕЖИВАЕТ перезапуск — единственное, что вообще попадает из буфера на диск.
  CLIPBOARD_PIN:      'clipboard:pin',
  CLIPBOARD_CLEAR:    'clipboard:clear',       // поповер → main: очистить всё
  CLIPBOARD_ENABLED_GET: 'clipboard:enabled-get',
  CLIPBOARD_ENABLED_SET: 'clipboard:enabled-set',
  CLIPBOARD_CHANGED:  'clipboard:changed',     // main → chrome: список изменился (для индикатора)
  CLIPBOARD_POPOVER_TOGGLE: 'clipboard-popover:toggle', // chrome → main: открыть/закрыть
  CLIPBOARD_POPOVER_BOUNDS: 'clipboard-popover:bounds', // chrome → main: где стоит кнопка
  CLIPBOARD_POPOVER_CLOSED: 'clipboard-popover:closed', // main → chrome: закрылся сам

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
  // Заход 11: панель по НЕТРОНУТОЙ строке (плитки + полоска сайта + «вы это уже читали»).
  // Отдельный канал, а не флаг внутри items: у панели своя форма (OmniboxPanel), и мешать её
  // с массивом подсказок значит однажды прислать одно, а нарисовать другое.
  SUGGEST_DROPDOWN_SET_PANEL: 'suggest-dropdown:set-panel',
  // Клик по полоске сайта В ПАНЕЛИ — вью → main → chrome, где Toolbar.tsx открывает полный поповер
  // замочка. Панель показывает сводку и НЕ дублирует управление разрешениями: одно место правды.
  SUGGEST_DROPDOWN_SITE_INFO: 'suggest-dropdown:site-info',
  // Правка набора «Рекомендуемые» карандашом в панели — вью → main → chrome. Список хранит
  // SettingsManager, но владельцем содержимого панели остаётся Toolbar.tsx: он принимает намерение,
  // сохраняет набор и пересобирает панель. Второго места, решающего «что показано», не появляется.
  SUGGEST_DROPDOWN_RECOMMEND: 'suggest-dropdown:recommend',
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
  SETTINGS_GET_RECOMMENDED:   'settings:get-recommended',   // renderer → main: набор «Рекомендуемые» для панели омнибокса
  SETTINGS_SET_RECOMMENDED:   'settings:set-recommended',   // renderer → main: сохранить набор целиком
  // Сайты, которые нельзя выгружать из памяти (ПКМ по вкладке + раздел настроек).
  NEVER_SLEEP_LIST:   'never-sleep:list',    // renderer → main: -> string[] хостов
  NEVER_SLEEP_REMOVE: 'never-sleep:remove',  // renderer → main: снять защиту с хоста
  // main → renderer: список изменился (правку сделали ИЗ МЕНЮ, а раздел настроек мог быть открыт
  // соседней вкладкой). Без этого открытый список молча показывал бы устаревшее.
  NEVER_SLEEP_CHANGED: 'never-sleep:changed',
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
  // Страница просит убрать поповер: Esc, уход фокуса с поля, прокрутка. ⚠️ Без этого канала
  // карточка не убиралась ВООБЩЕ — ни клавишей, ни кликом мимо, и оставалась висеть над формой.
  AUTOFILL_DISMISS:        'autofill:dismiss',        // гостевая страница → main: закрыть поповер
  AUTOFILL_CHANGED:        'autofill:changed',        // main → renderer: push после любой мутации

  // Доверие корню Минцифры, выданное человеком поверх вшитого списка банков (CertTrustStore.ts).
  // ⚠️ Канала «добавить» тут НЕТ намеренно: разрешение выдаётся только ответом на вопрос в момент
  // проверки сертификата (CertificateTrust.ts), а не кнопкой в интерфейсе. Дать его позже нельзя
  // технически — Chromium кэширует вердикт, и разрешение задним числом не срабатывает.
  CERT_TRUST_LIST:         'cert-trust:list',         // renderer → main: список доменов
  CERT_TRUST_REMOVE:       'cert-trust:remove',       // renderer → main: домен → boolean

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
  // Клик человека в САМО пустое поле пароля — тот же поповер, что по значку-ключу. Отдельный канал
  // от значка, а не флаг в payload: у них разные права (значок предлагает ещё и сгенерировать
  // пароль, клик в поле — только подставить сохранённое), и разводить их лучше на входе.
  PASSWORDS_FIELD_FOCUS: 'passwords:field-focus', // гостевая страница → TabManager: { rect: {x,y,width,height} }
  // Страница просит убрать поповер: клик мимо поля, Esc, прокрутка. ⚠️ Без этого канала «клика
  // мимо» не существовало вовсе: поповер закрывался только по фокусу СТРАНИЦЫ из хрома, а когда
  // его открыл клик по самой странице, фокус уже там — и повторные клики main не видит.
  PASSWORDS_DISMISS: 'passwords:dismiss', // гостевая страница → TabManager: без полезной нагрузки

  // Автозаполнение форм — сигналы между гостевой страницей и TabManager (per-view webContents.ipc,
  // как у паролей). url НИКОГДА не из payload — main берёт wc.getURL(). Адреса/карты не привязаны к
  // origin (в отличие от паролей), url нужен лишь чтобы отсечь служебные схемы.
  // Медиасессия страницы: что играет и как этим управлять (см. electron/MediaSessionManager.ts).
  // ⚠️ Источник — стандартный navigator.mediaSession самой страницы, а не разбор её вёрстки:
  // так виджет работает с любым сервисом и не ломается от редизайна.
  MEDIA_SESSION_REPORT: 'media:session-report', // гостевая страница → TabManager: MediaSessionReport
  MEDIA_SESSION_COMMAND: 'media:session-command', // TabManager → гостевая вкладка: MediaCommand
  MEDIA_STATE_CHANGED: 'media:state-changed',   // main → chrome: MediaNowPlaying | null
  MEDIA_STATE: 'media:state',                   // chrome → main: текущее состояние (первый кадр)
  MEDIA_COMMAND: 'media:command',               // chrome → main: MediaCommand → boolean

  AUTOFILL_FIELD_FOCUS: 'autofill:field-focus', // гостевая страница → TabManager: { rect, kind: 'address'|'card' }
  AUTOFILL_FILL_FIELDS: 'autofill:fill-fields', // TabManager → гостевая вкладка: карта значений полей для подстановки
  // Человек закрыл предложение крестиком — страница запоминает отказ и больше не поднимает поповер
  // для ТОГО ЖЕ поля. Без этого канала отказ знал бы только main, а решение «не лезть сюда» должно
  // жить рядом с полем, к которому оно относится.
  AUTOFILL_DECLINED: 'autofill:declined',   // TabManager → гостевая вкладка: без полезной нагрузки
  // Гостевая страница → main: «что это за поля?» для тех, что не осилила эвристика. Ответ —
  // карта «индекс → категория» из кэша или от локальной модели (см. AutofillFieldMapper.ts).
  AUTOFILL_MAP_FIELDS: 'autofill:map-fields',
  // Вставленная в поле строка, похожая на адрес целиком (см. electron/AddressParser.ts).
  // ⚠️ Текст читает ТОЛЬКО локальная модель в main; фильтр «похоже ли это на адрес» стоит на
  // стороне страницы (preload-content), чтобы случайный текст из буфера сюда не приезжал вовсе.
  AUTOFILL_PASTE_BLOB: 'autofill:paste-blob', // гостевая страница → TabManager: { text, rect }
  // Тот же разбор, но по ЯВНОЙ просьбе из настроек: вставил строку — получил заполненную карточку
  // адреса вместо десяти полей руками. ⚠️ Гейта isModelWarm здесь нет (в отличие от вставки на
  // странице): человек нажал кнопку, и такое действие вправе ждать загрузку модели.
  AUTOFILL_PARSE_ADDRESS: 'autofill:parse-address', // renderer → main: строка → ParsedAddressPart[]
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

  // ⚠️ Здесь стояли VPN_POPOVER_* — поповер пилюли «Защита». Пилюли и её поповера больше нет:
  // VPN и адблок переехали в карточку под щитом адресной строки (SITE_POPOVER_*), потому что щит
  // и замок отвечали на один и тот же вопрос. Канал «домен активной вкладки» тоже не понадобился:
  // карточка сайта и так знает, какая вкладка активна (SITE_POPOVER_ACTIVE_TAB).

  // Поповер загрузок у одноимённой кнопки тулбара — та же техника, что PASSWORD_POPOVER_* выше
  // (см. electron/DownloadsPopoverManager.ts). Список поповер запрашивает сам через свой preload,
  // а живой прогресс main толкает в саму вью (иначе полоска замерла бы до переоткрытия).
  DOWNLOADS_POPOVER_SET_BOUNDS: 'downloads-popover:set-bounds',
  DOWNLOADS_POPOVER_SHOW:       'downloads-popover:show',
  DOWNLOADS_POPOVER_CLOSE:      'downloads-popover:close',
  DOWNLOADS_POPOVER_CLOSED:     'downloads-popover:closed',
  // «Все загрузки» со дна поповера: сама вью открыть вкладку не может (она не знает про окно и
  // не имеет боевого preload), поэтому просит main, а тот просит хром своего окна.
  DOWNLOADS_POPOVER_OPEN_ALL:   'downloads-popover:open-all',

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

  // Бэнги омнибокса (см. electron/BangStore.ts, shared/bangs.ts). CRUD только для
  // пользовательских — встроенные неизменяемы и отдаются отдельным списком.
  BANGS_LIST:           'bangs:list',            // renderer → main: BangsSnapshot
  BANGS_UPSERT:         'bangs:upsert',          // renderer → main: BangDef -> string | null (причина отказа)
  BANGS_REMOVE:         'bangs:remove',          // renderer → main: key: string
  BANGS_IMPORT_DDG:     'bangs:import-ddg',      // renderer → main: -> ImportBangsResult
  BANGS_DERIVE_TABS:    'bangs:derive-tabs',     // renderer → main: -> DerivedBangCandidate[]
  BANGS_CLEAR_IMPORTED: 'bangs:clear-imported',  // renderer → main: (без параметров)

  // Полоса целей быстрого поиска (Ctrl+E): режим наполнения и закреплённый набор.
  SEARCH_CHIPS_GET:        'search-chips:get',        // renderer → main: -> SearchChipsConfig
  SEARCH_CHIPS_SET:        'search-chips:set',        // renderer → main: SearchChipsConfig
  SEARCH_CHIPS_SEARCH:     'search-chips:search',     // renderer → main: строка -> SearchChipCandidate[] (короткая выдача)
  SEARCH_CHIPS_RESOLVE:    'search-chips:resolve',    // renderer → main: id[] -> SearchChipCandidate[] (что нашлось)

  // Явный возврат OS-фокуса вебконтентам чрома. Нужен из-за того, что дропдаун подсказок —
  // отдельная WebContentsView: её addChildView уводит фокус с омнибокса, и main компенсирует это
  // только в МОМЕНТ открытия (см. SUGGEST_DROPDOWN_TOGGLE). Клик по инпуту при уже открытом
  // дропдауне остаётся без компенсации — DOM-фокус есть, OS-фокуса нет, клавиши уходят мимо.
  CHROME_FOCUS: 'chrome:focus', // renderer → main: (без параметров)

  // Автообновление (см. electron/UpdateManager.ts). Тот же контракт, что MODEL_DOWNLOAD_*:
  // команды — fire-and-forget send, STATUS — invoke (на случай гонки с монтированием секции
  // настроек), CHANGED — push. Загрузка и установка НИКОГДА не начинаются сами: и то и другое
  // требует явного действия пользователя.
  UPDATE_CHECK:    'update:check',    // renderer → main: (без параметров) — запустить проверку
  UPDATE_DOWNLOAD: 'update:download', // renderer → main: (без параметров) — качать найденное
  UPDATE_INSTALL:  'update:install',  // renderer → main: (без параметров) — выйти и установить
  UPDATE_STATUS:   'update:status',   // renderer → main: UpdateStatus
  UPDATE_CHANGED:  'update:changed',  // main → renderer: push UpdateStatus
} as const;
