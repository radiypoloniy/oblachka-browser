// Единый источник правды по форме данных, которыми обмениваются
// renderer (хром-UI) и main (движок вкладок). Импортируется обеими сторонами.

import type { SearchEngineId } from './searchEngines';
import type {
  GraphChatMessage, GraphDoc, GraphMeta, GraphNodeVersion, GraphProgress, GraphStructure,
} from './graph';
import type { ImagePreset } from './imagePresets';
import type { AutomationRule } from './rules';

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

// Вопрос о повторной загрузке (см. electron/DownloadManager.ts). Пока он не отвечен, загрузка
// стоит на паузе и в списке не показывается — отказ не должен оставлять запись «Отменено».
export interface DuplicateDownloadPrompt {
  askId: string;
  filename: string;
  savePath: string;
  downloadedAt: number;
}
export type DuplicateDownloadDecision = 'download' | 'open' | 'cancel';

export interface FindResult {
  activeMatch: number; // порядковый номер текущего совпадения (1-based)
  count: number;       // всего совпадений
}

// Разбор фразы в правило (electron/RuleParser.ts). Черновик приходит в renderer, показывается
// карточкой и сохраняется, только если человек его утвердил, — модель ничего не заводит сама.
export type RuleParseOutcome =
  | { ok: true; rule: AutomationRule }
  // 'unclear' — фраза не легла в закрытый каталог (это нормальный и частый исход),
  // 'model-error' — модель не ответила/не загрузилась.
  | { ok: false; reason: 'unclear' | 'model-error'; error?: string };

// Ответ смыслового Ctrl+F (electron/SmartFind.ts). Панель поиска рисует по нему только статус:
// сам результат человек видит НА СТРАНИЦЕ — штатной подсветкой findInPage, к которой её и
// прокручивает. Отдельного окна с ответом нет намеренно: цитата и так на месте, в контексте.
export interface SmartFindResult {
  ok: boolean;
  // Цитаты СО СТРАНИЦЫ (модель выбирает номера фрагментов, а не пишет текст), лучшая первой.
  // ⚠️ Их несколько, а не одна: на подборке (например, список игр одного жанра) единственный
  // ответ выглядит как недоработка — человек видит на странице ещё подходящие места. Панель
  // листает их стрелками, как обычные совпадения.
  quotes?: string[];
  matches?: number; // сколько совпадений подсветилось у ПОКАЗАННОЙ сейчас цитаты
  // 'no-model' — модель не отвечает/не загрузилась, 'no-text' — со страницы нечего читать,
  // 'not-found' — модель ничего не выбрала либо цитата не нашлась подсветкой, 'busy' — уже ищем.
  reason?: 'no-model' | 'no-text' | 'not-found' | 'busy';
}

// Цель быстрого поиска (Ctrl+E, см. electron/SearchTargets.ts + SearchPopoverManager.ts).
// Смысл фичи — не заставлять называть цель ДО запроса («!yt котики»), а предложить её самой:
// первой идёт текущий сайт, если по его адресу удалось восстановить шаблон поиска.
export interface SearchTarget {
  // 'site' — текущий сайт, 'bang' — бэнг из хранилища, 'engine' — поисковик по умолчанию.
  id: string;
  name: string;
  kind: 'site' | 'bang' | 'engine';
  // Шаблон с {query} (тот же формат, что у бэнгов). Едет в поповер и возвращается обратно —
  // main обязан ПРОВЕРИТЬ его (isValidBangTemplate) перед навигацией, а не доверять на слово.
  template: string;
  // Favicon цели (FaviconService — только сам домен, с кэшем).
  faviconUrl?: string | null;
  // Ключ бэнга, если цель пришла из хранилища бэнгов. Показывается на чипе в развёрнутом
  // списке: без этого узнать, что цель вызывается набором «!wb», было неоткуда.
  bangKey?: string;
}

// Ответ на ввод в поповере быстрого поиска: находки в своих данных + разобранный бэнг.
// Бэнг разбирает main (BangStore видит и пользовательские, и встроенные, и импортированные) —
// второго парсера в поповере нет намеренно, см. shared/bangs.ts.
export interface QuickQueryResult {
  hits: QuickHit[];
  // Цель, названная бэнгом прямо в строке («!wb Xiaomi»). null — бэнга в строке нет.
  bangTarget: SearchTarget | null;
  // Строка без бэнга — то, что реально пойдёт в поиск.
  strippedQuery: string;
}

// Чем наполнять полосу целей быстрого поиска (Ctrl+E).
// 'auto' — контекстом: выученные сайты и свои бэнги, частые вперёд (см. SearchTargetStore).
// 'pinned' — строго набором, который человек закрепил сам.
// Текущий сайт и поисковик по умолчанию остаются в обоих режимах: первый — весь смысл фичи,
// второй — единственная цель, подходящая к любому запросу.
export interface SearchChipsConfig {
  mode: 'auto' | 'pinned';
  pinned: string[]; // id целей (bang:<ключ> / site:<хост>) в порядке закрепления
  // Цель, НА КОТОРОЙ поповер открывается: она стоит первой и уже выбрана, то есть Enter сразу
  // после набора уходит именно туда — без единого клика по полосе и без набора бэнга.
  // null — прежнее поведение: первым идёт сайт, на котором человек сейчас (а если цели для него
  // нет — поисковик по умолчанию). Кроме 'bang:'/'site:' допустимо 'engine' — поисковик.
  defaultId: string | null;
}

// Кандидат в цели — то, из чего выбирают в настройках. Список НЕ отдаётся целиком: источников
// вместе с импортированным набором DDG — тысячи, поэтому наружу он доступен только поиском
// (SEARCH_CHIPS_SEARCH) и точечным разрешением уже выбранных id (SEARCH_CHIPS_RESOLVE).
export interface SearchChipCandidate {
  id: string;
  name: string;
  kind: 'bang' | 'site';
  // Откуда взялся: свой бэнг, встроенный, выученный сайт или импортированный из DDG — UI это
  // показывает, иначе в общем списке не отличить «моё» от «наше».
  source: 'user' | 'builtin' | 'learned' | 'imported';
  // Домен цели — только под favicon в настройках (FaviconService), не для навигации.
  host: string;
  // Ключ бэнга, если он есть: та же цель зовётся «!wb» прямо из строки поиска.
  bangKey?: string;
}

