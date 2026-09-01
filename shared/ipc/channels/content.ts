// Содержимое: группы вкладок, буфер, закладки, загрузки, адблок, отслеживание цены
//
// Часть общего инвентаря каналов IPC — см. shared/ipc/channels.ts, там же разбор, почему он
// нарезан НЕПРЕРЫВНЫМИ кусками, а не по доменам. Имя файла говорит, что в куске преобладает,
// и не обещает, что там больше ничего нет.
export const CONTENT = {
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
  // Что показать на щите про этот сайт: висит вопрос или ему молча отказали по прежнему решению.
  PERMISSION_HINT:         'permission:hint',          // renderer → main: (origin) → 'ask'|'blocked'|null
  PERMISSION_HINT_CHANGED: 'permission:hint-changed',  // main → renderer: перечитай, состояние поменялось

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
  // ⚠️ СПОРНЫЙ ХОТКЕЙ, который страница НЕ забрала себе (см. preload-content.ts). Ctrl+D в
  // Google Таблицах — «заполнить вниз», Ctrl+R — «заполнить вправо», Ctrl+F и Ctrl+H — их
  // собственные поиск и замена. `before-input-event` в main срабатывает раньше страницы, и
  // перехват там означал бы, что редактор своих клавиш не увидит вообще. Поэтому эти пять
  // приходят СНИЗУ и только когда страница ими не воспользовалась.
  // ⚠️ Строка канала продублирована в preload-content.ts руками — sandboxed preload не может
  // require() относительные модули; сторож контракта сверяет их за человека.
  PAGE_HOTKEY: 'page:hotkey',
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
  // renderer → main: мышь пришла на кнопку поповера — построй его вью заранее.
  // ⚠️ Прогрев ПО НАВЕДЕНИЮ, а не на старте: между «мышь на кнопке» и «кнопка нажата» проходит
  // 150–400 мс, и этого хватает, чтобы документ успел загрузиться, — а вью при этом не висит
  // процессом у тех, кто этой кнопкой не пользуется. Поповеры, которые открывают чаще всех
  // (карточка сайта, загрузки), прогреваются иначе — на старте, см. main.ts.
  // renderer → main: человек ПРАВИТ адресную строку прямо сейчас.
  // ⚠️ Нужен ровно для одного: Escape. Пока идёт правка, эта клавиша принадлежит омнибоксу
  // (откатить набранное), а не странице (остановить загрузку) — см. разбор в TabManager.
  OMNIBOX_SET_EDITING: 'omnibox:set-editing',
  POPOVER_PREWARM: 'popover:prewarm',
  CLIPBOARD_POPOVER_BOUNDS: 'clipboard-popover:bounds', // chrome → main: где стоит кнопка
  CLIPBOARD_POPOVER_CLOSED: 'clipboard-popover:closed', // main → chrome: закрылся сам

} as const;
