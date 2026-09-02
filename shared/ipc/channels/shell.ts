// Оболочка окна: вкладки, окна, поиск по странице, правила, профили, стол, блокнот, граф
//
// Часть общего инвентаря каналов IPC — см. shared/ipc/channels.ts, там же разбор, почему он
// нарезан НЕПРЕРЫВНЫМИ кусками, а не по доменам. Имя файла говорит, что в куске преобладает,
// и не обещает, что там больше ничего нет.
export const SHELL = {
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
  // ⚠️ Здесь был window:set-overlay — единственный рычаг, который Windows давала над полосой
  // системных кнопок: ОДИН СПЛОШНОЙ ЦВЕТ. Из-за него верх окна не мог участвовать ни в градиенте
  // земли, ни в затемнении под модалкой: полосу рисовала ОС, вне нашей раскладки. Теперь кнопки
  // наши (frame: false, см. WindowControls.tsx), красить нечего, и вместо одного канала цвета
  // появились три канала действий.
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  // main → chrome: окно развернули или вернули. От этого зависит только глиф средней кнопки —
  // спрашивать состояние опросом было бы и дороже, и с задержкой.
  WINDOW_MAXIMIZED: 'window:maximized',
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
  // main → renderer: жест закрыт СТРАХОВКОЙ, вот его исход. Renderer обязан сам выйти из
  // перетаскивания — до этого канала он о принудительном завершении не узнавал вовсе.
  TAB_DRAG_FINISHED: 'tab-drag:finished',

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

  // Профили (см. shared/profiles.ts): свои куки и свои сетевые настройки на профиль.
  PROFILES_GET: 'profiles:get',            // renderer → main: список профилей и активный
  PROFILES_CREATE: 'profiles:create',      // renderer → main: завести профиль
  PROFILES_REMOVE: 'profiles:remove',      // renderer → main: удалить (основной — нельзя)
  PROFILES_RENAME: 'profiles:rename',      // renderer → main: переименовать
  PROFILES_SETTINGS: 'profiles:settings',  // renderer → main: VPN/адблок/UA/язык профиля
  PROFILES_AVATAR: 'profiles:avatar',      // renderer → main: аватарка профиля (буква/эмодзи/фото)
  PROFILES_LOOK: 'profiles:look',          // renderer → main: своя тема/палитра/обои профиля
  PROFILES_SWITCH: 'profiles:switch',      // renderer → main: сделать активным
  PROFILES_STARTUP: 'profiles:startup',    // renderer → main: закрепить профиль за запуском (null — спрашивать)
  PROFILES_CHANGED: 'profiles:changed',    // main → renderer: список изменился
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
  // Таймер стола. ⚠️ Срок живёт в main (electron/TimerService.ts), а не в виджете: счётчик в
  // рендерере досчитывал только пока открыта новая вкладка, то есть молчал ровно тогда, когда
  // человек занят чем-то другим, — а таймер заводят именно для этого случая.
  TIMER_GET: 'timer:get',         // renderer → main: текущее состояние таймера
  TIMER_SET: 'timer:set',         // renderer → main: старт/пауза/сброс — состояние целиком
  TIMER_CHANGED: 'timer:changed', // main → chrome: состояние изменилось (в т.ч. таймер сработал)
  NEWTAB_PHOTO_GET: 'newtab:photo-get', // renderer → main: «фото дня» для фона вкладки (data-URL), кэш на день
  // renderer → main: «другое фото» — шаг назад по календарю Wikimedia. Не случайный сид: там на
  // каждый день ровно одна картинка, отобранная людьми, поэтому вчерашняя тоже хорошая.
  NEWTAB_PHOTO_SHUFFLE: 'newtab:photo-shuffle',
  NOTEBOOK_EXTRACT_URL: 'notebook:extract-url', // renderer → main: извлечь читаемый текст URL-источника блокнота
  NOTEBOOK_STUDIO_GEN:  'notebook:studio-gen',  // renderer → main: (kind, context) → материал Студии (текст/спек)
  // «Собрать материал»: два канала, а не один, потому что между ними стоит ЧЕЛОВЕК — он правит
  // предложенные запросы до того, как они уйдут на внешний SearXNG (см. electron/NotebookGather.ts).
  NOTEBOOK_SUGGEST_QUERIES: 'notebook:suggest-queries', // renderer → main: (тема, контекст) → поисковые запросы
  NOTEBOOK_SEARCH:          'notebook:search',          // renderer → main: подтверждённые запросы → находки
  NOTEBOOK_SAVE_DOC:        'notebook:save-doc',        // renderer → main: диалог «сохранить документ Студии в .html»
  NOTEBOOK_STUDIO_PROGRESS: 'notebook:studio-progress', // main → renderer: знаков сгенерировано (документ идёт минутами)
  NOTEBOOK_PICK_FILES:      'notebook:pick-files',      // renderer → main: диалог выбора локальных документов
  NOTEBOOK_EXTRACT_FILE:    'notebook:extract-file',    // renderer → main: путь → текст документа (pdf/docx/txt/…)
  NOTEBOOK_OPEN_SOURCE:     'notebook:open-source',     // renderer → main: открыть источник — адрес вкладкой, файл системой
  NOTEBOOK_OPEN_DOC:        'notebook:open-doc',        // renderer → main: собранный документ — во временный файл и новой вкладкой
  NOTEBOOK_SAVE_PDF:        'notebook:save-pdf',        // renderer → main: та же страница, но печатью в PDF

  // Что ИИ делает прямо сейчас (electron/AiActivity.ts). Один реестр на приложение: у модели
  // один контекст и одна очередь, значит и состояние физически одно.
  AI_ACTIVITY_GET:     'ai-activity:get',     // renderer → main: текущая работа или null
  AI_ACTIVITY_CANCEL:  'ai-activity:cancel',  // renderer → main: прервать текущую работу
  AI_ACTIVITY_CHANGED: 'ai-activity:changed', // main → renderer: push AiActivityState|null

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

} as const;