// Находка в СВОИХ данных для того же поповера: открытая вкладка, история, закладка.
// Веб-поиск отвечает на «что об этом пишут», а это — на «где я это уже видел»; второе
// в браузере спрашивают не реже, а идти за ним приходилось в отдельную панель.
export interface QuickHit {
  kind: 'tab' | 'history' | 'bookmark';
  // Для 'tab' — id вкладки: её не открывают заново, на неё переключаются.
  tabId?: string;
  url: string;
  title: string;
  faviconUrl?: string | null;
}

export interface TabErrorState {
  type: 'load' | 'crash';
  code: number;   // errorCode из did-fail-load; 0 при краше
  url: string;    // URL, который не открылся — для показа и retry
  // Была ли сеть жива в момент ошибки (net.isOnline() в main). Один и тот же код приходит и
  // когда лежит сайт, и когда отвалился Wi-Fi, — а советовать в этих случаях надо разное.
  offline: boolean;
  // Сертификат сайта честно выписан УЦ Минцифры, просто этому домену мы его не доверяем (см.
  // CertificateTrust.ts). Отличается от любой другой ошибки сертификата тем, что у человека есть
  // осмысленный выход — разрешить конкретный сайт; всем остальным предлагать нечего.
  russianCa?: boolean;
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
  incognito: boolean;   // приватная вкладка (in-memory сессия, без истории) — для бейджа в UI
  // Вкладка прямо СЕЙЧАС воспроизводит звук. Нужно, чтобы было видно, откуда играет музыка:
  // с вертикальным сайдбаром и десятками вкладок иначе приходится обходить их по одной.
  // ⚠️ Это состояние момента, а не свойство вкладки: тишина между треками и пауза его снимают.
  // У спящих и псевдо-вкладок всегда false — там нет ни звука, ни самого WebContentsView.
  audible: boolean;
  // Звук вкладки выключен человеком. ⚠️ Отдельно от audible, а не «audible=false»: приглушённая
  // вкладка перестаёт считаться звучащей, и без своего признака значок исчез бы вместе с
  // единственным способом вернуть звук обратно.
  muted: boolean;
  // Вид содержимого вкладки — 'page' обычная страница (реальный WebContentsView), 'hub' —
  // единственный синглтон-хаб (isHub уже покрывает это, kind добавлен для полноты и симметрии
  // с history/settings). 'history'/'settings' — псевдо-вкладки без WebContentsView (view: null
  // в TabManager, тот же приём, что у хаба), обычные tabMap-записи: закрываемые, в нескольких
  // экземплярах, не участвуют в сессии/истории/усыплении (см. TabManager.createSpecialTab —
  // тот же путь #tabUrl()==='' → savable()===false / isHttpView(null)===false, что уже
  // естественно исключает их из session snapshot и sleep-таймера, без отдельных правок там).
  kind: 'page' | 'hub' | 'history' | 'settings' | 'bookmarks' | 'downloads';
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
  hasRenameSnapshot: boolean;   // true = доступен откат последнего массового переименования
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
  TAB_ENTER_SPLIT:  'tab:enter-split',  // renderer → main: войти в split (правая вкладка)
  TAB_EXIT_SPLIT:   'tab:exit-split',   // renderer → main: выйти из split, обе вкладки остаются
  TAB_SPLIT_FOCUS:  'tab:split-focus',  // renderer → main: переключить фокус на панель
  TAB_SPLIT_RATIO:  'tab:split-ratio',  // renderer → main: новое соотношение панелей при drag
  TAB_SPLIT_SWAP:   'tab:split-swap',   // renderer → main: поменять половины пары местами (ширины слотов остаются)
  SPLIT_SWAP_HINT:  'split:swap-hint',  // renderer → main: подсветить панель-цель, пока половину тащат за шапку

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
  CLIPBOARD_PUT:      'clipboard:put',         // поповер → main: положить запись в буфер обмена ОС
  CLIPBOARD_OPEN_SOURCE: 'clipboard:open-source', // поповер → main: открыть страницу-источник и подсветить фрагмент
  CLIPBOARD_REMOVE:   'clipboard:remove',      // поповер → main: убрать одну запись
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

  // Автозаполнение форм — сигналы между гостевой страницей и TabManager (per-view webContents.ipc,
  // как у паролей). url НИКОГДА не из payload — main берёт wc.getURL(). Адреса/карты не привязаны к
  // origin (в отличие от паролей), url нужен лишь чтобы отсечь служебные схемы.
  AUTOFILL_FIELD_FOCUS: 'autofill:field-focus', // гостевая страница → TabManager: { rect, kind: 'address'|'card' }
  AUTOFILL_FILL_FIELDS: 'autofill:fill-fields', // TabManager → гостевая вкладка: карта значений полей для подстановки
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

