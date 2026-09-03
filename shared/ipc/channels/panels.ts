// Панели и поповеры: AI-панель, перевод, подсказки омнибокса, настройки, VPN, пароли
//
// Часть общего инвентаря каналов IPC — см. shared/ipc/channels.ts, там же разбор, почему он
// нарезан НЕПРЕРЫВНЫМИ кусками, а не по доменам. Имя файла говорит, что в куске преобладает,
// и не обещает, что там больше ничего нет.
export const PANELS = {
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
  SETTINGS_GET_PAGE_LENGTH:   'settings:get-page-length',   // renderer → main: объём страницы Студии
  SETTINGS_SET_PAGE_LENGTH:   'settings:set-page-length',   // renderer → main: (PageLength)
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
  // ── Подключения к моделям (BYOK) ─────────────────────────────────────────
  // ⚠️ Ключ уходит ТОЛЬКО в save и test, и только в main. Обратно не возвращается никогда — see
  // electron/ai/KeyStore.ts: наружу уходит лишь список подключений, у которых ключ на месте.
  AI_CONN_LIST:           'ai:connections',
  AI_CONN_SAVE:           'ai:connection-save',
  AI_CONN_DELETE:         'ai:connection-delete',
  // Проба живого подключения: один дешёвый запрос к провайдеру. Без неё человек узнаёт об опечатке
  // в ключе через полминуты в чате и не понимает, что случилось.
  AI_CONN_TEST:           'ai:connection-test',
  AI_SET_ROUTE:           'ai:set-route',
  AI_CONN_CHANGED:        'ai:connections-changed',
  AI_KEY_STATUS_CHANGED:  'ai:key-status-changed',  // main → renderer: push нового connected-статуса
  // ── Вложения из ответа модели ────────────────────────────────────────────
  // ⚠️ БАЙТЫ ЖИВУТ У MAIN (electron/ai/FileStore.ts), наружу ходят описания: картинка от модели
  // это мегабайты, и через IPC они уезжали бы на каждом пуше, а в истории беседы оставались бы
  // навсегда. data — по явной просьбе показать картинку, save — сохранение по клику.
  AI_FILE_DATA:           'ai:file-data',
  AI_FILE_SAVE:           'ai:file-save',
  // Текстовый фрагмент ответа файлом: чат-API не отдаёт ни .docx, ни .pdf — «документ» от модели
  // это всегда текст (таблица, разметка, код), которому не хватает имени и расширения.
  AI_TEXT_SAVE:           'ai:text-save',

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

} as const;
