// Службы: пароли, модели, хаб, бэнги, диспетчер задач, обновления
//
// Часть общего инвентаря каналов IPC — см. shared/ipc/channels.ts, там же разбор, почему он
// нарезан НЕПРЕРЫВНЫМИ кусками, а не по доменам. Имя файла говорит, что в куске преобладает,
// и не обещает, что там больше ничего нет.
export const SERVICES = {
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

  // Модальный экран в ХРОМЕ (выбор профиля при старте, онбординг): renderer → main, «спрячь
  // содержимое, пока я вишу». ⚠️ Без этого модалка, нарисованная React по центру окна, лежит
  // ПОД WebContentsView страницы — видно только затемнение по краям, а кнопок нет.
  CHROME_MODAL: 'chrome:modal',

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

  // ── Диспетчер задач (Shift+Esc) ────────────────────────────────────────────
  //
  // ⚠️ Снимок ЗАПРАШИВАЕТСЯ окном диспетчера, а не рассылается пушем. Причина простая: пока окно
  // закрыто, считать нечего, а таймер в main тикал бы всегда. Опрос раз в секунду из открытого
  // окна стоит один вызов getAppMetrics и умирает вместе с окном.
  RESOURCES_SNAPSHOT: 'resources:snapshot', // renderer → main: -> ResourceSnapshot
  // Усыпить вкладку руками из диспетчера. Отдельный канал, а не «закрыть процесс»: убивать
  // рендерер мимо TabManager значило бы оставить его модель вкладок в состоянии, которого не
  // бывает, — вкладка есть, вью нет, и никто об этом не знает.
  RESOURCES_SLEEP_TAB: 'resources:sleep-tab', // renderer → main: tabId: string -> boolean (получилось ли)

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

  // Браузер как инструмент внешнего агента (electron/mcp/). ⚠️ Включение — ЯВНОЕ действие
  // человека и ничего больше: сервер не поднимается сам ни при старте, ни после обновления.
  MCP_STATE: 'mcp:state', // renderer → main: McpServerState
  MCP_SET:   'mcp:set',   // renderer → main: (enabled: boolean) -> McpServerState
  MCP_CALLS: 'mcp:calls', // renderer → main: журнал последних вызовов, McpCallLog[]
} as const;