  // Поповер загрузок у одноимённой кнопки тулбара — та же техника, что VPN_POPOVER_* выше
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

// «Итоги дня» (electron/DayDigest.ts). 'empty' с причиной, а не пустой список: виджету нужно
// сказать человеку разное — «сегодня ещё нечего обобщать» и «итог просто не собирали».
export interface DayDigestData {
  date: string;      // YYYY-MM-DD
  lines: string[];
  builtAt: number;
  visits: number;
}
export type DayDigestState =
  | { state: 'ready'; digest: DayDigestData }
  | { state: 'empty'; reason: 'no-history' | 'not-built' };

// ── Закладки ─────────────────────────────────────────────────────────────────
// ⚠️ Папка и ссылка — ОДНА таблица и один тип, различаются полем kind. Отличать их «по пустому
// url» нельзя: пустая строка — такое же значение, как любое другое, и две папки немедленно
// столкнулись бы в индексе уникальности адресов (подробности — в electron/bookmarksSchema.ts).
export type BookmarkKind = 'link' | 'folder';

export interface BookmarkEntry {
  id: number;
  kind: BookmarkKind;
  url: string;        // у папки всегда '' — адреса у неё нет
  title: string;
  parentId: number | null;  // null — корень
  position: number;         // порядок внутри своего родителя
  createdAt: number;  // Unix ms
}

// Предложение умной раскладки — ОДНА папка и закладки, которые модель хочет в неё положить.
// ⚠️ Это именно предложение: ничего не применяется, пока человек не согласится. Папка «Мусор»
// среди них — обычная папка с обычным названием, никакой особой сущности в системе для неё нет;
// удаляется она тем же способом, что любая другая.
export interface BookmarkFolderProposal {
  label: string;
  ids: number[];
}

// Узел дерева (BookmarkManager.listTree). children есть ТОЛЬКО у папок — по нему же в UI и
// отличается разворачиваемый узел от конечного, без повторной проверки kind.
export interface BookmarkNode extends BookmarkEntry {
  children?: BookmarkNode[];
}

// Дерево для импорта из другого браузера — as is, каким его отдал источник. id папок здесь нет
// вовсе: они узнаются только в момент вставки, поэтому родитель передаётся вложенностью, а не
// ссылкой (см. BookmarkManager.bulkInsertTree).
export interface ImportBookmarkNode {
  kind: BookmarkKind;
  title: string;
  url?: string;        // только у ссылок
  createdAt?: number;
  children?: ImportBookmarkNode[];
}

// Вход для BookmarkManager.bulkInsert — импорт из других браузеров. Элементы обязаны идти
// родитель-перед-детьми: вызывающая сторона формирует такой порядок обходом дерева источника.
export interface BulkBookmarkInput {
  parentId: number | null;
  kind?: BookmarkKind;  // по умолчанию 'link' — папки появились позже импорта
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
  // Окно, в котором живёт вкладка, — ТОЛЬКО когда это НЕ окно-отправитель (смысловой поиск ищет
  // по всем окнам, см. SmartTabHit). Пусто — вкладка своя, переключаемся обычным TAB_ACTIVATE.
  windowId?: number;
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
  // Файла по savePath на диске уже нет (человек его удалил или перенёс между запусками).
  // Появилось вместе с хранением списка на диске: без этого «Открыть» на записи месячной
  // давности молча ничего не делало бы. Проверяется при чтении файла со списком, не на каждый кадр.
  fileMissing?: boolean;
}

// Имя файла по содержимому (см. electron/DownloadNamer.ts). Ошибка приезжает СТРОКОЙ для показа
// человеку: причин отказа много (скан без текста, файл занят, модели нет), и «просто не сработало»
// на действии, которое он нажал сам, было бы враньём.
export interface DownloadNameSuggestion {
  ok: boolean;
  name?: string;   // предложенное имя ЦЕЛИКОМ, с исходным расширением
  error?: string;
}

export interface DownloadRenameResult {
  ok: boolean;
  filename?: string; // имя, которое реально легло на диск (могло развестись из-за дубля)
  error?: string;
}

// Находка смыслового поиска вкладки (см. electron/TabSearch.ts).
//
// ⚠️ Отдаём НЕ голый id, как раньше, а описание вкладки вместе с окном. Причина: поиск теперь
// идёт по вкладкам ВСЕХ окон, а у окна-спрашивающего нет ни заголовка, ни адреса чужой вкладки —
// показать находку ему было бы нечем. Плюс `otherWindow` считает MAIN относительно отправителя:
// «в другом окне» — это факт про спрашивающего, а не про вкладку, и renderer его знать не обязан.
export interface SmartTabHit {
  tabId: string;
  windowId: number;
  title: string;
  url: string;
  otherWindow: boolean;
}

// Одна разобранная часть адреса (см. shared/addressParts.ts). Наружу отдаём и ключ поля, и
// подпись: ключ нужен форме настроек, чтобы разложить части по своим полям.
export interface ParsedAddressPart {
  key: string;
  label: string;
  value: string;
}

// Что изменилось на странице с прошлого визита (см. electron/PageChanges.ts).
export interface PageChangePiece { before: string; after: string }
export interface PageChangesResult {
  changed: boolean;
  summary?: string;                 // фраза от модели; пусто — показываем сам факт и куски
  pieces?: PageChangePiece[];
}

// Находка объединённого поиска по своим данным (см. electron/StuffSearch.ts).
// ⚠️ У загрузки в url лежит ПУТЬ НА ДИСКЕ, а не адрес: открывается она файлом, а не навигацией.
export interface StuffHit {
  kind: 'history' | 'bookmark' | 'download';
  title: string;
  url: string;
  subtitle: string;
  snippet?: string;
  // Только у загрузки: открываем её штатным DOWNLOAD_OPEN_FILE, а не своим путём — там уже есть
  // перепроверка «файл ещё на месте» в момент клика (см. DownloadManager.#stillOnDisk).
  downloadId?: string;
}

// Товар на активной вкладке — для индикатора в тулбаре. null означает «страница не товарная»,
// и это самое частое состояние.
export interface ProductState {
  title: string;
  price: number;
  currency: string;
  availability: string;
  tracked: boolean;
}

// Одна запись буфера: что скопировано, откуда и когда.
// Чем кончился переход к источнику скопированного (см. TabManager.revealCopiedText):
// 'highlighted' — страница открыта и фрагмент подсвечен, 'opened' — открыта, но фрагмента там уже
// нет (страницу переписали), 'no-source' — адрес записи не годится для перехода.
export type ClipboardRevealResult = 'highlighted' | 'opened' | 'no-source';

export interface ClipboardEntry {
  id: number;
  text: string;
  url: string;
  host: string;
  title: string;
  at: number;
}

// Предложение склеить два предложения одного товара. ⚠️ Только предложение: пока человек не
// подтвердил, ничего не объединено (см. shared/productMatch.ts).
export interface MatchSuggestion {
  aId: number;
  bId: number;
  aTitle: string;
  bTitle: string;
  aHost: string;
  bHost: string;
}

// Событие отслеживания: подешевело, подорожало, кончилось, вернулось, заканчивается.
export interface TrackingEvent {
  id: number;
  kind: string;
  text: string;
  at: number;
  title: string;
  url: string;
}

export interface TrackedPricePoint {
  price: number;
  availability: string;
  seenAt: number;
}

export interface TrackedProduct {
  id: number;
  url: string;
  host: string;
  title: string;
  brand: string;
  currency: string;
  createdAt: number;
  // Когда в последний раз ходили проверять и вышло ли. ⚠️ Неудача хранится и показывается: иначе
  // последняя известная цена выглядела бы свежей, а решение о покупке принималось бы по данным
  // непонятной давности.
  lastCheckedAt: number;
  lastCheckOk: number;
  /** Одна группа = один товар в разных магазинах. 0 — сам по себе. */
  groupId: number;
  points: TrackedPricePoint[];
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
// 'graph' — граф-воркспейс (src/components/GraphCanvas.tsx). Пока живёт рядом с блокнотом:
// по плану граф его поглотит (Источники и Студия станут типами узлов), но миграция
// сохранённых источников — отдельный, более рискованный заход.
export type HubMode = 'tiles' | 'ai' | 'graph';

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

// Сохранённое решение по сайту — то, что показывает и правит раздел настроек «Разрешения».
// ⚠️ Отсутствие записи и запрет — РАЗНЫЕ вещи: нет записи означает «спросим», а не «нельзя».
// Поэтому «Забыть» и «Запретить» — две отдельные операции, а не одна.
export interface PermissionRecord {
  origin: string;
  permission: PermKey;
  decision: 'granted' | 'denied';
  updatedAt: number;
}

// ── AI-действия над выделением (перевод / пересказ / объяснение / выжимка) ───
// Общая труба: выделение → координаты → Qwen (промпт зависит от action) → поповер → стриминг.
// Добавить новое действие = добавить пункт меню (TabManager.ts) + промпт (TranslationService.ts) —
// без нового поповер-кода, см. AiActionOutcome ниже (один контракт результата на все действия).

// ⚠️ Последние три — действия НАД СВОИМ ТЕКСТОМ в поле ввода, а не над чужой страницей. Разница
// не косметическая: их результат человек вставляет обратно в форму (см. canReplace в поповере),
// поэтому модель обязана вернуть ТОЛЬКО текст, без «Вот исправленный вариант:» — маленькая модель
// это правило нарушает, и ответ дочищается кодом (тот же приём, что в TabRenamer.ts).
// Почему это уместно локальной модели: правка своего черновика — короткий вход, короткий выход,
// один шаг; и главное, недописанное письмо не уезжает в чужое облако.
export type AiAction = 'translate' | 'summarize' | 'simplify' | 'explain' | 'fix' | 'shorten' | 'polite';

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
// ── Бэнги омнибокса (electron/BangStore.ts) ───────────────────────────────────

// Три источника разом, чтобы UI мог показать их раздельно: встроенные удалить нельзя,
// пользовательские правятся, импортированные существуют только числом (список на ~13 000
// записей в renderer не отдаём — незачем гонять его через IPC).
export interface BangsSnapshot {
  user: BangDefWire[];
  builtin: BangDefWire[];
  importedCount: number;
}

// Тот же BangDef, что в shared/bangs.ts, — продублирован здесь как «форма на проводе», чтобы
// contract-файл не зависел от модуля с данными (в остальном контракте так же).
export interface BangDefWire {
  key: string;
  name: string;
  template: string;
  home?: string;
}

export interface ImportBangsResult {
  ok: boolean;
  imported: number;
  error: string | null;
}

// Заготовка бэнга, распознанная по адресу открытой вкладки (см. deriveBangFromUrl).
// tabTitle/tabUrl — чтобы пользователь понял, из какой именно вкладки взята заготовка.
export interface DerivedBangCandidate {
  key: string;
  name: string;
  template: string;
  param: string;
  tabTitle: string;
  tabUrl: string;
}

// ── Автообновление (electron/UpdateManager.ts) ────────────────────────────────

// 'disabled' — не ошибка, а штатное состояние: electron-updater работает только с установленным
// приложением, в dev-режиме (npm run dev / npm start) он физически неприменим. UI в этом случае
// честно пишет «доступно только в установленной версии», а не притворяется, что всё в порядке.
export type UpdateStatusKind =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'      // нашли версию новее — ждём решения пользователя, сами НЕ качаем
  | 'downloading'
  | 'downloaded'     // скачано, ждём согласия перезапуститься
  | 'error';

export interface UpdateStatus {
  kind: UpdateStatusKind;
  currentVersion: string;
  // Версия, доступная к установке. Не null только при available/downloading/downloaded.
  newVersion: string | null;
  // Прогресс загрузки, 0..100. Осмыслен только при downloading.
  percent: number;
  // Причина отказа для показа пользователю. Не null только при error.
  error: string | null;
  // Момент последней УСПЕШНОЙ проверки (Date.now()), чтобы UI мог написать «проверено тогда-то».
  // null — успешных проверок в этой установке ещё не было.
  lastCheckedAt: number | null;
}

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
// ⚠️ Ролей ровно две, и это решение, а не упрощение. Прежние три (light/recommended/heavy)
// строили «окно» вокруг самой крупной влезающей модели и показывали в том числе то, что на этом
// железе работать не будет (27B на карте с 8 ГБ), — человек скачивал гигабайты и получал
// неработающее. Теперь предлагается минимум выбора и только то, что реально поедет:
//  • 'recommended' — с неё начинать: самая лёгкая модель, качество которой ИЗМЕРЕНО стендом;
//  • 'stronger'    — заметно тяжелее, берут ради связного текста, и только если влезает с запасом.
// Всё остальное роли не получает и в интерфейсе не показывается вовсе.
export type ModelRole = 'recommended' | 'stronger';

export interface CatalogEntry {
  model: CatalogModel;
  fit: ModelFit;
  role: ModelRole | null; // null = не предлагаем на этом железе (в интерфейс не попадает)
  visibleByDefault: boolean;
  // Чем эта модель отличается ДЛЯ ЧЕЛОВЕКА — одной строкой, из наших же замеров (см. ai-bench).
  // Живёт в каталоге, а не в UI: числа и выводы получены рядом с моделью, и расходиться им нельзя.
  summary: string;
  // Сколько видеопамяти реально нужно — ВМЕСТЕ с резервом под систему и запасом самого движка.
  // ⚠️ Считается в ModelCatalog.ts, где эти резервы и живут, а не в интерфейсе: без них выходит
  // заниженное число (у 9B — «6 ГБ» вместо честных 7), и человек с картой на 6 ГБ скачивает
  // модель, которая у него не поедет.
  minVramBytes: number;
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

// Погода для виджета новой вкладки (electron/WeatherService.ts, Open-Meteo). tempC — цельсии,
// weatherCode — WMO. Конвертация в °F и иконка/подпись — на стороне рендера.
export interface NextHolidayInfo {
  ok: boolean;
  name?: string;
  date?: string;
  daysUntil?: number;
  error?: string;
}

export interface WeatherInfo {
  /** Ощущается как — Apple показывает её первой строкой под температурой. */
  feelsC?: number
  /** День или ночь по данным станции: от этого зависит цвет плитки виджета. */
  isDay?: boolean
  maxC?: number
  minC?: number
  /** Ближайшие часы, начиная с текущего. */
  hours?: { hour: number; tempC: number; code: number }[]
  ok: boolean;
  city?: string;
  tempC?: number;
  weatherCode?: number;
  windKmh?: number;
  /** Восход и закат «ЧЧ:ММ» — приходят тем же запросом прогноза, отдельного вызова не требуют. */
  sunrise?: string;
  sunset?: string;
  /** Европейский индекс качества воздуха. Тот же Open-Meteo — нового получателя данных нет. */
  aqi?: number;
  error?: string;
}

// Курсы валют для виджета новой вкладки (electron/CurrencyRates.ts, суточные курсы ЦБ РФ).
// rates — «сколько рублей стоит ОДНА единица валюты» (RUB=1, номинал уже приведён к единице).
// Тот же тип, что отдаёт конвертер AI-панели, но здесь он в общем контракте: виджет вкладки
// живёт в боевом рендерере и ходит типизированным каналом, а не ad-hoc `ai-panel:*`.
export interface CurrencyRatesInfo {
  /** Курс предыдущего рабочего дня — для стрелки «вырос/упал» в виджете. */
  prev?: Record<string, number>;
  ok: boolean;
  date?: string;
  rates?: Record<string, number>;
  error?: string;
}

export interface CryptoRatesInfo {
  ok: boolean;
  /** «Сколько RUB стоит единица актива», ключ — тикер (BTC, ETH…). */
  rates?: Record<string, number>;
  /** Изменение за 24 часа в процентах — для стрелки в виджете. */
  change24h?: Record<string, number>;
  error?: string;
}

// ── Тема оформления ─────────────────────────────────────────────────────────
// 'system' — следовать ОС. Считает это main через nativeTheme.shouldUseDarkColors и присылает
// готовый systemDark: рендерер мог бы спросить matchMedia сам, но тогда у каждого окна и каждого
// поповера была бы своя точка правды, а расходиться им нельзя.
export type ThemeMode = 'light' | 'dark' | 'system';

// Нейтральные палитры — это ЗЕМЛЯ интерфейса (фон, поверхности, разделители, текст), а не
// перекраска акцента: цветовой закон не меняется, акцент по-прежнему один, зелёный по-прежнему
// значит «локально/VPN жив». У каждой палитры есть и светлый, и тёмный вариант — палитра
// отвечает на вопрос «какой оттенок нейтрали», тема на вопрос «светло или темно».
export const THEME_PALETTE_IDS = ['charcoal', 'graphite', 'slate', 'paper'] as const;
export type ThemePaletteId = typeof THEME_PALETTE_IDS[number];

export interface ThemePrefs {
  mode: ThemeMode;
  palette: ThemePaletteId;
  /** Что сейчас говорит ОС. Осмысленно только при mode==='system', но приходит всегда. */
  systemDark: boolean;
}

/** Темно ли сейчас на самом деле. Общая для main, чрома и настроек — три копии одного тернарника
 *  разошлись бы ровно в тот день, когда к режимам добавится четвёртый. */
export function isDarkTheme(p: ThemePrefs): boolean {
  return p.mode === 'system' ? p.systemDark : p.mode === 'dark';
}

// Тип API, который preload пробрасывает в window.oblako
// Роль окна. Полное окно ровно одно: оно владеет сессией (деревом вкладок в session.json) и теми
// службами, что существуют в приложении в одном экземпляре. Лёгкие окна — вкладки, омнибокс,
// поиск по странице, пароли/автозаполнение.
export type WindowRole = 'main' | 'light';

// Чем закончилась просьба «сделай нас браузером по умолчанию»: 'already' — уже мы,
// 'settings-opened' — открыт системный выбор и слово за человеком, 'unsupported' — просить
// негде (не Windows или неупакованная сборка). См. electron/DefaultBrowser.ts.
export type DefaultBrowserRequest = 'already' | 'settings-opened' | 'unsupported';

// Куда попадёт вкладка, если отпустить её сейчас: край страницы — разделить экран, середина —
// новое окно, 'adopt' — курсор над ДРУГИМ окном Oblako, вкладка переедет туда, null — обычное
// переупорядочивание в сайдбаре. Считает MAIN (см. electron/DropZoneManager.ts): чром теряет
// указатель, как только тот уходит на страницу.
export type TabDropZone = 'split' | 'window' | 'adopt';

// Результат отпускания. windowId нужен только для 'adopt' — какое именно окно принимает вкладку;
// одной зоны мало, окон может быть сколько угодно.
export interface TabDropResult {
  zone: TabDropZone | null;
  windowId?: number;
}

// Подсветка панели-ЦЕЛИ, пока половину сплита тащат за её шапку (жест живёт в рабочей области,
// см. src/App.tsx). Рисует её вью-оверлей поверх страницы (electron/DropZoneManager.ts): чром над
// областью контента не виден в принципе — нативная вью страницы лежит поверх React-слоя.
//
// ⚠️ Зону тут, в отличие от TabDropZone, считает RENDERER, а не main. Разница не в прихоти:
// перетаскивание за шапку держит указатель через setPointerCapture, и pointermove приходит в чром
// даже над нативными вьюхами (см. разделитель сплита в App.tsx) — опрашивать курсор в main незачем.
// Наружу, в main, уходит только то, что чром нарисовать физически не может: подсветка.
export interface SplitSwapHint {
  // Прямоугольник панели-цели в координатах ОБЛАСТИ КОНТЕНТА (её же меряет setContentBounds) —
  // оверлей накрыт ровно ею, поэтому пересчёт не нужен ни на той, ни на этой стороне.
  rect: ContentBounds;
  // Курсор над этой панелью: исход «поменять местами» состоится, если отпустить сейчас.
  active: boolean;
}

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
  createSpecialTab(kind: 'history' | 'settings' | 'bookmarks' | 'downloads', section?: string): Promise<string>;
  closeTab(id: string): Promise<void>;
  activateTab(id: string): Promise<void>;
  /** Вкладки, подходящие запросу по смыслу (локальная модель). Пусто — не нашлось или модели нет. */
  searchTabsSmart(query: string): Promise<SmartTabHit[]>;
  /** Перейти к вкладке в ДРУГОМ окне: поднять то окно и сделать вкладку активной в нём. */
  activateTabInWindow(windowId: number, tabId: string): Promise<void>;
  /** Разобрать адрес, вставленный строкой в настройках. Пусто — не разобралось (см. AddressParser). */
  parseAddressText(text: string): Promise<ParsedAddressPart[]>;
  /** Поиск по истории, закладкам и загрузкам сразу. degraded — модель не участвовала. */
  searchStuff(query: string): Promise<{ hits: StuffHit[]; degraded: boolean }>;
  /** Товар на активной вкладке (индикатор в тулбаре) — null, если страница не товарная. */
  onProductState(cb: (state: ProductState | null) => void): () => void;
  /** Меню у индикатора товара — нативное, как у звезды закладки. */
  showProductMenu(): Promise<void>;
  listTracked(): Promise<TrackedProduct[]>;
  untrackProduct(id: number): Promise<void>;
  /** Проверить все отслеживаемые товары сейчас (кнопка). Возвращает, сколько удалось. */
  checkTrackedNow(): Promise<{ ok: number; total: number }>;
  listTrackingEvents(): Promise<TrackingEvent[]>;
  getTrackingNotify(): Promise<boolean>;
  setTrackingNotify(on: boolean): Promise<void>;
  listTrackingSuggestions(): Promise<MatchSuggestion[]>;
  mergeTracked(aId: number, bId: number): Promise<void>;
  dismissTrackedMerge(aId: number, bId: number): Promise<void>;
  ungroupTracked(id: number): Promise<void>;
  /** Сколько записей в буфере — для индикатора в тулбаре (0 означает «кнопки нет»). */
  onClipboardChanged(cb: (count: number) => void): () => void;
  toggleClipboardPopover(): Promise<void>;
  syncClipboardPopoverBounds(b: ContentBounds): void;
  onClipboardPopoverClosed(cb: () => void): () => void;
  onTrackingChanged(cb: () => void): () => void;
  /** Поиск по настройкам фразой — второй эшелон, отдаёт индексы SETTINGS_INDEX (settingsIndex.ts). */
  searchSettingsSmart(query: string): Promise<number[]>;
  /** Страницы из своей истории, связанные с открытой сейчас. Пусто — нечего показать. */
  getRelatedPages(): Promise<SemanticSearchResult[]>;
  /** Готовые «итоги дня» (ничего не считает). */
  getDayDigest(): Promise<DayDigestState>;
  /** Собрать «итоги дня» сейчас — явное действие человека, может занять до полуминуты. */
  buildDayDigest(): Promise<DayDigestState>;
  navigate(id: string, input: string): Promise<void>;
  goBack(id: string): Promise<void>;
  goForward(id: string): Promise<void>;
  reload(id: string): Promise<void>;
  setContentBounds(bounds: ContentBounds): Promise<void>;
  // Прямоугольник омнибокса — see IPC.OMNIBOX_SET_BOUNDS. Пока только сохраняется в main,
  // без вью-потребителя (см. shared/ipc.ts::IPC).
  setOmniboxBounds(bounds: ContentBounds): Promise<void>;
  setTitleBarOverlay(opts: TitleBarOpts): Promise<void>;
  // Роль ЭТОГО окна — см. WindowRole. Полное окно рисует всё; лёгкое прячет то, что живёт в
  // приложении в одном экземпляре и принадлежит полному (AI-панель, быстрый поиск, перевод
  // страницы, граф/блокнот на новой вкладке).
  getWindowRole(): Promise<WindowRole>;
  openWindow(): Promise<void>;
  // Перенести вкладку в новое окно (ПКМ по вкладке, вытаскивание из сайдбара).
  moveTabToNewWindow(tabId: string): Promise<boolean>;
  // Вернуть вкладку в уже открытое окно — обратный жест к moveTabToNewWindow.
  moveTabToWindow(tabId: string, windowId: number): Promise<boolean>;
  // Перетаскивание вкладки в сайдбаре — см. IPC.TAB_DRAG_START/TAB_DRAG_END.
  tabDragStart(): Promise<void>;
  tabDragEnd(): Promise<TabDropResult>;
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
  setTabMuted(id: string, muted: boolean): Promise<void>; // выключить/включить звук вкладки
  showTabMenu(id: string): Promise<void>;
  showNewTabMenu(): Promise<void>; // ПКМ по кнопке «Новая вкладка»: обычная / инкогнито / восстановить
  setChromeTheme(dark: boolean, incognito: boolean, palette: ThemePaletteId): Promise<void>; // раздать тему во все chrome-вью (поповеры)

  // Тема оформления (см. ThemePrefs). setTheme пишет выбор на диск и рассылает его во все окна —
  // применяет тему по-прежнему сам рендерер, у себя на documentElement.
  getTheme(): Promise<ThemePrefs>;
  setTheme(mode: ThemeMode, palette: ThemePaletteId): Promise<void>;
  onThemeChanged(cb: (prefs: ThemePrefs) => void): () => void;

  getWeather(city: string): Promise<WeatherInfo>; // погода для виджета новой вкладки
  getCurrencyRates(): Promise<CurrencyRatesInfo>;
  /** Ближайший госпраздник. Новый получатель данных (date.nager.at), наружу уходит только код страны. */
  getNextHoliday(country?: string): Promise<NextHolidayInfo>; // курсы ЦБ РФ для виджета новой вкладки
  getCryptoRates(): Promise<CryptoRatesInfo>;     // курсы криптовалют для виджета «Крипта»
  getNewtabPhoto(): Promise<{ ok: boolean; dataUrl?: string }>; // «фото дня» для фона новой вкладки
  extractNotebookUrl(url: string): Promise<{ ok: boolean; title?: string; text?: string }>; // текст URL-источника блокнота
  generateStudio(kind: string, context: string): Promise<{ ok: boolean; text?: string; error?: string }>; // материал Студии блокнота

  // Split View
  enterSplit(rightId: string): Promise<void>;       // текущая активная → левая, rightId → правая
  // keepId — какая панель НАЙДЕННОЙ пары остаётся активной (по умолчанию текущая активная).
  // Нужен жесту «вытащить половину в список»: активной обязана остаться та, которую НЕ тащили.
  exitSplit(tabId: string, keepId?: string): Promise<void>; // схлопнуть пару, содержащую tabId; обе вкладки остаются
  focusSplitPanel(side: 'left' | 'right'): Promise<void>; // переключить активную панель
  setSplitRatio(ratio: number): Promise<void>;      // drag разделителя: 0.2..0.8
  swapSplitPanels(tabId: string): Promise<void>;    // половины пары меняются местами; ширины слотов не меняются
  // Подсветка панели-цели во время перетаскивания половины за шапку; null — убрать оверлей.
  setSplitSwapHint(hint: SplitSwapHint | null): Promise<void>;

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
  // Разрешения сайтов (раздел настроек). revokePermission без key забывает ВСЁ по сайту.
  listPermissions(): Promise<PermissionRecord[]>;
  setPermission(origin: string, key: PermKey, decision: 'granted' | 'denied'): Promise<void>;
  revokePermission(origin: string, key?: PermKey): Promise<void>;
  // Путь файла, брошенного в интерфейс браузера. ⚠️ Не канал в main, а функция самого preload:
  // `File.path` из Electron убран, а `webUtils.getPathForFile` обязан зваться там, где живёт File.
  // Синхронная — единственная такая во всём API, поэтому и оговорка.
  droppedFilePath(file: File): string | null;
  // Сайты, которым человек сам разрешил корень Минцифры (см. electron/CertTrustStore.ts) — соседи
  // разрешений по разделу настроек и по смыслу. Вшитый список банков сюда не входит: он не
  // отзывается и в интерфейсе не показывается. Добавления снаружи нет — только отзыв, см. IPC.
  listCertTrust(): Promise<Array<{ domain: string; addedAt: number }>>;
  removeCertTrust(domain: string): Promise<boolean>;

  listBookmarks(): Promise<BookmarkEntry[]>;
  // Дерево целиком — режим «Закладки» в сайдбаре рисует его сам, поэтому уровни не догружает.
  listBookmarkTree(): Promise<BookmarkNode[]>;
  // Звезда в омнибоксе и Ctrl+D: сохранить активную страницу и предложить папку. Адрес и
  // заголовок берёт сам main — у него активная вкладка под рукой, а рендереру пришлось бы их
  // передавать и рисковать разъехаться с реальной страницей.
  showBookmarkMenu(): Promise<void>;
  createBookmarkFolder(title: string, parentId: number | null): Promise<BookmarkEntry | null>;
  renameBookmark(id: number, title: string): Promise<boolean>;
  // Перенос в другого родителя, в конец уровня. Порядок внутри уровня — отдельно, reorderBookmarks.
  moveBookmark(id: number, parentId: number | null): Promise<boolean>;
  reorderBookmarks(parentId: number | null, orderedIds: number[]): Promise<boolean>;
  // Только считает. Пустой массив — законный исход: осмысленных папок не нашлось.
  suggestBookmarkFolders(): Promise<BookmarkFolderProposal[]>;
  // Выполняет уже ОДОБРЕННОЕ человеком. Возвращает, сколько закладок реально разложено.
  applyBookmarkFolders(proposals: BookmarkFolderProposal[]): Promise<number>;
  isBookmarked(url: string): Promise<boolean>;
  onBookmarksChanged(cb: () => void): () => void;
  // Импорт из других браузеров (см. electron/bookmarkImport/) — пока только Chromium-семейство.
  listBookmarkImportSources(): Promise<BookmarkImportSource[]>;
  runBookmarkImport(sourceId: string): Promise<BookmarkImportResult | null>;

  // Общий мультитиповый импорт (закладки/история/пароли) — диалог импорта + онбординг первого
  // запуска (см. electron/browserImport/). Отдельно от bookmark-only каналов выше.
  listImportSources(): Promise<ImportSource[]>;
  runImport(sourceId: string, dataTypes: ImportDataType[]): Promise<ImportRunResult>;
  // «Навести порядок», вторая половина: имена вкладок по содержимому. Прогресс приходит
  // отдельным push'ем, сами имена — обычным SYNC_CHANGED по мере готовности.
  renameAllTabs(): Promise<void>;
  rollbackRenames(): Promise<void>;
  onRenameProgress(cb: (p: { done: number; total: number }) => void): () => void;

  // Экран первого запуска (см. ONBOARDING_SHOULD_SHOW): рассказ о браузере и перенос данных.
  shouldShowOnboarding(): Promise<boolean>;
  markOnboardingShown(): Promise<void>;

  // Открыть приложение панели (калькулятор, конвертер…) с рабочего стола новой вкладки.
  openPanelApp(appId: string): Promise<void>;
  /** Курс валюты за последние N дней (для графика в виджете). Пустой массив — данных нет. */
  getCurrencyHistory(code: string, days?: number): Promise<number[]>;
  /** То же для криптоактива по тикеру (BTC, ETH…). */
  getCryptoHistory(ticker: string, days?: number): Promise<number[]>;

  // Спрашивать ли, куда сохранять каждый файл.
  getAskDownloadLocation(): Promise<boolean>;
  setAskDownloadLocation(value: boolean): Promise<void>;

  // Браузер по умолчанию. requestDefaultBrowser открывает системный выбор и возвращает, что
  // именно произошло, — назначить себя молча Windows не даёт (см. electron/DefaultBrowser.ts).
  isDefaultBrowser(): Promise<boolean>;
  requestDefaultBrowser(): Promise<DefaultBrowserRequest>;

  // Индикатор качества индекса умного поиска — сколько страниц реально имеют извлечённый текст.
  getHistoryContentCoverage(): Promise<HistoryContentCoverage>;

  // Рискованный бэкфилл полного текста (electron/HistoryContentBackfill.ts) — тихое переоткрытие
  // старых URL. Тот же прогресс-контракт (BackfillProgress), но
  // отдельные каналы/методы — это независимый, гораздо более тяжёлый и рискованный процесс.
  startHistoryContentBackfill(): void;
  cancelHistoryContentBackfill(): void;
  getHistoryContentBackfillStatus(): Promise<BackfillProgress>;
  onHistoryContentBackfillProgress(cb: (p: BackfillProgress) => void): () => void;

  // Разрешений здесь нет: и вопрос, и ответ живут в собственной вью поповера
  // (electron/PermissionPopoverManager.ts + preload-permissionpopover.ts).

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

  // Правила-автоматизации. parseRule — единственный вызов с моделью (фраза → черновик),
  // остальное обычный CRUD: правило исполняется кодом, а не моделью.
  parseRule(phrase: string): Promise<RuleParseOutcome>;
  addRule(draft: AutomationRule): Promise<AutomationRule | null>;
  listRules(): Promise<AutomationRule[]>;
  setRuleEnabled(id: string, enabled: boolean): Promise<boolean>;
  removeRule(id: string): Promise<boolean>;
  onRulesChanged(cb: (rules: AutomationRule[]) => void): () => void;

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
  sendHubChatMessage(tabId: string, text: string, grounding: boolean, sourcesContext?: string): void;
  onHubChatChunk(cb: (payload: { tabId: string; text: string }) => void): () => void;
  onHubChatResult(cb: (payload: { tabId: string; sessionId: number; outcome: HubChatOutcome }) => void): () => void;
  listHubChatSessions(): Promise<HubChatSessionMeta[]>;
  getHubChatSession(sessionId: number): Promise<HubChatMessage[]>;
  newHubChatSession(tabId: string): Promise<void>;
  resumeHubChatSession(tabId: string, sessionId: number): Promise<HubChatMessage[]>;
  deleteHubChatSession(sessionId: number): Promise<void>;

  // Граф-воркспейс (electron/GraphStore.ts + GraphEngine.ts).
  // saveGraph шлёт ТОЛЬКО структуру: результаты узлов принадлежат движку, и холст не должен
  // их затирать своей — уже устаревшей — копией (см. шапку GraphStore.ts).
  // runGraph — fire-and-forget: ход прогона приезжает через onGraphProgress.
  listGraphs(): Promise<GraphMeta[]>;
  createGraph(title: string): Promise<GraphMeta | null>;
  getGraph(graphId: number): Promise<GraphDoc | null>;
  saveGraph(graphId: number, structure: GraphStructure): Promise<void>;
  renameGraph(graphId: number, title: string): Promise<void>;
  deleteGraph(graphId: number): Promise<void>;
  runGraph(graphId: number, nodeId: string | null): void;
  // Нативный диалог выбора документа. Путь возвращается в renderer только чтобы показать
  // имя файла и положить его в конфиг узла; читает файл всегда main (electron/FileExtract.ts).
  pickGraphFile(): Promise<string | null>;
  pickGraphImage(): Promise<string | null>;
  // Забрать сгенерированную картинку из открытого веб-чата: main сохраняет файл и отдаёт
  // путь, холст заводит по нему узел «Картинка».
  captureWebAppImage(graphId: number, nodeId: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  // Превью картинки узла: main читает файл с диска и отдаёт уменьшенный data-URL. Прямой
  // доступ к file:// у renderer закрыт, да и полноразмерный кадр в карточке ни к чему.
  graphImagePreview(path: string): Promise<string | null>;
  // Прошлые результаты узла (до пяти, свежие первыми) — для сравнения формулировок.
  listNodeHistory(graphId: number, nodeId: string): Promise<GraphNodeVersion[]>;

  // Узел-диалог: переписка живёт в main, наружу узел отдаёт последний ответ модели.
  listGraphChat(graphId: number, nodeId: string): Promise<GraphChatMessage[]>;
  sendGraphChat(graphId: number, nodeId: string, text: string): void;
  clearGraphChat(graphId: number, nodeId: string): Promise<void>;
  onGraphChatChunk(cb: (p: { graphId: number; nodeId: string; text: string }) => void): () => void;
  onGraphChatDone(
    cb: (p: { graphId: number; nodeId: string; ok: boolean; text?: string; error?: string }) => void,
  ): () => void;
  // Сохранение результата узла на диск. Диалог и запись — в main; renderer отдаёт только
  // текст и предлагаемое имя.
  saveGraphOutput(suggestedName: string, text: string): Promise<boolean>;
  // Пресеты генератора промптов для картинок. Встроенные лежат в shared/imagePresets.ts и
  // через IPC не ездят — сюда приходят только пользовательские.
  listImagePresets(): Promise<ImagePreset[]>;
  saveImagePreset(preset: ImagePreset): Promise<void>;
  deleteImagePreset(id: string): Promise<void>;
  cancelGraphRun(graphId: number): Promise<void>;
  onGraphProgress(cb: (p: GraphProgress) => void): () => void;
  // Граф пополнился снаружи — открытый холст должен перечитать его.
  onGraphChanged(cb: (graphId: number) => void): () => void;

  // Узел-веб-приложение. Промпт для вставки собирает main из сохранённого графа (renderer
  // его не считает — иначе состояние разъехалось бы), пойманный ответ main же и пишет в
  // результат узла с правильным отпечатком входов.
  showGraphWebApp(graphId: number, nodeId: string, url: string, bounds: ContentBounds): Promise<void>;
  setGraphWebAppBounds(graphId: number, nodeId: string, bounds: ContentBounds): Promise<void>;
  raiseGraphWebApp(graphId: number, nodeId: string): Promise<void>;
  closeGraphWebApp(graphId: number, nodeId: string): Promise<void>;
  insertGraphWebAppPrompt(graphId: number, nodeId: string): Promise<boolean>;
  captureGraphWebAppAnswer(graphId: number, nodeId: string, mode: 'selection' | 'last'): Promise<string>;

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

  // Поповер загрузок (см. IPC.DOWNLOADS_POPOVER_*, electron/DownloadsPopoverManager.ts) —
  // как и у VPN, здесь только геометрия анкора и открытие/закрытие: список карточка берёт сама.
  setDownloadsPopoverAnchorBounds(bounds: ContentBounds): Promise<void>;
  showDownloadsPopover(): Promise<void>;
  closeDownloadsPopover(): Promise<void>;
  onDownloadsPopoverClosed(cb: () => void): () => void;

  // Main просит открыть поповер загрузок с вопросом «этот файл уже скачан»: позиция значка
  // известна только хрому, поэтому открывает он — обычным путём, как по клику.
  onDownloadDuplicateAsk(cb: () => void): () => void;

  // Поповер сведений о сайте у замочка в омнибоксе (см. electron/SitePopoverManager.ts).
  // toggle возвращает новое состояние — второго канала «открыт ли» не заводим.
  setSitePopoverAnchorBounds(bounds: ContentBounds): Promise<void>;
  toggleSitePopover(): Promise<boolean>;
  onSitePopoverClosed(cb: () => void): () => void;

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

  // Вернуть OS-фокус вебконтентам чрома (см. CHROME_FOCUS). Какой DOM-элемент внутри был
  // активен — renderer помнит сам, довозвращать вручную не нужно.
  focusChrome(): void;

  // Бэнги омнибокса (см. electron/BangStore.ts). upsertBang возвращает причину отказа строкой
  // или null при успехе — это ответ на пользовательский ввод, а не исключение.
  listBangs(): Promise<BangsSnapshot>;
  upsertBang(bang: BangDefWire): Promise<string | null>;
  removeBang(key: string): Promise<void>;
  // Заготовки бэнгов по адресам открытых вкладок — избавляет от ручного составления шаблона.
  deriveBangsFromTabs(): Promise<DerivedBangCandidate[]>;
  importDuckDuckGoBangs(): Promise<ImportBangsResult>;
  clearImportedBangs(): Promise<void>;

  // Полоса целей быстрого поиска (Ctrl+E)
  getSearchChips(): Promise<SearchChipsConfig>;
  setSearchChips(cfg: SearchChipsConfig): Promise<void>;
  // Поиск по целям (свои бэнги, выученные сайты, встроенные, импортированные из DDG). Пустая
  // строка — короткий список «что есть под рукой», импортированные в него не входят.
  searchSearchChipCandidates(query: string): Promise<SearchChipCandidate[]>;
  // Разрешение уже выбранных id в карточки — чтобы показать выбор, не листая тысячи целей.
  resolveSearchChipCandidates(ids: string[]): Promise<SearchChipCandidate[]>;

  // Автообновление (см. electron/UpdateManager.ts). checkForUpdate/downloadUpdate — команды без
  // ответа, результат приходит через onUpdateStatusChanged. installUpdate закрывает приложение.
  checkForUpdate(): void;
  downloadUpdate(): void;
  installUpdate(): void;
  getUpdateStatus(): Promise<UpdateStatus>;
  onUpdateStatusChanged(cb: (s: UpdateStatus) => void): () => void;
}
