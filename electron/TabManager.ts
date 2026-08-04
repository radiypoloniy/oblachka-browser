import { WebContentsView, BrowserWindow, Menu, clipboard, net } from 'electron';
import type { MenuItemConstructorOptions, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { IPC, INCOGNITO_PARTITION } from '../shared/ipc';
import type { TabState, TabErrorState, ContentBounds, FindResult, SidebarNode, SingleNode, SplitPairNode, GroupNode, AiAction } from '../shared/ipc';
import type { SessionSnapshot, SavedNode, SavedSingleNode, SavedSplitPairNode, SavedGroupNode, SavedActiveRef, SavedTab } from './SessionManager';
import { PIP_ENTER_SCRIPT, PIP_EXIT_SCRIPT } from './videoPip';
import { getSearchEngine, DEFAULT_SEARCH_ENGINE_ID } from '../shared/searchEngines';
import type { SearchEngineId } from '../shared/searchEngines';
import { parseBangCandidate, applyBangTemplate, bangHomeUrl } from '../shared/bangs';
import type { BangStore } from './BangStore';
import { ISLAND_GAP, SPLIT_HEADER_HEIGHT } from '../shared/layout';

const CLOSED_STACK_MAX = 10;

// Менеджер паролей, шаг 2 — ПЕРВЫЙ preload на гостевых страницах (сканер форм, см.
// electron/preload-content.ts). Тот же приём резолва пути, что AiPanelManager.ts использует
// для preload-aipanel.js (__dirname здесь и там — один и тот же dist-electron/electron после
// компиляции, см. electron/tsconfig.json).
const CONTENT_PRELOAD_PATH = path.join(__dirname, 'preload-content.js');

// Сколько ждём ответа Chromium на один findInPage смысловой цитаты (см. findQuoteInPage).
// Обход документа занимает миллисекунды; секунда — с запасом на тяжёлую страницу.
const FIND_QUOTE_TIMEOUT_MS = 1000;

const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 2.5;
const ZOOM_STEP = 0.1; // 10% за шаг, как в Chrome

// Радиус скругления углов контентной вью (px). Должен совпадать с --radius-island
// в src/styles/tokens/radii.css — то же скругление, что у сайдбара/панелей острова.
// setBorderRadius — чисто визуальный вырез; хит-тест углов остаётся прямоугольным
// (штатное поведение Electron View.setBorderRadius, не дефект — см. заход).
const CONTENT_CORNER_RADIUS = 20;
const SPLIT_RATIO_MIN = 0.2;
const SPLIT_RATIO_MAX = 0.8;

const SLEEP_TIMEOUT_NORMAL = 2 * 60 * 60 * 1000;  // 2 часа без активности
const SLEEP_TIMEOUT_PINNED = 8 * 60 * 60 * 1000;  // 8 часов для закреплённых
const SLEEP_CHECK_INTERVAL = 60_000;               // проверка раз в минуту

// Кап на размер тела favicon перед base64-кэшированием в сессию (заход C) — без него один
// «тяжёлый» сайт (нестандартный favicon.ico на сотни КБ) непредсказуемо раздувает session.json.
const FAVICON_CACHE_MAX_BYTES = 100 * 1024; // 100 КБ сырых байт (до base64, т.е. ~133 КБ в файле)

// «Краткая выжимка» имеет смысл только для достаточно длинного выделения (иначе выжимать нечего) —
// одно место, легко поменять. ~40 слов ~ 250 символов на кириллице/латинице.
const SUMMARIZE_MIN_CHARS = 250;

// Обрезает длинный текст для лейблов меню, чтобы не растягивало окно.
function truncate(text: string, max = 40): string {
  const s = text.trim().replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Фоллбэк-заголовок для вкладки, восстановленной сразу спящей (createSleepingTab) — session.json
// v4 хранит только url, настоящий title/favicon появятся после пробуждения (загрузки страницы).
function domainFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch { return url; }
}

// id вкладки-хаба фиксирован: это НЕ WebContentsView, а наш React-экран.
export const HUB_ID = 'hub';

// Метаданные, сохраняемые при усыплении вкладки.
interface SleepingMeta {
  url: string;
  title: string;
  faviconUrl: string | null;   // «живой» URL иконки (сеть) — фоллбэк, если данных ещё нет
  faviconData: string | null;  // закэшированные байты (data: URL) — приоритетны, работают офлайн
}

// Прямоугольник (селекшена или фоллбэк-точки клика) в координатах ОКНА — уже с добавленным
// оффсетом view.getBounds(), готов к использованию для позиционирования поповера в main.ts.
export interface SelectionRect { x: number; y: number; width: number; height: number }

// Элемент коллекции активных split-пар (см. TabManager#splitPairs).
interface SplitPair {
  leftId: string;
  rightId: string;
  activePanel: 'left' | 'right';
  splitRatio: number;
}

interface ManagedTab {
  id: string;
  view: WebContentsView | null; // null = хаб (sleeping===null) ИЛИ спящая (sleeping!==null) ИЛИ псевдо-вкладка (kind задан)
  sleeping: SleepingMeta | null;
  lastActiveAt: number; // Date.now() последней активности — для таймера сна
  // Короткоживущая вкладка (напр. OAuth-попап из window.open с фичами окна, disposition='new-window'):
  // не участвует в автосейве/восстановлении сессии — иначе при рестарте «воскреснет» мёртвая страница логина.
  ephemeral?: boolean;
  // Приватная (инкогнито) вкладка: своя in-memory сессия (partition INCOGNITO_PARTITION), не пишем
  // историю, исключена из автосейва, не усыпляется (иначе in-memory сессия потерялась бы).
  incognito?: boolean;
  // Псевдо-вкладка (История/Настройки, см. createSpecialTab) — обычная запись в tabMap/nodes
  // (не синглтон-хаб: свой id, закрываемая, можно открыть несколько), но БЕЗ WebContentsView —
  // переиспользован только сам приём хаба (view: null). #tabUrl() для такой вкладки вернёт ''
  // (см. ниже) → savable()===false и isHttpView(null)===false уже естественно исключают её из
  // сессии/сна без отдельных правок в SessionManager/sleep-таймере (см. диагностику, подтверждено
  // чтением кода: #serializeNodes фильтрует по savable(), sleep-таймер — по isHttpView).
  kind?: 'history' | 'settings' | 'bookmarks' | 'downloads';
  // Начальный раздел для kind==='settings' (см. createSpecialTab ниже) — необязателен, задаётся
  // только когда вызывающая сторона просит конкретный раздел (напр. кнопка "+" в AI-панели).
  section?: string;
  // Имя, придуманное моделью по содержимому страницы (см. electron/TabRenamer.ts). Пустое у
  // подавляющего большинства вкладок: переименование — явное действие человека, а не фон.
  // ⚠️ Сбрасывается при уходе на другой адрес: имя описывало ТУ страницу, и на новой оно врёт.
  aiTitle?: string;
}

// Вкладка, снятая с окна и ждущая нового владельца (см. detachTabForMove/adoptTab).
// Два случая, и оба нужны: живая страница переезжает вью (иначе потерялись бы история «назад»,
// прокрутка и введённое в форму), спящая — своим описанием, потому что вью у неё ещё нет и
// терять нечего. После перезапуска почти все вкладки спящие, и без второго случая пункт «Открыть
// в новом окне» был бы неактивен ровно тогда, когда им и хотят воспользоваться.
export type DetachedTab =
  | { kind: 'live'; view: WebContentsView; incognito: boolean }
  | { kind: 'sleeping'; sleeping: SleepingMeta; incognito: boolean };

// Скрипт проверки незаполненных форм — только top-frame (v1: поля внутри iframe не проверяются).
const HAS_FILLED_FORMS_SCRIPT = `(function(){
  var sel='input:not([type=checkbox]):not([type=radio]):not([type=hidden])' +
    ':not([type=submit]):not([type=button]):not([type=reset]):not([type=file]),' +
    'textarea,[contenteditable="true"]';
  var els=document.querySelectorAll(sel);
  for(var i=0;i<els.length;i++){
    var v=els[i].value||els[i].textContent||'';
    if(v.trim().length>0)return true;
  }
  return false;
})()`;

// Прямоугольник выделения (последний range) в координатах viewport страницы — для позиционирования
// поповера перевода. null, если выделения нет (тогда — фоллбэк на p.x/p.y клика ПКМ) — и ТАК ЖЕ
// null, если bounding rect всего выделения больше вьюпорта или начинается за его пределами (напр.
// выделили несколько экранов текста с прокруткой — rect в основном закадровый, якорить под ним
// поповер уводит его далеко от видимого текста, диагностировано логами: height=1649 при вьюпорте
// ~744, y=-1278). В этом случае координата клика ПКМ (она точно на экране) надёжнее bounding rect
// всего выделения — для НОРМАЛЬНОГО выделения, влезающего во вьюпорт, поведение не меняется.
const SELECTION_RECT_SCRIPT = `(function(){
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  var r = sel.getRangeAt(0).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  if (r.height > window.innerHeight || r.width > window.innerWidth || r.top < 0 || r.left < 0) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
})()`;

// Правка своего текста в поле ввода: снимаем содержимое поля под курсором и ПОМЕЧАЕМ само поле,
// чтобы потом было куда вернуть исправленный текст.
//
// ⚠️ Поле ищем по координатам клика (elementFromPoint), а не по document.activeElement: правый
// клик не всегда переводит фокус в поле, а к моменту вставки фокус вообще будет у поповера.
// Метка атрибутом — тот же приём, что в pageFacts.ts: ссылку на узел через мост не передать, а
// путь по индексам протухает от любой перерисовки страницы (SPA перерисовывает форму на каждый
// ввод). Атрибут переживает перерисовку React'ом ровно потому, что он на том же DOM-узле.
const EDIT_FIELD_CAPTURE_SCRIPT = (x: number, y: number): string => `(function(){
  var el = document.elementFromPoint(${x}, ${y});
  var ed = el && el.closest ? el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]') : null;
  if (!ed) return null;
  var prev = document.querySelector('[data-oblako-edit]');
  if (prev) prev.removeAttribute('data-oblako-edit');
  ed.setAttribute('data-oblako-edit', '1');
  var value = ('value' in ed) ? ed.value : ed.innerText;
  var r = ed.getBoundingClientRect();
  return { text: String(value || ''), rect: { x: r.left, y: r.top, width: r.width, height: r.height } };
})()`;

export class TabManager {
  private win: BrowserWindow;

  // Строитель пункта «Добавить в граф» для ПКМ-меню ссылки. Ставится из main
  // (setGraphMenuBuilder): TabManager не должен знать про хранилище графов — ему отдают
  // готовый пункт меню, тот же приём, что с tabManagerRef у менеджеров вью.
  #graphMenuBuilder:
    | ((items: Array<{ url: string; title: string }>, sticker?: string) => MenuItemConstructorOptions | null)
    | null = null;

  // Распознавание полей формы моделью (AutofillFieldMapper.ts). Тот же приём, что с
  // #graphMenuBuilder: менеджер вкладок про модель и кэш не знает, ему дают готовую функцию.
  #autofillMapper: ((origin: string, fields: unknown) => Promise<Record<number, string>>) | null = null;
  setAutofillFieldMapper(fn: (origin: string, fields: unknown) => Promise<Record<number, string>>): void {
    this.#autofillMapper = fn;
  }

  // ── Единый источник истины — три структуры ──────────────────────────────────
  // hubTab   — хаб (всегда существует, не входит в nodes и pinnedTabs).
  // pinnedTabs — упорядоченный список закреплённых (переживают рестарт).
  // nodes    — упорядоченное дерево узлов для секции «Открытые вкладки».
  //            Phase 0: только SingleNode. split-pair / group — Фазы 2–4.
  // tabMap   — все non-hub вкладки, O(1) доступ по id.
  // Один и тот же nodes обслуживает отрисовку, Ctrl+1–9, Ctrl+Tab и автосейв.
  private hubTab: ManagedTab;
  private pinnedTabs: ManagedTab[] = [];
  private nodes: SidebarNode[] = [];
  private tabMap = new Map<string, ManagedTab>();

  private activeId: string = HUB_ID;
  private bounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
  // Вкладка, страница которой ушла в полноэкранный режим (видео). Пока он держится, её вью
  // занимает всё окно, а присланные рендерером bounds на неё не действуют — иначе первый же
  // ResizeObserver вернул бы кадр обратно в дырку под контент.
  private fullscreenTabId: string | null = null;
  // Поисковик для omnibox-навигации и ПКМ-поиска — единый источник для обеих точек.
  // Применяется извне через setSearchEngine() сразу после конструктора (см. main.ts,
  // SettingsManager) и при смене настройки — сам TabManager настройку не персистирует.
  private searchEngineId: SearchEngineId = DEFAULT_SEARCH_ENGINE_ID;
  // Хранилище бэнгов — подключается извне сразу после конструктора (main.ts), как и поисковик.
  // Не обязательно: изолированные стенды за флагами OBLAKO_*_TEST поднимают TabManager без него.
  private bangs: BangStore | null = null;
  private onChange: () => void;
  private onFindResultCb: (r: FindResult) => void;
  private onFindOpenCb: () => void;
  private onFindCloseCb: () => void;
  private onOmniboxFocusCb: () => void;
  private onFocusChromeCb: () => void;
  // wc — третий параметр (заход на обогащение эмбеддинга истории контентом страницы): даёт
  // HistoryIndexer.ts доступ именно к WebContents НАВИГИРОВАВШЕЙ вкладки, а не к активной —
  // важно для фоновых вкладок, у которых getActiveWebContents() вернул бы чужой DOM.
  private onNavigateCb?: (url: string, title: string, wc: WebContents) => void;
  private onTitleUpdateCb?: (url: string, title: string) => void;
  private onHistoryOpenCb?: () => void;
  // Ctrl+D / Ctrl+Shift+O. Отдельными сеттерами, а не через конструктор: закладки появились
  // позже, и расширять и без того длинный список параметров ради двух колбэков незачем.
  private onBookmarkPageCb?: () => void;
  private onBookmarksOpenCb?: () => void;
  private onQuickSearchCb?: () => void;
  private onFirstTabLoadCb?: () => void;
  // Общий колбэк для ВСЕХ AI-действий над выделением (перевод/выжимка/пересказ/объяснение) — та же
  // труба «координаты → Qwen → поповер», разные action только меняют промпт (см. TranslationService.ts).
  // canReplace — текст взят из поля ввода и его можно вернуть обратно (см. EDIT_FIELD_CAPTURE_SCRIPT).
  private onAiActionCb?: (action: AiAction, text: string, rect: SelectionRect, wc: WebContents, canReplace?: boolean) => void;
  // Поповер перевода анкорится к конкретной вкладке/области — при смене активной вкладки его
  // позиция теряет смысл, при закрытии ИМЕННО этой вкладки — тем более. Два отдельных сигнала
  // (не переиспользуем onChange — он общий и палит на ~20 несвязанных мутаций).
  private onActiveTabChangedCb?: () => void;
  // tabId — добавлен в шаге 2 менеджера паролей (PasswordAutofillManager.onTabClosed), существующие
  // подписчики (TranslatePopoverManager) второй параметр просто игнорируют — это расширение
  // сигнатуры, не ломает совместимость.
  private onTabClosedCb?: (wc: WebContents, tabId: string) => void;
  // Заход 5 (дропдаун подсказок, кардинальный фикс): реальный OS-фокус ушёл на контент вкладки —
  // единственный надёжный (не blur) сигнал «пользователь физически кликнул в страницу», см.
  // wirePageEvents::wc.on('focus') ниже. Используется main.ts, чтобы закрыть дропдаун омнибокса
  // в chrome (SuggestDropdownManager сам этого не видит — фокус чужой вкладки его не касается).
  private onContentFocusCb?: () => void;
  // Менеджер паролей, шаг 2 — сигналы от content-preload гостевой вкладки (см. wirePageEvents,
  // wc.ipc.on выше). url — уже вычисленный main'ом wc.getURL(), не из payload preload'а.
  private onPasswordFormCb?: (tabId: string, hasLoginForm: boolean, hasUsernameField: boolean, url: string) => void;
  private onPasswordSubmitCb?: (tabId: string, username: string, password: string, url: string) => void;
  // Иконка в поле пароля (не в тулбаре) — rect в координатах вьюпорта СТРАНИЦЫ, main сам
  // транслирует в оконные через getTabViewBounds() (см. PasswordAutofillManager.ts).
  private onPasswordFieldIconClickCb?: (tabId: string, rect: { x: number; y: number; width: number; height: number }, url: string) => void;
  // Автозаполнение форм — фокус на поле адреса/карты (см. wirePageEvents). url — из wc.getURL().
  private onAutofillFieldFocusCb?: (tabId: string, rect: { x: number; y: number; width: number; height: number }, kind: 'address' | 'card', url: string) => void;
  // Автозаполнение — отправка формы с данными адреса/карты (offer-save). url — из wc.getURL().
  private onAutofillSubmitCb?: (tabId: string, kind: 'address' | 'card', fields: Record<string, string>, url: string) => void;
  // Взводится при создании инкогнито-вкладки; см. takeIncognitoClearIfDone (чистка сессии инкогнито).
  #pendingIncognitoClear = false;
  private firstTabLoaded = false; // защита: колбэк вызывается ровно один раз
  private closedTabs: string[] = []; // стек URL закрытых вкладок для Ctrl+Shift+T
  private errors = new Map<string, TabErrorState>(); // per-tab ошибки загрузки/краша
  private lastQuery = ''; // последний поисковый запрос (чтобы отличить новый от навигации)
  // Флаг: открыта ли панель поиска (нужен для приоритета Esc: сначала закрыть поиск).
  private findBarOpen = false;
  // Снимок nodes до последней AI-группировки: null = нет чего откатывать.
  // Сбрасывается при любом ручном структурном изменении (drag, создание/удаление группы и т.п.).
  private organizeSnapshot: SidebarNode[] | null = null;
  // Имена вкладок ДО массового переименования (tabId → прежнее умное имя или undefined).
  // Отдельно от organizeSnapshot: «навести порядок» делает два разных дела, и откатывать их
  // человек может по отдельности — вернуть привычные названия, но оставить разложенные группы.
  private renameSnapshot: Map<string, string | undefined> | null = null;
  // Коллекция активных split-пар. splitRatio — доля левой панели (0.2..0.8).
  // Коммит 3: guard в enterSplit (см. ниже) по-прежнему не пускает вторую пару —
  // коллекция здесь ради формы модели (готовит почву под несколько одновременных
  // split), но фактически всегда держит ≤1 элемент, пока guard не снят отдельным
  // коммитом. "Показываемая сейчас" пара — не отдельное поле, а #activePair():
  // та единственная пара из коллекции, где activeId — одна из двух панелей.
  private splitPairs: SplitPair[] = [];

  constructor(
    win: BrowserWindow,
    onChange: () => void,
    onFindResult: (r: FindResult) => void,
    onFindOpen: () => void,
    onFindClose: () => void,
    onOmniboxFocus: () => void,
    onFocusChrome: () => void,
    onNavigate?: (url: string, title: string, wc: WebContents) => void,
    onTitleUpdate?: (url: string, title: string) => void,
    onHistoryOpen?: () => void,
    onFirstTabLoad?: () => void,
    onAiAction?: (action: AiAction, text: string, rect: SelectionRect, wc: WebContents, canReplace?: boolean) => void,
    onActiveTabChanged?: () => void,
    onTabClosed?: (wc: WebContents, tabId: string) => void,
    onContentFocus?: () => void,
    onPasswordForm?: (tabId: string, hasLoginForm: boolean, hasUsernameField: boolean, url: string) => void,
    onPasswordSubmit?: (tabId: string, username: string, password: string, url: string) => void,
    onPasswordFieldIconClick?: (tabId: string, rect: { x: number; y: number; width: number; height: number }, url: string) => void,
    onAutofillFieldFocus?: (tabId: string, rect: { x: number; y: number; width: number; height: number }, kind: 'address' | 'card', url: string) => void,
    onAutofillSubmit?: (tabId: string, kind: 'address' | 'card', fields: Record<string, string>, url: string) => void,
  ) {
    this.win = win;
    this.onChange = onChange;
    this.onFindResultCb = onFindResult;
    this.onFindOpenCb = onFindOpen;
    this.onFindCloseCb = onFindClose;
    this.onOmniboxFocusCb = onOmniboxFocus;
    this.onFocusChromeCb = onFocusChrome;
    this.onNavigateCb = onNavigate;
    this.onTitleUpdateCb = onTitleUpdate;
    this.onHistoryOpenCb = onHistoryOpen;
    this.onFirstTabLoadCb = onFirstTabLoad;
    this.onAiActionCb = onAiAction;
    this.onActiveTabChangedCb = onActiveTabChanged;
    this.onTabClosedCb = onTabClosed;
    this.onContentFocusCb = onContentFocus;
    this.onPasswordFormCb = onPasswordForm;
    this.onPasswordSubmitCb = onPasswordSubmit;
    this.onPasswordFieldIconClickCb = onPasswordFieldIconClick;
    this.onAutofillFieldFocusCb = onAutofillFieldFocus;
    this.onAutofillSubmitCb = onAutofillSubmit;
    // Хаб существует всегда; не входит в tabMap, pinnedTabs или nodes.
    this.hubTab = { id: HUB_ID, view: null, sleeping: null, lastActiveAt: 0 };
    this.startSleepTimer();
  }

  // Меняет движок для omnibox-навигации и ПКМ-поиска (единый источник для обеих точек).
  setSearchEngine(id: SearchEngineId): void {
    this.searchEngineId = id;
  }

  // Ctrl+E — поповер быстрого поиска (SearchPopoverManager.ts). Отдельным сеттером, а не ещё
  // одним аргументом конструктора: их там уже двадцать, и позиционный список давно на пределе
  // читаемости.
  setOnQuickSearch(cb: () => void): void {
    this.onQuickSearchCb = cb;
  }

  setBangStore(store: BangStore): void {
    this.bangs = store;
  }

  // ── Парсинг omnibox: это URL или поисковый запрос ──
  // Явные правила из спеки (3.7). Edge-кейсы лучше прописать заранее.
  private resolveInput(input: string): string {
    const s = input.trim();
    if (!s) return 'about:blank';
    // Бэнги («!yt котики», «котики !yt») — ДО проверки на схему и хост: строка с бэнгом никогда
    // не является ни URL, ни именем хоста, а вот обратное неверно, и порядок тут единственно
    // возможный. Неизвестный ключ бэнгом не считается и уходит дальше как обычный запрос —
    // поэтому текст, случайно начатый с «!», не превращается в навигацию в никуда.
    const bangUrl = this.resolveBang(s);
    if (bangUrl) return bangUrl;
    // Уже есть схема
    if (/^(https?|file|about):/i.test(s)) return s;
    // localhost / IP / есть точка и нет пробела -> трактуем как хост
    const looksLikeHost =
      /^localhost(:\d+)?(\/.*)?$/i.test(s) ||
      /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(s) ||
      (!/\s/.test(s) && /\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s));
    if (looksLikeHost) return `https://${s}`;
    return getSearchEngine(this.searchEngineId).buildUrl(s);
  }

  // Разбор бэнга. null — «это не бэнг», строка уходит в обычную ветку resolveInput.
  // Хранилище может быть не подключено (тесты, стенды за флагами OBLAKO_*_TEST) — тогда бэнгов
  // просто нет, а не падение.
  private resolveBang(s: string): string | null {
    if (!this.bangs) return null;
    const parsed = parseBangCandidate(s);
    if (!parsed) return null;
    const bang = this.bangs.find(parsed.key);
    if (!bang) return null;
    // «!yt» без запроса — на главную сайта, как в DuckDuckGo: пользователь явно назвал сайт,
    // подставлять пустой поиск бессмысленно.
    return parsed.query ? applyBangTemplate(bang.template, parsed.query) : bangHomeUrl(bang);
  }

  private isHttpView(view: WebContentsView | null): view is WebContentsView {
    return view !== null;
  }

  // Строже isHttpView — та проверяет только не-null, этого недостаточно там, где view может
  // пережить внешнее уничтожение своего webContents (window.close() из контента, типично для
  // OAuth-страниц после логина; либо снос всего окна при выходе) РАНЬШЕ, чем closeTab успевает
  // вычистить tabMap (см. wc.on('destroyed', ...) ниже, который сам зовёт closeTab). Именно так
  // ловился "Object has been destroyed" в exitSplit: вкладка ещё активный участник split, её
  // webContents уже destroyed, а isHttpView этого не видит. Новый хелпер — только для мест,
  // реально уязвимых к этой гонке (exitSplit); остальные ~30 мест с isHttpView не трогаем, там
  // риска нет (не пересекаются с уничтожением снаружи в этот момент).
  private isLiveHttpView(view: WebContentsView | null): view is WebContentsView {
    return view !== null && !view.webContents.isDestroyed();
  }

  // ── Снимок состояния для UI ──
  // Порядок: хаб → закреплённые → узлы (flat, Phase 0: всё SingleNode).
  // Совпадает с визуальным порядком сайдбара и порядком Ctrl+1–9 / Ctrl+Tab.
  snapshot(): TabState[] {
    const result: TabState[] = [];

    // Хаб
    result.push({
      id: HUB_ID, isActive: HUB_ID === this.activeId,
      tabError: null,
      url: '', title: 'Новая вкладка · AI-хаб',
      faviconUrl: null, isLoading: false,
      canGoBack: false, canGoForward: false, isHub: true, isPinned: false,
      splitSide: null, isSleeping: false, incognito: false, kind: 'hub',
    });

    // Закреплённые
    for (const t of this.pinnedTabs) result.push(this.#tabToState(t, true));

    // Обычные (через узлы)
    for (const t of this.#flattenNodes()) result.push(this.#tabToState(t, false));

    // DBG: инвариант — каждый split-pair в nodes должен иметь оба таба в tabMap.
    this.#debugCheckSplitInvariant('snapshot');

    return result;
  }

  // Превращает ManagedTab в TabState; isPinned явно передаётся — известно по списку.
  #tabToState(t: ManagedTab, isPinned: boolean): TabState {
    // Псевдо-вкладка (История/Настройки) — постоянно view:null/sleeping:null (не «убитый»
    // WebContents, а вкладка, у которой его в принципе никогда не было), проверяем ДО ветки
    // «мёртвый вид» ниже, иначе она попала бы в тот же фоллбэк с пустым title.
    if (t.kind) {
      return {
        id: t.id, isActive: t.id === this.activeId,
        tabError: null,
        url: '', title: t.kind === 'history' ? 'История посещений'
          : t.kind === 'bookmarks' ? 'Закладки'
          : t.kind === 'downloads' ? 'Загрузки' : 'Настройки',
        faviconUrl: null, isLoading: false, canGoBack: false, canGoForward: false,
        isHub: false, isPinned, splitSide: null, isSleeping: false, incognito: false, kind: t.kind, section: t.section,
      };
    }
    if (t.sleeping) {
      return {
        id: t.id, isActive: t.id === this.activeId,
        tabError: null,
        url: t.sleeping.url, title: t.aiTitle || t.sleeping.title,
        // Кэш (base64, офлайн) приоритетнее «живого» URL — тот требует сети прямо сейчас.
        faviconUrl: t.sleeping.faviconData ?? t.sleeping.faviconUrl,
        isLoading: false, canGoBack: false, canGoForward: false,
        isHub: false, isPinned,
        splitSide: this.#tabSplitSide(t.id),
        isSleeping: true, incognito: !!t.incognito, kind: 'page',
      };
    }
    if (!this.isHttpView(t.view) || t.view.webContents.isDestroyed()) {
      // Хаб и псевдо-вкладки обрабатываются отдельно выше; сюда не должны попадать.
      // Уничтоженный (но ещё не вычищенный из tabMap) WebContents — тот же короткий фоллбэк.
      return {
        id: t.id, isActive: t.id === this.activeId,
        tabError: null, url: '', title: '', faviconUrl: null,
        isLoading: false, canGoBack: false, canGoForward: false,
        isHub: false, isPinned, splitSide: null, isSleeping: false, incognito: !!t.incognito, kind: 'page',
      };
    }
    const wc = t.view.webContents;
    return {
      id: t.id, isActive: t.id === this.activeId,
      tabError: this.errors.get(t.id) ?? null,
      url: wc.getURL(),
      title: t.aiTitle || wc.getTitle() || wc.getURL() || 'Загрузка…',
      faviconUrl: (wc as unknown as { _oblakoFavicon?: string })._oblakoFavicon ?? null,
      isLoading: wc.isLoadingMainFrame(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isHub: false, isPinned,
      splitSide: this.#tabSplitSide(t.id),
      isSleeping: false, incognito: !!t.incognito, kind: 'page',
    };
  }

  // Плоский список ManagedTab из дерева узлов (рекурсивный — обходит группы).
  #flattenNodes(nodes: SidebarNode[] = this.nodes): ManagedTab[] {
    const result: ManagedTab[] = [];
    for (const node of nodes) {
      if (node.type === 'single') {
        const t = this.tabMap.get(node.tabId);
        if (t) result.push(t);
      } else if (node.type === 'split-pair') {
        const left = this.tabMap.get(node.leftTabId);
        const right = this.tabMap.get(node.rightTabId);
        if (left) result.push(left);
        if (right) result.push(right);
      } else if (node.type === 'group') {
        result.push(...this.#flattenNodes(node.children));
      }
    }
    return result;
  }

  // Ищет родительский массив и индекс узла, содержащего tabId (рекурсивно).
  #findTabParent(tabId: string, nodes: SidebarNode[] = this.nodes): { parent: SidebarNode[]; idx: number } | null {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.type === 'single' && node.tabId === tabId)
        return { parent: nodes, idx: i };
      if (node.type === 'split-pair' && (node.leftTabId === tabId || node.rightTabId === tabId))
        return { parent: nodes, idx: i };
      if (node.type === 'group') {
        const found = this.#findTabParent(tabId, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Ищет GroupNode по id (рекурсивно).
  #findGroupById(groupId: string, nodes: SidebarNode[] = this.nodes): GroupNode | null {
    for (const node of nodes) {
      if (node.type === 'group') {
        if (node.id === groupId) return node;
        const found = this.#findGroupById(groupId, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Возвращает родительский массив для группы (или null если группа на верхнем уровне).
  #findGroupParent(groupId: string, nodes: SidebarNode[] = this.nodes): SidebarNode[] | null {
    for (const node of nodes) {
      if (node.type === 'group') {
        if (node.id === groupId) return nodes;
        const found = this.#findGroupParent(groupId, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  // URL вкладки: из sleeping-метаданных или из живого WebContents.
  #tabUrl(tab: ManagedTab): string {
    if (tab.sleeping) return tab.sleeping.url;
    if (this.isHttpView(tab.view) && !tab.view.webContents.isDestroyed()) return tab.view.webContents.getURL();
    return '';
  }

  // Title вкладки для сохранения в сессию (заход C) — undefined, если не знаем (напр. страница
  // ещё не отдала title) — писать в session.json нечего, поле останется отсутствующим (optional).
  #tabTitle(tab: ManagedTab): string | undefined {
    // Умное имя старше заголовка страницы: человек попросил называть вкладку так.
    //
    // ⚠️ Отсюда оно попадает и в session.json — как обычный title спящей вкладки, СВОЕГО поля в
    // формате сессии у него нет. Последствие осознанное: после перезапуска подпись сохраняется,
    // но при пробуждении вкладки заменяется настоящим заголовком страницы. Отдельное поле
    // означало бы правку формата, где лежат реальные вкладки пользователя, — ради подписи это
    // несоразмерный риск (см. CLAUDE.md, «Безопасность данных»).
    if (tab.aiTitle) return tab.aiTitle;
    if (tab.sleeping) return tab.sleeping.title || undefined;
    if (this.isHttpView(tab.view) && !tab.view.webContents.isDestroyed()) {
      return tab.view.webContents.getTitle() || undefined;
    }
    return undefined;
  }

  // Base64-кэш favicon для сохранения в сессию — undefined, если фоновый #cacheFaviconData ещё не
  // успел (или сайт без favicon) — это нормально, допишется при следующем автосейве.
  #tabFaviconData(tab: ManagedTab): string | undefined {
    if (tab.sleeping) return tab.sleeping.faviconData ?? undefined;
    if (this.isHttpView(tab.view) && !tab.view.webContents.isDestroyed()) {
      return (tab.view.webContents as unknown as { _oblakoFaviconData?: string })._oblakoFaviconData;
    }
    return undefined;
  }

  // Строит SavedSingleNode с опциональными title/faviconData, если уже известны — используется и
  // для обычного single-узла, и для деградации split-pair (см. #serializeNodes).
  #toSavedSingle(tab: ManagedTab): SavedSingleNode {
    const node: SavedSingleNode = { type: 'single', url: this.#tabUrl(tab) };
    const title = this.#tabTitle(tab);
    if (title) node.title = title;
    const faviconData = this.#tabFaviconData(tab);
    if (faviconData) node.faviconData = faviconData;
    return node;
  }

  // Заменяет SplitPairNode двумя SingleNode — рекурсивный поиск (пара может быть в группе).
  #dissolveSplitPair(leftId: string, rightId: string): void {
    this.#dissolveSplitPairIn(leftId, rightId, this.nodes);
  }

  #dissolveSplitPairIn(leftId: string, rightId: string, nodes: SidebarNode[]): boolean {
    const idx = nodes.findIndex(
      (n) => n.type === 'split-pair' && n.leftTabId === leftId && n.rightTabId === rightId,
    );
    if (idx !== -1) {
      nodes.splice(idx, 1,
        { type: 'single', tabId: leftId },
        { type: 'single', tabId: rightId },
      );
      return true;
    }
    for (const node of nodes) {
      if (node.type === 'group') {
        if (this.#dissolveSplitPairIn(leftId, rightId, node.children)) return true;
      }
    }
    return false;
  }

  // Пара, которая ПОКАЗЫВАЕТСЯ сейчас — не отдельный указатель, а та единственная запись
  // в splitPairs, где activeId — одна из двух панелей. Остальные пары (если появятся) —
  // «припаркованы»: существуют в коллекции, но их вьюхи скрыты.
  #activePair(): SplitPair | undefined {
    return this.splitPairs.find((p) => p.leftId === this.activeId || p.rightId === this.activeId);
  }

  // Пара, содержащая конкретный tabId (не обязательно показываемая сейчас) — для мест,
  // которым нужно "эта вкладка вообще в какой-то паре", а не "она в показываемой".
  #pairContaining(id: string): SplitPair | undefined {
    return this.splitPairs.find((p) => p.leftId === id || p.rightId === id);
  }

  // Активная вкладка сейчас — одна из двух панелей ПОКАЗЫВАЕМОЙ пары. Паттерн был
  // текстуально продублирован в нескольких местах — один источник правды.
  #currentlyInSplit(): boolean {
    return !!this.#activePair();
  }

  // Сторона вкладки в СВОЕЙ паре (не в показываемой — TabState.splitSide отражает
  // "я вообще в сплите", парковка на это не влияет, см. Sidebar.tsx).
  #tabSplitSide(id: string): 'left' | 'right' | null {
    const pair = this.#pairContaining(id);
    if (!pair) return null;
    return id === pair.leftId ? 'left' : 'right';
  }

  // Вычисляет SavedActiveRef (v4 формат: 'url' вместо 'normal'/'split').
  // URL однозначно идентифицирует активную вкладку в подавляющем большинстве случаев.
  #computeActiveRef(): SavedActiveRef {
    if (this.activeId === HUB_ID) return { type: 'hub' };

    const pinnedIdx = this.pinnedTabs.findIndex((t) => t.id === this.activeId);
    if (pinnedIdx !== -1) return { type: 'pinned', index: pinnedIdx };

    const tab = this.tabMap.get(this.activeId);
    const url = tab ? this.#tabUrl(tab) : '';
    // Активный OAuth-попап (ephemeral) сам в сейв не попадает — ссылаться на него в activeRef нельзя,
    // после рестарта такого URL в сохранённых вкладках не будет.
    if (tab && !tab.ephemeral && /^https?:\/\//i.test(url)) return { type: 'url', url };
    return { type: 'hub' }; // фоллбэк: about:blank, ephemeral или без реального URL
  }

  // Текущее дерево узлов для SYNC_CHANGED (шлём как есть из this.nodes).
  sidebarNodesSnapshot(): SidebarNode[] {
    // DBG: проверяем инвариант split-pair в момент сборки nodes-снимка.
    this.#debugCheckSplitInvariant('sidebarNodesSnapshot');
    return this.nodes;
  }

  // Структурированный снимок для сериализации (рекурсивный — поддерживает группы).
  // Возвращает null если нарушен инвариант — сейв пропускается.
  getSessionSnapshot(): SessionSnapshot | null {
    const isReal = (url: string) => /^https?:\/\//i.test(url);
    // Короткоживущие вкладки (OAuth-попапы, см. wirePageEvents/setWindowOpenHandler) в сейв не идут —
    // при рестарте нет смысла «воскрешать» страницу логина.
    // Инкогнито не попадает в автосейв (как и ephemeral) — приватные вкладки не «воскресают».
    const savable = (t: ManagedTab) => !t.ephemeral && !t.incognito && isReal(this.#tabUrl(t));

    const pinnedTabs: SavedTab[] = [];
    for (const t of this.pinnedTabs) {
      if (!savable(t)) continue;
      const pin: SavedTab = { url: this.#tabUrl(t) };
      const title = this.#tabTitle(t); if (title) pin.title = title;
      const faviconData = this.#tabFaviconData(t); if (faviconData) pin.faviconData = faviconData;
      pinnedTabs.push(pin);
    }

    const nodes = this.#serializeNodes(this.nodes, savable);

    // Инвариант: число сериализованных вкладок == число сохраняемых вкладок tabMap.
    const expectedCount = [...this.tabMap.values()].filter(savable).length;
    const actualCount = pinnedTabs.length + this.#countSavedTabs(nodes);

    if (actualCount !== expectedCount) {
      console.error(
        `[TabManager] инвариант сессии нарушен: ожидали ${expectedCount}, сериализовали ${actualCount}. Сохранение пропущено.`,
      );
      return null;
    }

    return { pinnedTabs, nodes, activeRef: this.#computeActiveRef() };
  }

  // Рекурсивная сериализация узлов с деградацией split-pair при отсутствии сохраняемых вкладок.
  #serializeNodes(nodes: SidebarNode[], savable: (t: ManagedTab) => boolean): SavedNode[] {
    const result: SavedNode[] = [];
    for (const node of nodes) {
      if (node.type === 'single') {
        const tab = this.tabMap.get(node.tabId);
        if (!tab) continue;
        if (savable(tab)) result.push(this.#toSavedSingle(tab));
      } else if (node.type === 'split-pair') {
        const leftTab  = this.tabMap.get(node.leftTabId);
        const rightTab = this.tabMap.get(node.rightTabId);
        const leftOk  = !!leftTab  && savable(leftTab);
        const rightOk = !!rightTab && savable(rightTab);
        if (leftOk && rightOk) {
          // "Живой" ratio — если эта пара сейчас в splitPairs (может быть показываемой или
          // припаркованной, неважно — ratio актуален в обоих случаях), иначе берём из узла.
          const livePair = this.#pairContaining(node.leftTabId);
          const ratio = livePair ? livePair.splitRatio : node.ratio;
          const pairNode: SavedSplitPairNode = {
            type: 'split-pair', leftUrl: this.#tabUrl(leftTab!), rightUrl: this.#tabUrl(rightTab!), ratio,
          };
          const leftTitle = this.#tabTitle(leftTab!); if (leftTitle) pairNode.leftTitle = leftTitle;
          const rightTitle = this.#tabTitle(rightTab!); if (rightTitle) pairNode.rightTitle = rightTitle;
          const leftFav = this.#tabFaviconData(leftTab!); if (leftFav) pairNode.leftFaviconData = leftFav;
          const rightFav = this.#tabFaviconData(rightTab!); if (rightFav) pairNode.rightFaviconData = rightFav;
          result.push(pairNode);
        } else if (leftOk) {
          result.push(this.#toSavedSingle(leftTab!));
        } else if (rightOk) {
          result.push(this.#toSavedSingle(rightTab!));
        }
      } else if (node.type === 'group') {
        const children = this.#serializeNodes(node.children, savable);
        if (children.length > 0) {
          result.push({
            type: 'group', id: node.id, label: node.label,
            color: node.color, collapsed: node.collapsed, children,
          });
        }
      }
    }
    return result;
  }

  // Рекурсивный подсчёт вкладок в сериализованном дереве.
  #countSavedTabs(nodes: SavedNode[]): number {
    let count = 0;
    for (const n of nodes) {
      if (n.type === 'single')     count++;
      else if (n.type === 'split-pair') count += 2;
      else if (n.type === 'group') count += this.#countSavedTabs(n.children);
    }
    return count;
  }

  // Восстанавливает дерево узлов из сохранённой сессии.
  // urlToIds: URL → очередь tabId (поддерживает дубликаты URL).
  // Вызывается после создания всех вкладок через createTab, ДО activate().
  rebuildNodeTree(savedNodes: SavedNode[], urlToIds: Map<string, string[]>): void {
    this.nodes = [];
    this.splitPairs = [];
    this.#buildNodesFromSaved(savedNodes, urlToIds, this.nodes);
    this.#detectSplitState(this.nodes);
  }

  #buildNodesFromSaved(
    savedNodes: SavedNode[],
    urlToIds: Map<string, string[]>,
    target: SidebarNode[],
  ): void {
    for (const saved of savedNodes) {
      if (saved.type === 'single') {
        const id = urlToIds.get(saved.url)?.shift();
        if (id) target.push({ type: 'single', tabId: id });
      } else if (saved.type === 'split-pair') {
        const leftId  = urlToIds.get(saved.leftUrl)?.shift();
        const rightId = urlToIds.get(saved.rightUrl)?.shift();
        if (leftId && rightId) {
          const ratio = Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, saved.ratio));
          target.push({ type: 'split-pair', leftTabId: leftId, rightTabId: rightId, ratio });
        }
      } else if (saved.type === 'group') {
        const children: SidebarNode[] = [];
        this.#buildNodesFromSaved(saved.children, urlToIds, children);
        target.push({
          type: 'group', id: saved.id, label: saved.label,
          color: saved.color, collapsed: saved.collapsed, children,
        });
      }
    }
  }

  // DBG: проверяет, что каждый SplitPairNode в дереве ссылается на существующие tabMap-записи.
  #debugCheckSplitInvariant(label: string, nodes: SidebarNode[] = this.nodes): void {
    for (const node of nodes) {
      if (node.type === 'split-pair') {
        const hasLeft  = this.tabMap.has(node.leftTabId);
        const hasRight = this.tabMap.has(node.rightTabId);
        if (!hasLeft || !hasRight) {
          console.error(
            `[TabMgr][${label}] SPLIT INVAR FAIL: leftTabId=${node.leftTabId}(in tabMap:${hasLeft}) rightTabId=${node.rightTabId}(in tabMap:${hasRight})`,
            `| splitPairs=${JSON.stringify(this.splitPairs)}`,
            `| activeId=${this.activeId}`,
            `| tabMap.size=${this.tabMap.size}`,
            `| nodes.length=${this.nodes.length}`,
          );
        }
      } else if (node.type === 'group') {
        this.#debugCheckSplitInvariant(label, node.children);
      }
    }
  }

  // Удаляет пустые GroupNode из дерева (рекурсивно).
  #pruneEmptyGroups(nodes: SidebarNode[]): void {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.type === 'group') {
        this.#pruneEmptyGroups(node.children);
        if (node.children.length === 0) nodes.splice(i, 1);
      }
    }
  }

  // Проходит по nodes и регистрирует В splitPairs КАЖДУЮ найденную split-pair (рекурсивно,
  // включая группы) — не только первую. Какая из них окажется "показываемой" после restore
  // решает activate(targetId) через #pairContaining (см. activate ниже), не порядок здесь.
  #detectSplitState(nodes: SidebarNode[]): void {
    for (const node of nodes) {
      if (node.type === 'split-pair') {
        this.splitPairs.push({
          leftId: node.leftTabId, rightId: node.rightTabId,
          activePanel: 'left', splitRatio: node.ratio,
        });
      } else if (node.type === 'group') {
        this.#detectSplitState(node.children);
      }
    }
  }

  getActiveId() { return this.activeId; }

  // Есть ли ещё живые инкогнито-вкладки — main чистит in-memory сессию инкогнито, когда закрылась
  // последняя (Chrome-подобное поведение: приватные данные живут только пока открыт инкогнито).
  hasIncognitoTabs(): boolean {
    for (const t of this.tabMap.values()) if (t.incognito) return true;
    return false;
  }

  // Инкогнито ли вкладка — для подавления offer-save паролей/автозаполнения (заход 2).
  isIncognito(tabId: string): boolean {
    return !!this.tabMap.get(tabId)?.incognito;
  }

  // Нужно ли ЧИСТИТЬ in-memory сессию инкогнито прямо сейчас (закрылась последняя приватная
  // вкладка). Взводится при создании инкогнито-вкладки, гасится здесь — main зовёт на закрытии
  // любой вкладки и, получив true, чистит storage. Так работает и для кнопки, и для хоткея, без
  // дублирования флага в main.
  takeIncognitoClearIfDone(): boolean {
    if (this.#pendingIncognitoClear && !this.hasIncognitoTabs()) {
      this.#pendingIncognitoClear = false;
      return true;
    }
    return false;
  }

  // ── Создание новой вкладки с реальной страницей ──
  // background=true: вкладка создаётся в фоне, без переключения (средний клик по ссылке).
  createTab(rawUrl?: string, background = false, ephemeral = false, incognito = false): string {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        // Жёсткая изоляция: страница не имеет доступа к Node.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Менеджер паролей, шаг 2 — сканер форм (см. CONTENT_PRELOAD_PATH выше). Без
        // nodeIntegrationInSubFrames — preload намеренно НЕ выполняется в кросс-origin iframe
        // (структурный гвард против чтения/заполнения чужого origin, см. PasswordAutofillManager.ts).
        preload: CONTENT_PRELOAD_PATH,
        // Инкогнито: in-memory сессия (общая для всех приватных вкладок, не пишется на диск).
        // Обычные вкладки partition не задают → defaultSession.
        ...(incognito ? { partition: INCOGNITO_PARTITION } : {}),
      },
    });
    const tab: ManagedTab = { id, view, sleeping: null, lastActiveAt: Date.now(), ephemeral, incognito };
    if (incognito) this.#pendingIncognitoClear = true; // при закрытии последней приватной — чистим сессию
    this.tabMap.set(id, tab);
    this.nodes.push({ type: 'single', tabId: id });
    this.wirePageEvents(id, view);

    const target = this.resolveInput(rawUrl ?? 'about:blank');
    if (target !== 'about:blank') view.webContents.loadURL(target);

    if (background) {
      this.onChange(); // показываем новую вкладку в сайдбаре без переключения
    } else {
      this.activate(id);
    }
    return id;
  }

  // Псевдо-вкладка (История/Настройки) — тот же tabMap/nodes-путь, что у createTab выше, но
  // без WebContentsView/wirePageEvents (переиспользован только приём "view: null" от хаба, не
  // сам синглтон-механизм хаба — см. диагностику: HUB_ID жёстко захардкожен и не масштабируется
  // на несколько экземпляров, а эта вкладка — обычная запись со своим id, закрываемая, можно
  // открыть несколько сразу). #tabUrl()==='' для неё уже естественно исключает её из
  // savable()/session-снимка и isHttpView()/sleep-таймера — без отдельных правок там.
  createSpecialTab(kind: 'history' | 'settings' | 'bookmarks' | 'downloads', section?: string): string {
    const id = randomUUID();
    const tab: ManagedTab = { id, view: null, sleeping: null, lastActiveAt: Date.now(), kind, section };
    this.tabMap.set(id, tab);
    this.nodes.push({ type: 'single', tabId: id });
    this.activate(id);
    return id;
  }

  // Создаёт закреплённую вкладку — используется только при восстановлении сессии.
  // cachedFaviconData — base64 из session.json (заход C): кладём в тот же хак-приём, что и живой
  // favicon (_oblakoFavicon), ДО loadURL — #tabToState тут же отдаст его в сайдбар, пока страница
  // ещё грузится. Реальный favicon, когда прилетит page-favicon-updated, перезапишет заглушку сам.
  createPinnedTab(rawUrl: string, cachedFaviconData?: string): string {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: CONTENT_PRELOAD_PATH },
    });
    if (cachedFaviconData) {
      (view.webContents as unknown as { _oblakoFavicon?: string })._oblakoFavicon = cachedFaviconData;
    }
    const tab: ManagedTab = { id, view, sleeping: null, lastActiveAt: Date.now() };
    this.tabMap.set(id, tab);
    this.pinnedTabs.push(tab);
    this.wirePageEvents(id, view);

    const target = this.resolveInput(rawUrl);
    if (target !== 'about:blank') view.webContents.loadURL(target);

    this.onChange();
    return id;
  }

  // ── Закреплённая вкладка, рождённая СРАЗУ спящей — тот же приём, что createSleepingTab ниже
  // (view:null + sleeping:meta, атомарно), только кладёт запись в pinnedTabs, а не в nodes.
  // Для восстановления сессии: раньше закреплённые ВСЕГДА поднимались через createPinnedTab
  // (реальный WebContentsView + loadURL для каждой сразу) — при 10 закреплённых это 10
  // параллельных загрузок страниц на старте (см. живой замер CPU-пика). isTabPinned()/#tabUrl()/
  // #tabTitle() уже одинаково работают что с живым view, что со sleeping (см. их тела) — ничего
  // в остальном коде эту вкладку от «настоящей» закреплённой не отличит, пока её не разбудят.
  createSleepingPinnedTab(rawUrl: string, seedTitle?: string, seedFaviconData?: string): string {
    const id = randomUUID();
    const url = this.resolveInput(rawUrl);
    const tab: ManagedTab = {
      id, view: null, lastActiveAt: Date.now(),
      sleeping: {
        url,
        title: seedTitle || domainFromUrl(url),
        faviconUrl: null,
        faviconData: seedFaviconData ?? null,
      },
    };
    this.tabMap.set(id, tab);
    this.pinnedTabs.push(tab);
    this.onChange();
    return id;
  }

  // ── Создаёт вкладку СРАЗУ спящей (view:null + sleeping:meta) — для ленивого восстановления
  // сессии: не создаёт WebContentsView, не грузит URL, ничего не ест до первого клика.
  // sleeping заполняется в ТОМ ЖЕ объекте, что и view:null, — атомарно, без промежуточного
  // view:null+sleeping:null (это состояние #tabToState трактует как "уничтоженный", title:'').
  // seedTitle/seedFaviconData — то, что уже знаем из файла сессии (заход C: session.json v5
  // хранит title/faviconData, накопленные в прошлых сеансах). Если их нет (старый v4-файл, или
  // URL, для которого ничего не успело закэшироваться) — фоллбэк: домен из URL, favicon отсутствует.
  // ⚠️ Важно не путать с доменом-заглушкой: если seed передан — он ВСЕГДА реальные данные, а не
  // фоллбэк, поэтому подменять его доменом нельзя, иначе настоящий title тихо деградирует при
  // каждом цикле «уснула → сохранили → перезапуск без пробуждения» (см. диагностику захода B).
  createSleepingTab(rawUrl: string, seedTitle?: string, seedFaviconData?: string): string {
    const id = randomUUID();
    const url = this.resolveInput(rawUrl);
    const tab: ManagedTab = {
      id, view: null, lastActiveAt: Date.now(),
      sleeping: {
        url,
        title: seedTitle || domainFromUrl(url),
        faviconUrl: null,
        faviconData: seedFaviconData ?? null,
      },
    };
    this.tabMap.set(id, tab);
    this.nodes.push({ type: 'single', tabId: id });
    this.onChange();
    return id;
  }

  // Закрепить / открепить существующую вкладку.
  togglePin(id: string): void {
    // Псевдо-вкладки (История/Настройки) закреплять некуда — нет реальной страницы, которую
    // «переживать» перезапуску (и так не попадают в сессию, см. диагностику).
    if (id === HUB_ID || this.tabMap.get(id)?.kind) return;
    if (!this.tabMap.has(id)) return;
    this.clearOrganizeSnapshot();
    const pinnedIdx = this.pinnedTabs.findIndex((t) => t.id === id);
    if (pinnedIdx !== -1) {
      // Открепить: убрать из pinnedTabs, добавить SingleNode в конец nodes.
      const [tab] = this.pinnedTabs.splice(pinnedIdx, 1);
      // Если вкладка была в split — снимаем split при откреплении (split не поддерживает
      // закреплённые). На практике недостижимо: закрепление уже проходит через ветку ниже,
      // которая всегда разбирает пару ДО пополнения pinnedTabs — оставлено как защита.
      if (this.#pairContaining(id)) {
        this.exitSplit(id, id);
      }
      this.nodes.push({ type: 'single', tabId: tab.id });
    } else {
      // Закрепить: если вкладка в split — сначала выходим (другая остаётся).
      const pair = this.#pairContaining(id);
      if (pair) {
        const otherId = id === pair.leftId ? pair.rightId : pair.leftId;
        if (this.#activePair() === pair) {
          this.exitSplit(otherId, otherId); // разворачивает ПОКАЗЫВАЕМУЮ пару в два SingleNode
        } else {
          // Припаркованная (не показываемая) пара: разбираем канонически (→ два SingleNode) —
          // общий блок ниже (#findTabParent(id)) уберёт SingleNode самого id, останется
          // только otherId, как и раньше. Активную пару (если есть другая) не трогаем.
          this.#dissolveSplitPair(pair.leftId, pair.rightId);
          this.splitPairs = this.splitPairs.filter((p) => p !== pair);
        }
      }
      // Теперь id гарантированно в SingleNode — убираем из nodes (рекурсивно, если в группе).
      const found = this.#findTabParent(id);
      if (found && found.parent[found.idx].type === 'single') {
        found.parent.splice(found.idx, 1);
        this.#pruneEmptyGroups(this.nodes);
      }
      const tab = this.tabMap.get(id)!;
      this.pinnedTabs.push(tab);
    }
    this.onChange();
  }

  isTabPinned(id: string): boolean {
    return this.pinnedTabs.some((t) => t.id === id);
  }

  // ── Фоновый кэш favicon в base64 (заход C) — для мгновенных офлайн-иконок в сессии ──
  // Fire-and-forget: качает favicons?.[0] (URL, см. page-favicon-updated выше), кладёт data:-строку
  // в тот же хак-приём, что и _oblakoFavicon (свойство прямо на webContents). НИКОГДА не вызывается
  // из getSessionSnapshot/#write — те синхронны и работают в т.ч. на win.on('close'), await там
  // не сработает. Кап на размер (FAVICON_CACHE_MAX_BYTES) — один «тяжёлый» favicon не должен
  // бесконтрольно раздувать session.json.
  #cacheFaviconData(wc: WebContents, url: string): void {
    net.fetch(url).then(async (res) => {
      if (!res.ok || wc.isDestroyed()) return;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > FAVICON_CACHE_MAX_BYTES || wc.isDestroyed()) return;
      const contentType = res.headers.get('content-type') || 'image/x-icon';
      (wc as unknown as { _oblakoFaviconData?: string })._oblakoFaviconData =
        `data:${contentType};base64,${buf.toString('base64')}`;
    }).catch(() => { /* сеть недоступна/CORS/т.п. — просто не кэшируем, не критично */ });
  }

  // ── Усыпление: выгружаем WebContentsView, сохраняем метаданные ──
  private sleepTab(id: string): void {
    const tab = this.tabMap.get(id);
    if (!tab || !this.isHttpView(tab.view) || tab.sleeping) return;
    const wc = tab.view.webContents;
    const url = wc.getURL();
    // Не усыпляем вкладки без реального URL (about:blank и т.п.)
    if (!/^https?:\/\//i.test(url)) return;
    tab.sleeping = {
      url,
      title: wc.getTitle() || url,
      faviconUrl: (wc as unknown as { _oblakoFavicon?: string })._oblakoFavicon ?? null,
      // Base64-кэш (см. #cacheFaviconData) — если фоновый fetch уже успел завершиться к моменту
      // усыпления. Если нет — faviconUrl выше остаётся фоллбэком для текущей сессии, а данные
      // всё равно попадут в session.json при следующем реальном пробуждении+усыплении.
      faviconData: (wc as unknown as { _oblakoFaviconData?: string })._oblakoFaviconData ?? null,
    };
    try { this.win.contentView.removeChildView(tab.view); } catch { /* noop */ }
    try { (wc as unknown as { close?: () => void }).close?.(); } catch { /* noop */ }
    tab.view = null;
    this.errors.delete(id);
    this.onChange();
  }

  // ── Пробуждение: пересоздаём WebContentsView и начинаем загрузку ──
  // Синхронный: создаёт вьюху и стартует загрузку. Страница появится когда загрузится (did-navigate).
  private wakeTab(id: string): void {
    const tab = this.tabMap.get(id);
    if (!tab?.sleeping) return;
    const { url } = tab.sleeping;
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: CONTENT_PRELOAD_PATH },
    });
    tab.sleeping = null;
    tab.view = view;
    tab.lastActiveAt = Date.now();
    this.errors.delete(id);
    this.wirePageEvents(id, view);
    view.webContents.loadURL(url);
  }

  // ── Таймер засыпания: периодически проверяет кандидатов ──
  //
  // ⚠️ Ссылку на таймер держим ради остановки. Пока окно было одно, интервал жил столько же,
  // сколько процесс, и разницы не было. С несколькими окнами каждый открытый-и-закрытый экземпляр
  // оставлял бы после себя вечный минутный таймер, ходящий по мёртвому менеджеру, — их набирается
  // ровно столько, сколько окон человек успел закрыть за сеанс. Останавливаем в dispose().
  private sleepTimer: NodeJS.Timeout | null = null;

  private startSleepTimer(): void {
    this.sleepTimer = setInterval(async () => {
      const now = Date.now();
      const activePair = this.#activePair();

      // Набор защищённых id: активная вкладка + обе панели ПОКАЗЫВАЕМОЙ пары.
      // Припаркованные пары не защищены — их вкладки могут усыпляться как обычные.
      const protectedIds = new Set<string>([this.activeId]);
      if (activePair) {
        protectedIds.add(activePair.leftId);
        protectedIds.add(activePair.rightId);
      }

      for (const tab of this.tabMap.values()) {
        // Пропускаем: уже спящие, защищённые вкладки, не-http вьюхи
        if (tab.sleeping || protectedIds.has(tab.id)) continue;
        // Инкогнито не усыпляем: усыпление уничтожает WebContentsView, а с ним потерялась бы
        // in-memory сессия приватных вкладок (куки/логины текущей приватной сессии).
        if (tab.incognito) continue;
        if (!this.isHttpView(tab.view)) continue;

        // Таймаут ещё не истёк — не трогаем (и не гоняем дорогой JS-запрос зря)
        const timeout = this.isTabPinned(tab.id) ? SLEEP_TIMEOUT_PINNED : SLEEP_TIMEOUT_NORMAL;
        if (now - tab.lastActiveAt < timeout) continue;

        const wc = tab.view.webContents;

        // Играет медиа — пропускаем
        if (wc.isCurrentlyAudible()) continue;

        // Async: проверяем незаполненные формы — только после прохождения всех sync-фильтров
        let hasForms = false;
        try {
          hasForms = await wc.executeJavaScript(HAS_FILLED_FORMS_SCRIPT, true);
        } catch {
          continue; // WebContents недоступен — пропускаем
        }
        if (hasForms) continue;

        // Перепроверяем после await: вкладка могла стать активной пока шёл JS-запрос —
        // пересчитываем показываемую пару заново, старый activePair мог устареть.
        if (protectedIds.has(tab.id) || tab.sleeping || !this.isHttpView(tab.view)) continue;
        if (tab.id === this.activeId) continue;
        const freshActivePair = this.#activePair();
        if (freshActivePair
            && (tab.id === freshActivePair.leftId || tab.id === freshActivePair.rightId)) continue;

        this.sleepTab(tab.id);
      }
    }, SLEEP_CHECK_INTERVAL);
  }

  // Окно закрылось — менеджер больше никому не нужен. Снимаем всё, что переживает окно само по
  // себе: сейчас это таймер сна (слушатели на webContents уходят вместе со своими вью, а те
  // уничтожает Electron вместе с contentView).
  dispose(): void {
    if (this.sleepTimer) { clearInterval(this.sleepTimer); this.sleepTimer = null; }
  }

  private wirePageEvents(id: string, view: WebContentsView) {
    const wc = view.webContents;
    // ⚠️ Вкладку можно передать другому окну (см. detachTabForMove). Слушатели, навешенные ЭТИМ
    // менеджером, остаются на её webContents навсегда: снять их выборочно нечем, а
    // removeAllListeners снёс бы и чужие (видео, PiP, индексация истории). Поэтому каждый
    // обработчик сначала спрашивает, наша ли это ещё вкладка. Иначе прежнее окно продолжало бы
    // писать её визиты в историю вторым экземпляром, ловить found-in-page в свою панель поиска
    // и раздвигаться на полный экран из чужого видео.
    const mine = () => this.tabMap.has(id);
    const notify = () => { if (mine()) this.onChange(); };

    // Менеджер паролей, шаг 2 — per-view IPC (webContents.ipc, не общий ipcMain): main точно
    // знает, какая вкладка прислала сообщение, без реверс-маппинга webContents.id → tabId.
    // Origin НЕ берём из payload content-preload (недоверенный источник) — только из wc.getURL()
    // здесь, в main, в момент события (см. PasswordAutofillManager.ts).
    wc.ipc.on(IPC.PASSWORDS_FORM_DETECTED, (_e, payload: { hasLoginForm: boolean; hasUsernameField: boolean }) => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      try {
        this.onPasswordFormCb?.(id, payload.hasLoginForm, payload.hasUsernameField, wc.getURL());
      } catch (e) {
        console.warn('[TabMgr] onPasswordFormCb error:', (e as Error).message);
      }
    });
    wc.ipc.on(IPC.PASSWORDS_CREDENTIAL_SUBMITTED, (_e, payload: { username: string; password: string }) => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      try {
        this.onPasswordSubmitCb?.(id, payload.username, payload.password, wc.getURL());
      } catch (e) {
        console.warn('[TabMgr] onPasswordSubmitCb error:', (e as Error).message);
      }
    });
    wc.ipc.on(IPC.PASSWORDS_FIELD_ICON_CLICK, (_e, payload: { rect: { x: number; y: number; width: number; height: number } }) => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      try {
        this.onPasswordFieldIconClickCb?.(id, payload.rect, wc.getURL());
      } catch (e) {
        console.warn('[TabMgr] onPasswordFieldIconClickCb error:', (e as Error).message);
      }
    });
    // Автозаполнение — фокус на поле адреса/карты. Origin/url — из wc.getURL() (не из payload).
    wc.ipc.on(IPC.AUTOFILL_FIELD_FOCUS, (_e, payload: { rect: { x: number; y: number; width: number; height: number }; kind: 'address' | 'card' }) => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      try {
        this.onAutofillFieldFocusCb?.(id, payload.rect, payload.kind, wc.getURL());
      } catch (e) {
        console.warn('[TabMgr] onAutofillFieldFocusCb error:', (e as Error).message);
      }
    });
    // «Что это за поля?» — страница спрашивает про те, что не осилила её эвристика (см.
    // AutofillFieldMapper.ts). ⚠️ Origin берём из wc.getURL(), а НЕ из payload: адрес, присланный
    // самой страницей, — это то, что она захотела сообщить, а не то, где она открыта, и по нему
    // страница могла бы прочитать чужой кэш полей.
    wc.ipc.handle(IPC.AUTOFILL_MAP_FIELDS, async (_e, payload: { fields?: unknown }) => {
      if (!mine()) return {};
      try {
        let origin = '';
        try { origin = new URL(wc.getURL()).origin; } catch { return {}; }
        if (!origin.startsWith('http')) return {}; // локальные/служебные страницы не обслуживаем
        return await this.#autofillMapper?.(origin, payload?.fields) ?? {};
      } catch (e) {
        console.warn('[TabMgr] autofill map error:', (e as Error).message);
        return {};
      }
    });
    wc.ipc.on(IPC.AUTOFILL_SUBMIT, (_e, payload: { kind: 'address' | 'card'; fields: Record<string, string> }) => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      try {
        this.onAutofillSubmitCb?.(id, payload.kind, payload.fields, wc.getURL());
      } catch (e) {
        console.warn('[TabMgr] onAutofillSubmitCb error:', (e as Error).message);
      }
    });

    // Когда WebContentsView получает OS-фокус от клика мышью — проверяем, не нужно ли
    // активировать панель split. DOM-дивы в renderer не получают клик, перекрытый вьюхой.
    wc.on('focus', () => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      // Пара, которую переключаем, должна быть ПОКАЗЫВАЕМОЙ (== #activePair()) — иначе это
      // скрытая вьюха припаркованной пары, которая в норме и так не должна получать OS-фокус,
      // но проверка не полагается на это молча.
      const pair = this.#pairContaining(id);
      if (pair && pair === this.#activePair() && this.activeId !== id) {
        const side = id === pair.leftId ? 'left' : 'right';
        this.focusSplitPanel(side);
      }
      // Реальный клик в контент — не связан с addChildView chrome-оверлеев (дропдаун/поповер/
      // FindBar), это OS-фокус ДРУГОГО webContents. Надёжный сигнал закрытия дропдауна омнибокса
      // без blur (см. onContentFocusCb выше).
      this.onContentFocusCb?.();
    });

    // Таймер первой контентной вкладки: вызывается ровно один раз.
    if (!this.firstTabLoaded) {
      wc.once('did-finish-load', () => {
        if (this.firstTabLoaded) return;
        this.firstTabLoaded = true;
        this.onFirstTabLoadCb?.();
      });
    }

    // Новая попытка загрузки — очищаем предыдущую ошибку сразу.
    wc.on('did-start-loading', () => { if (!mine()) return; this.errors.delete(id); notify(); });
    wc.on('did-stop-loading', notify);
    // Успешный коммит навигации — показываем вьюху + сбрасываем поиск.
    // Не на did-start-loading: вьюха не должна мигать при retry, который снова упадёт.
    wc.on('did-navigate', () => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      // ⚠️ Умное имя описывало ПРЕЖНЮЮ страницу — на новой оно было бы прямой ложью в списке
      // вкладок. Снимаем на did-navigate (полная навигация), а не на did-navigate-in-page:
      // якорь и history.pushState страницу не меняют.
      const tab = this.tabMap.get(id) ?? this.pinnedTabs.find((t) => t.id === id);
      if (tab?.aiTitle) tab.aiTitle = undefined;
      const isActivePanel = this.activeId === id;
      const pair = this.#pairContaining(id);
      const isInSplit = !!pair;
      // Партнёр показывается прямо сейчас, только если это ПОКАЗЫВАЕМАЯ пара (не
      // припаркована) — навигация в скрытой паре не должна поднимать её вьюху поверх экрана.
      const isShownSplitPartner = isInSplit && pair === this.#activePair();
      if (isActivePanel) {
        wc.stopFindInPage('clearSelection');
        this.lastQuery = '';
        this.onFindCloseCb();
      }
      // Навигация = активность; обновляем lastActiveAt для активных/split-вкладок (в т.ч.
      // припаркованных — это просто учёт активности, не показ).
      if (isActivePanel || isInSplit) {
        const tab = this.tabMap.get(id);
        if (tab) tab.lastActiveAt = Date.now();
      }
      // Показываем вьюху как для активной вкладки, так и для показываемого split-партнёра.
      if (isActivePanel || isShownSplitPartner) this.revealView(id);
      // Записываем визит: один URL = один UPSERT с инкрементом счётчика. Инкогнито НЕ пишем в
      // историю — приватная вкладка не оставляет следа (onNavigate у нас только про историю/индекс).
      if (!this.tabMap.get(id)?.incognito) this.onNavigateCb?.(wc.getURL(), wc.getTitle(), wc);
      notify();
    });
    wc.on('did-navigate-in-page', notify);

    // Полноэкранное видео. Без этого «на весь экран» означало лишь «на всю дырку под
    // контент»: Chromium растягивает видео по своей WebContentsView, а она у нас занимает
    // только область страницы — сайдбар, тулбар и поля оставались на виду.
    //
    // Разворачиваем И вью на всё окно, И само окно: полноэкранный ролик не должен упираться
    // в заголовок окна и панель задач. Вью вкладки лежит выше хрома по порядку addChildView,
    // так что интерфейс она закрывает собой — прятать его отдельно не требуется.
    //
    // ⚠️ Вью перекладываем ПОСЛЕ того, как окно закончило собственный переход, а не сразу.
    // setFullScreen асинхронен: система разворачивает окно со своей анимацией, и если тут же
    // задать вью новые границы, она полсекунды живёт не по размеру окна — кадр прыгает, а по
    // краям мелькает пустота. Отсюда подписка на события окна, а не немедленный вызов.
    wc.on('enter-html-full-screen', () => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      this.fullscreenTabId = id;
      if (this.win.isDestroyed()) return;
      if (this.win.isFullScreen()) { this.repositionViews(); return; }
      this.win.once('enter-full-screen', () => this.repositionViews());
      this.win.setFullScreen(true);
    });
    wc.on('leave-html-full-screen', () => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      if (this.fullscreenTabId !== id) return;
      this.fullscreenTabId = null;
      if (this.win.isDestroyed()) return;
      if (!this.win.isFullScreen()) { this.repositionViews(); return; }
      this.win.once('leave-full-screen', () => this.repositionViews());
      this.win.setFullScreen(false);
    });
    wc.on('page-title-updated', (_e, title) => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      // Обновляем только заголовок — без инкремента счётчика посещений.
      this.onTitleUpdateCb?.(wc.getURL(), title);
      notify();
    });

    wc.on('page-favicon-updated', (_e, favicons) => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      const url = favicons?.[0];
      (wc as unknown as { _oblakoFavicon?: string })._oblakoFavicon = url;
      notify();
      if (url) this.#cacheFaviconData(wc, url);
    });

    // Результат findInPage — пробрасываем в renderer для обновления счётчика.
    wc.on('found-in-page', (_e, result) => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      this.onFindResultCb({ activeMatch: result.activeMatchOrdinal, count: result.matches });
    });

    // Политика окон: target=_blank / window.open -> НОВАЯ ВКЛАДКА, не окно — КРОМЕ настоящих
    // попапов (см. ниже). disposition='background-tab' = средний клик/Ctrl+клик → фон (стандарт браузеров).
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      // OAuth-попап (Google/Firebase и т.п.) открывается ИМЕННО так: window.open(url, name,
      // 'width=…,height=…') → disposition='new-window' + width/height в features. Это единственный
      // надёжный сигнал «это попап, а не просто открытие в новой вкладке» — обычные target=_blank/
      // window.open(url) без размерных фич дают 'foreground-tab'/'background-tab'/'default'.
      //
      // Такому попапу нужно НАСТОЯЩЕЕ дочернее окно с живым window.opener — OAuth-провайдер в конце
      // шлёт window.opener.postMessage(token) родителю. Если вместо этого создать нашу вкладку
      // (как раньше), opener окажется пустым и логин молча не долетит до родителя (см. диагностику
      // прошлого шага). Поэтому здесь action:'allow' — Chromium сам создаёт связанное окно;
      // details.features уже содержит width/height, Electron распарсит их сам.
      const isOAuthPopup = disposition === 'new-window' && /(?:^|,)\s*(width|height)\s*=/.test(features);
      if (isOAuthPopup) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true, // не наш кастомный хром — просто обычное окно ОС без лишнего UI
            // Менеджер паролей, шаг 2: сканер форм (CONTENT_PRELOAD_PATH) сюда НЕ подключаем —
            // это окно вне tabMap/wirePageEvents (сторонний OAuth-провайдер, не сайт пользователя),
            // осознанно за скобками v1, см. план.
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
          },
        };
      }
      this.createTab(url, disposition === 'background-tab', disposition === 'new-window');
      return { action: 'deny' };
    });
    // Настоящее окно OAuth-попапа (action:'allow' выше) Electron создаёт и закрывает сам —
    // оно НЕ регистрируется в tabMap/nodes, никак не завязано на автосейв/дерево вкладок Oblako.

    // Ctrl+колесо → наш зум (preventDefault гасит нативный зум Chromium).
    // Chromium перехватывает Ctrl+scroll как gesture, поэтому страница не скроллится.
    wc.on('zoom-changed', (event, direction) => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      event.preventDefault();
      this.adjustZoom(direction === 'in' ? ZOOM_STEP : -ZOOM_STEP);
    });

    // Ошибка загрузки основного фрейма (DNS, сеть, TLS…)
    // errorCode === -3 (ERR_ABORTED) — пользователь остановил загрузку; не ошибка.
    wc.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      if (!isMainFrame || errorCode === -3) return;
      const url = wc.getURL() || validatedURL;
      // Снимаем состояние сети ЗДЕСЬ, а не в renderer: к моменту показа плашки сеть может уже
      // вернуться, и совет «проверьте подключение» окажется враньём задним числом.
      this.errors.set(id, { type: 'load', code: errorCode, url, offline: !net.isOnline() });
      const isInSplit = !!this.#pairContaining(id);
      if (this.activeId === id || isInSplit) this.hideView(id);
      notify();
    });

    // Программное уничтожение вкладки САМИМ контентом (window.close() — типично для OAuth-попапов
    // после логина), а не через наш closeTab(). Без этого слушателя tabMap/дерево нод/activeId
    // продолжают ссылаться на уничтоженный WebContents — следующий снапшот падает на getURL.
    // Пускаем через тот же closeTab(), что и обычное закрытие — единая атомарная уборка.
    // Проверка tab.view === view отсекает устаревшие/ожидаемые destroyed от старой вьюхи —
    // усыпление (sleepTab) и обычный closeTab() сами обнуляют/удаляют tab.view ДО close(),
    // так что к моменту этого события они уже не совпадут и повторной уборки не случится.
    wc.on('destroyed', () => {
      if (!mine()) return; // вкладка уехала в другое окно — её обслуживает новый владелец
      const tab = this.tabMap.get(id);
      if (!tab || tab.view !== view) return;
      // [диагностика краша exitSplit/closeTab на shutdown] — какая вкладка, участник ли split,
      // на каком этапе относительно win.on('close')/('closed') это случилось (см. main.ts).
      const inSplit = !!this.#pairContaining(id);
      console.log(`[shutdown] tab destroyed id=${id} inSplit=${inSplit} splitPairs=${JSON.stringify(this.splitPairs)} tabMapSize=${this.tabMap.size}`);
      this.closeTab(id);
    });

    // Краш рендер-процесса: вьюха мертва — прячем, показываем экран ошибки.
    wc.on('render-process-gone', () => {
      const url = wc.getURL();
      this.errors.set(id, { type: 'crash', code: 0, url, offline: false });
      const isInSplit = !!this.#pairContaining(id);
      if (this.activeId === id || isInSplit) this.hideView(id);
      notify();
    });

    wc.on('context-menu', (_e, p) => {
      const items: MenuItemConstructorOptions[] = [];
      const engine = getSearchEngine(this.searchEngineId);

      // ── Ссылка ──────────────────────────────────────────────────────────────
      if (p.linkURL) {
        items.push(
          { label: 'Открыть ссылку в новой вкладке', click: () => this.createTab(p.linkURL, true) },
          // Окно создаёт main — TabManager про окна не знает (тот же приём, что у пункта
          // «Добавить в граф»: сюда приходит готовый колбэк).
          { label: 'Открыть ссылку в новом окне', click: () => this.onOpenInNewWindowCb?.(p.linkURL) },
          { label: 'Открыть ссылку в инкогнито', click: () => this.createTab(p.linkURL, true, false, true) },
        );
        // Пункт только когда текущая activeId ещё НЕ в показываемой паре — модель split
        // строго бинарная (пара = 2 панели), добавить третью панель к уже сплитнутой
        // вкладке некуда. Проверяем #activePair(), а не #currentlyInSplit-переменную —
        // на неё смотрит здесь именно "текущая вкладка сейчас показывается как часть пары".
        // ⚠️ Если activeId внутри группы, а новая вкладка (createTab — всегда топ-уровень)
        // окажется в другом родителе дерева — enterSplit тихо не сработает (guard
        // #findTabParent требует общего родителя, см. enterSplit). Известное ограничение,
        // не фикс здесь — для вкладок вне групп путь рабочий.
        if (!this.#activePair()) {
          items.push({
            label: 'Открыть ссылку в split',
            click: () => {
              const newId = this.createTab(p.linkURL, true); // background — не перебивать фокус до enterSplit
              if (newId) this.enterSplit(newId); // activeId (текущая) → левая, newId → правая
            },
          });
        }
        items.push(
          { label: 'Копировать адрес ссылки', click: () => clipboard.writeText(p.linkURL) },
        );
        // «Добавить в граф» строит main: TabManager не должен знать про хранилище графов,
        // ему отдают готовый пункт меню (тот же приём, что с tabManagerRef у менеджеров вью).
        const toGraph = this.#graphMenuBuilder?.(
          [{ url: p.linkURL, title: p.linkText || p.linkURL }],
          undefined,
        );
        if (toGraph) items.push({ type: 'separator' }, toGraph);
      }

      // ── Картинка ─────────────────────────────────────────────────────────────
      if (p.mediaType === 'image' && p.srcURL) {
        if (items.length) items.push({ type: 'separator' });
        items.push(
          { label: 'Копировать картинку', click: () => wc.copyImageAt(p.x, p.y) },
          { label: 'Сохранить картинку как…', click: () => wc.downloadURL(p.srcURL) },
          { label: 'Открыть картинку в новой вкладке', click: () => this.createTab(p.srcURL, true) },
        );
      }

      // ── Редактируемое поле ───────────────────────────────────────────────────
      // isEditable обрабатываем ДО selectionText: cut/copy/paste — главное для инпутов.
      if (p.isEditable) {
        // Орфография: варианты исправления, только если под курсором реально опечатка.
        if (p.misspelledWord && p.dictionarySuggestions.length) {
          if (items.length) items.push({ type: 'separator' });
          for (const suggestion of p.dictionarySuggestions) {
            items.push({ label: suggestion, click: () => wc.replaceMisspelling(suggestion) });
          }
        }
        if (items.length) items.push({ type: 'separator' });
        items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' });
        if (p.selectionText.trim()) {
          items.push({ type: 'separator' });
          items.push({
            label: `Поиск «${truncate(p.selectionText)}» в ${engine.name}`,
            click: () => this.createTab(engine.buildUrl(p.selectionText)),
          });
        }
        // ── Правка своего текста локальной моделью ──────────────────────────
        // Работаем с ВЫДЕЛЕНИЕМ, если оно есть, иначе со всем содержимым поля: человек чаще
        // всего хочет причесать весь черновик, а не кусок. Текст поля тянем скриптом — в
        // params контекстного меню его нет (там только selectionText).
        if (this.onAiActionCb) {
          const dispatchEdit = (action: AiAction) => {
            void (async () => {
              let captured: { text: string; rect: { x: number; y: number; width: number; height: number } } | null = null;
              try { captured = await wc.executeJavaScript(EDIT_FIELD_CAPTURE_SCRIPT(p.x, p.y), true); } catch { /* поле пропало */ }
              const selected = p.selectionText.trim();
              const text = selected || (captured?.text ?? '').trim();
              if (!text) return; // пустое поле — править нечего, молча выходим
              const viewBounds = view.getBounds();
              const local = captured?.rect ?? { x: p.x, y: p.y, width: 0, height: 0 };
              const rect: SelectionRect = {
                x: viewBounds.x + local.x, y: viewBounds.y + local.y,
                width: local.width, height: local.height,
              };
              // Пятый аргумент — «результат можно вернуть в поле»: поповер покажет «Заменить».
              this.onAiActionCb!(action, text, rect, wc, true);
            })();
          };
          items.push({ type: 'separator' });
          items.push({
            label: 'Править текст',
            submenu: [
              { label: 'Исправить ошибки', click: () => dispatchEdit('fix') },
              { label: 'Сделать короче',   click: () => dispatchEdit('shorten') },
              { label: 'Смягчить тон',     click: () => dispatchEdit('polite') },
            ],
          });
        }
      } else if (p.selectionText.trim()) {
        // ── Выделенный текст (не в инпуте) ──────────────────────────────────
        if (items.length) items.push({ type: 'separator' });
        items.push(
          { role: 'copy' },
          {
            label: `Поиск «${truncate(p.selectionText)}» в ${engine.name}`,
            click: () => this.createTab(engine.buildUrl(p.selectionText)),
          },
        );
        if (this.onAiActionCb) {
          // Общий диспетчер для всех AI-действий над выделением — только action меняется,
          // координаты/фоллбэк/лог одни и те же (см. onAiActionCb в TranslationService.ts).
          const dispatchAiAction = (action: AiAction) => {
            const text = p.selectionText;
            const tClick = performance.now();
            void (async () => {
              // Фоллбэк на координаты клика ПКМ, если запрос rect не удался/не дал результата
              // (напр. выделение снялось до клика по пункту меню — редкий race).
              let local: { x: number; y: number; width: number; height: number };
              let fellBack = false;
              try {
                const scriptResult = await wc.executeJavaScript(SELECTION_RECT_SCRIPT, true);
                if (scriptResult) { local = scriptResult; } else { local = { x: p.x, y: p.y, width: 0, height: 0 }; fellBack = true; }
              } catch {
                local = { x: p.x, y: p.y, width: 0, height: 0 };
                fellBack = true;
              }
              const viewBounds = view.getBounds();
              const rect: SelectionRect = {
                x: viewBounds.x + local.x,
                y: viewBounds.y + local.y,
                width: local.width,
                height: local.height,
              };
              console.log(`[popover] selrect: fellBack=${fellBack} local=${JSON.stringify(local)} viewBounds=${JSON.stringify(viewBounds)} computed=${JSON.stringify(rect)}`);
              console.log(`[perf] selection->request: ${(performance.now() - tClick).toFixed(0)}ms`);
              this.onAiActionCb!(action, text, rect, wc);
            })();
          };

          items.push({ label: 'Перевести', click: () => dispatchAiAction('translate') });
          items.push({ label: 'Пересказать проще', click: () => dispatchAiAction('simplify') });
          items.push({ label: 'Объяснить', click: () => dispatchAiAction('explain') });
          // «Краткая выжимка» — только для достаточно длинного выделения (см. SUMMARIZE_MIN_CHARS).
          if (p.selectionText.trim().length >= SUMMARIZE_MIN_CHARS) {
            items.push({ label: 'Краткая выжимка', click: () => dispatchAiAction('summarize') });
          }
        }
      }

      // ── Фоллбэк: просто страница (ни ссылки, ни картинки, ни выделения) ────
      if (!items.length) {
        items.push(
          { label: 'Назад',    enabled: wc.canGoBack(),     click: () => wc.goBack() },
          { label: 'Вперёд',   enabled: wc.canGoForward(),  click: () => wc.goForward() },
          { label: 'Обновить',                               click: () => wc.reload() },
        );
      }

      // Инспектор — всегда в конце; inspectElement подсвечивает элемент под курсором.
      items.push({ type: 'separator' });
      items.push({
        label: 'Просмотреть код',
        click: () => {
          if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
          wc.inspectElement(p.x, p.y);
        },
      });

      Menu.buildFromTemplate(items).popup({ window: this.win });
    });

    this.registerHotkeyHandler(wc);
  }

  // ── Активация: показываем нужную вьюху, прячем остальные ──
  activate(id: string) {
    // Хаб не в tabMap — обрабатываем отдельно.
    const tab = id === HUB_ID ? this.hubTab : this.tabMap.get(id);
    if (!tab) return;

    // Поповер перевода анкорится к прежней активной вкладке — при реальной смене (не при
    // повторном activate() того же id, напр. клик по уже активной вкладке в сайдбаре) его пора
    // закрыть. Раньше остального в функции — событие должно уйти сразу, а не в конце разбора.
    if (this.activeId !== id) this.onActiveTabChangedCb?.();

    // Пробуждаем вкладку, если она спит (до любой логики с view).
    if (tab.sleeping) this.wakeTab(id);

    // Останавливаем поиск на уходящей вкладке перед переключением.
    if (this.activeId !== id) {
      const prev = this.activeId === HUB_ID ? null : this.tabMap.get(this.activeId);
      if (prev && this.isHttpView(prev.view)) {
        prev.view.webContents.stopFindInPage('clearSelection');
        this.lastQuery = '';
      }
      this.findBarOpen = false; // FindBar уйдёт при смене activeId в renderer'е
    }

    const pair = this.#pairContaining(id);
    if (pair) {
      // Возврат к split-вкладке: восстанавливаем обе панели ЭТОЙ пары, скрываем постороннее
      // (в т.ч. панели других пар, если такие есть — тот же цикл ниже их не исключает).
      const otherId = id === pair.leftId ? pair.rightId : pair.leftId;
      const otherTab = this.tabMap.get(otherId);
      if (otherTab?.sleeping) this.wakeTab(otherId);

      pair.activePanel = id === pair.leftId ? 'left' : 'right';
      this.activeId = id;
      const activatedTab = this.tabMap.get(id);
      if (activatedTab) activatedTab.lastActiveAt = Date.now();

      for (const t of this.tabMap.values()) {
        if (!this.isHttpView(t.view)) continue;
        if (t.id !== pair.leftId && t.id !== pair.rightId) {
          t.view.setVisible(false);
        }
      }
      this.repositionViews();
      this.onChange();
      this.focusActiveView();
      return;
    }
    // Уход на вкладку вне какой-либо пары — прячем панели ВСЕХ существующих пар (каждая
    // остаётся припаркована в splitPairs для последующего возврата, коллекция не чистится).
    for (const p of this.splitPairs) {
      for (const splitId of [p.leftId, p.rightId]) {
        const splitTab = this.tabMap.get(splitId);
        if (splitTab && this.isHttpView(splitTab.view)) splitTab.view.setVisible(false);
      }
    }

    // Уходим с вкладки, где играет видео, — кадр уезжает в окошко поверх окон и следует за
    // человеком. Возвращаемся — кадр возвращается в страницу (иначе ролик виден дважды).
    const leaving = this.activeId;
    if (leaving && leaving !== id) this.sendPip(leaving, PIP_ENTER_SCRIPT);
    this.sendPip(id, PIP_EXIT_SCRIPT);

    this.activeId = id;
    tab.lastActiveAt = Date.now();

    for (const t of this.tabMap.values()) {
      if (!this.isHttpView(t.view)) continue;
      if (t.id === id) {
        if (!this.errors.has(id)) {
          const children = this.win.contentView.children;
          if (!children.includes(t.view)) this.win.contentView.addChildView(t.view);
          t.view.setVisible(true);
          this.applyBounds(t.view);
        } else {
          t.view.setVisible(false);
        }
      } else {
        t.view.setVisible(false);
      }
    }
    this.onChange();
    this.focusActiveView();
  }

  // После программного переключения вкладки явно передаём OS-фокус нужному view.
  // Без этого before-input-event замолкает: Windows освобождает фокус на BrowserWindow HWND,
  // не перекидывая его на дочерние view автоматически.
  // Публичный (не private) — тем же приёмом, что getActiveWebContents() открыт для
  // AiPanelManager.ts: FindBarManager.ts зовёт его после закрытия FindBar (см. main.ts,
  // FindBarManager.setTabManager) — иначе OS-фокус зависает и Ctrl+F перестаёт долетать
  // повторно (before-input-event молчит без явного focus() на нужный webContents).
  focusActiveView(): void {
    const tab = this.tabMap.get(this.activeId);
    // [диагностика] — кандидат №2 на краш "Object has been destroyed" при закрытии окна со split:
    // тут isHttpView (только не-null), а НЕ isLiveHttpView — если exitSplit зовёт этот метод в
    // хвосте, а «выживший» stayId тоже успел получить destroyed webContents при teardown окна
    // (не только закрываемая вкладка — см. exitSplit), .focus() ниже упадёт именно отсюда.
    const destroyed = tab && this.isHttpView(tab.view) ? tab.view.webContents.isDestroyed() : 'no-view';
    console.log(`[shutdown] focusActiveView activeId=${this.activeId} tabExists=${!!tab} destroyed=${destroyed}`);
    if (tab && this.isHttpView(tab.view) && !this.errors.has(this.activeId)) {
      tab.view.webContents.focus();
    } else {
      this.onFocusChromeCb();
    }
  }

  closeTab(id: string) {
    if (id === HUB_ID) return;
    if (this.isTabPinned(id)) return;
    this.clearOrganizeSnapshot();
    console.log(`[shutdown] closeTab id=${id} splitPairs=${JSON.stringify(this.splitPairs)}`);

    // Закрытие вкладки, входящей в (возможно припаркованную) пару.
    const closingPair = this.#pairContaining(id);
    if (closingPair) {
      const { leftId, rightId } = closingPair;
      const otherId = id === leftId ? rightId : leftId;
      const currentlyShown = closingPair === this.#activePair();
      // [диагностика] — есть ли ВТОРОЙ участник (otherId) в tabMap, и жив ли его webContents,
      // В МОМЕНТ, когда closeTab только начал разбирать split. Если otherTab тоже уже destroyed
      // (teardown всего окна валит обоих почти одновременно) — это отдельный путь от self-close.
      const otherTab = this.tabMap.get(otherId);
      const otherDestroyed = otherTab && this.isHttpView(otherTab.view) ? otherTab.view.webContents.isDestroyed() : 'no-view';
      console.log(`[shutdown] closeTab: split branch, otherId=${otherId} currentlyInSplit=${currentlyShown} otherTabExists=${!!otherTab} otherDestroyed=${otherDestroyed}`);
      if (currentlyShown) {
        // ВНИМАНИЕ: id (сама закрываемая вкладка) в этот момент ещё в tabMap и ещё числится
        // участником пары — exitSplit(otherId, otherId) резолвит её как hideId и трогает её view/webContents.
        // Если сюда пришли из wc.on('destroyed', ...) (self-close контента, напр. OAuth-логина),
        // этот webContents уже мёртв — exitSplit безопасен благодаря isLiveHttpView внутри
        // (проверяет isDestroyed(), не только не-null). Сама вкладка из tabMap уберётся ниже.
        this.exitSplit(otherId, otherId);
      } else {
        // Припаркованная (не показываемая) пара: разбираем канонически (→ два SingleNode) —
        // общий блок ниже (#findTabParent(id)) уберёт SingleNode самой закрываемой вкладки,
        // останется только otherId. Другие пары (если есть) не трогаем.
        this.#dissolveSplitPair(leftId, rightId);
        this.splitPairs = this.splitPairs.filter((p) => p !== closingPair);
      }
    }

    const tab = this.tabMap.get(id);
    if (!tab) return;

    // Убираем из дерева узлов (рекурсивно — вкладка может быть в группе).
    const found = this.#findTabParent(id);
    if (found) {
      const node = found.parent[found.idx];
      if (node.type === 'single') {
        found.parent.splice(found.idx, 1);
        // Если группа опустела после удаления — расформировываем её.
        this.#pruneEmptyGroups(this.nodes);
      }
    }
    this.tabMap.delete(id);
    this.errors.delete(id);

    if (this.isHttpView(tab.view)) {
      const wc = tab.view.webContents;
      // closeTab может прийти сюда и через 'destroyed' (window.close() из контента, см. wirePageEvents) —
      // тогда wc уже мёртв, и getURL()/removeChildView()/close() на нём бросят "Object has been destroyed".
      const destroyed = wc.isDestroyed();
      const url = destroyed ? '' : wc.getURL();
      if (/^https?:\/\//i.test(url)) {
        this.closedTabs.push(url);
        if (this.closedTabs.length > CLOSED_STACK_MAX) this.closedTabs.shift();
      }
      // Поповер перевода анкорится к WebContents конкретной вкладки (см. TranslatePopoverManager.ts) —
      // если закрывается именно она, поповер сравнит ссылку и закроется сам. До removeChildView/close,
      // чтобы сравнение ссылки точно застало ещё живой объект.
      this.onTabClosedCb?.(wc, id);
      if (!destroyed) {
        try { this.win.contentView.removeChildView(tab.view); } catch { /* noop */ }
        (wc as unknown as { close?: () => void }).close?.();
      }
    } else if (tab.sleeping) {
      const url = tab.sleeping.url;
      if (/^https?:\/\//i.test(url)) {
        this.closedTabs.push(url);
        if (this.closedTabs.length > CLOSED_STACK_MAX) this.closedTabs.shift();
      }
    }

    // Если закрыли активную — переключаемся на соседнюю по визуальному порядку или хаб.
    if (this.activeId === id) {
      const ordered = this.tabsInVisualOrder(true);
      const idx = ordered.findIndex((t) => t.id === id);
      const next = ordered[idx + 1] ?? ordered[idx - 1] ?? this.hubTab;
      this.activate(next.id);
    } else {
      this.onChange();
    }
  }

  // ── Перенос вкладки в другое окно ───────────────────────────────────────────
  //
  // Отдаём ЖИВУЮ вью, а не адрес. Открыть URL заново в новом окне было бы вдвое проще, но
  // человек потерял бы всё, ради чего вкладку и вытаскивают: историю «назад», позицию прокрутки,
  // набранный в форме текст, авторизованное состояние SPA.
  //
  // ⚠️ Не переносятся только хаб, псевдо-вкладки (История/Настройки) и участники split: из пары
  // надо сначала выйти, иначе она осталась бы половиной в одном окне, половиной в другом.
  // Закреплённая переносится и в новом окне становится обычной — как в Chrome: закреп это место
  // в полосе конкретного окна, а не свойство самой страницы.
  detachTabForMove(id: string): DetachedTab | null {
    if (id === HUB_ID) return null;
    const pinnedIdx = this.pinnedTabs.findIndex((t) => t.id === id);
    const tab = pinnedIdx >= 0 ? this.pinnedTabs[pinnedIdx]! : this.tabMap.get(id);
    if (!tab) return null;
    if (tab.kind) return null;                 // История/Настройки — не страница, переносить нечего
    if (this.#pairContaining(id)) return null;
    const live = this.isLiveHttpView(tab.view) ? tab.view : null;
    if (!live && !tab.sleeping) return null;   // ни вью, ни описания — переносить нечего

    this.clearOrganizeSnapshot();

    if (pinnedIdx >= 0) {
      this.pinnedTabs.splice(pinnedIdx, 1);
    } else {
      // Из дерева узлов — тем же путём, что closeTab (вкладка может лежать внутри группы).
      const found = this.#findTabParent(id);
      if (found && found.parent[found.idx]?.type === 'single') {
        found.parent.splice(found.idx, 1);
        this.#pruneEmptyGroups(this.nodes);
      }
    }
    this.tabMap.delete(id);
    this.errors.delete(id);
    // Снимаем вью с окна, но НЕ закрываем webContents — она сейчас же встанет в другое окно.
    if (live) {
      try { this.win.contentView.removeChildView(live); } catch { /* окно могло уже закрыться */ }
    }

    // Ушла активная — показываем соседнюю, как при закрытии.
    if (this.activeId === id) {
      const ordered = this.tabsInVisualOrder(true);
      const next = ordered[0] ?? this.hubTab;
      this.activate(next.id);
    } else {
      this.onChange();
    }
    const incognito = tab.incognito === true;
    return live
      ? { kind: 'live', view: live, incognito }
      : { kind: 'sleeping', sleeping: tab.sleeping!, incognito };
  }

  // Принять вкладку, отданную другим окном. Слушатели навешиваются заново — уже на ЭТОТ менеджер
  // (у прежнего они остались, но молчат: см. mine() в wirePageEvents).
  adoptTab(d: DetachedTab): string | null {
    const id = randomUUID(); // свой id: прежний принадлежал дереву того окна
    if (d.kind === 'sleeping') {
      // Спящую заводим спящей же и сразу активируем: разбудит её обычный путь activate/wakeTab,
      // тот самый, что будит восстановленные из сессии.
      const tab: ManagedTab = {
        id, view: null, lastActiveAt: Date.now(), sleeping: d.sleeping, incognito: d.incognito,
      };
      if (d.incognito) this.#pendingIncognitoClear = true;
      this.tabMap.set(id, tab);
      this.nodes.push({ type: 'single', tabId: id });
      this.activate(id);
      return id;
    }
    if (d.view.webContents.isDestroyed()) return null;
    const tab: ManagedTab = {
      id, view: d.view, sleeping: null, lastActiveAt: Date.now(), incognito: d.incognito,
    };
    if (d.incognito) this.#pendingIncognitoClear = true;
    this.tabMap.set(id, tab);
    this.nodes.push({ type: 'single', tabId: id });
    this.wirePageEvents(id, d.view);
    this.activate(id); // activate сам добавит вью в окно и выставит bounds
    return id;
  }

  reopenLastClosedTab(): void {
    const url = this.closedTabs.pop();
    if (url) this.createTab(url);
  }

  // Есть ли что восстанавливать — для активности пункта меню «Открыть закрытую вкладку».
  hasClosedTabs(): boolean {
    return this.closedTabs.length > 0;
  }

  // ── Переупорядочивание вкладок (drag-and-drop) ──────────────────────────────
  // orderedIds — новый порядок от renderer. Перед применением сверяем множества:
  // если есть лишние/дублирующиеся/отсутствующие id — берём пересечение и
  // дописываем пропущенные в конец. Слепому доверию списку нет места: рассинхрон
  // UI↔main мог возникнуть при быстрых операциях (закрытие во время drag).
  reorderTabs(section: 'normal' | 'pinned', orderedIds: string[]): void {
    this.clearOrganizeSnapshot();
    if (section === 'pinned') {
      const currentMap = new Map(this.pinnedTabs.map((t, i) => [t.id, i]));
      const valid = orderedIds.filter((id) => currentMap.has(id));
      // Дедупликация: берём только первое вхождение каждого id.
      const seen = new Set<string>();
      const deduped = valid.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
      // Дописываем вкладки, отсутствующие в присланном списке.
      const missing = this.pinnedTabs.filter((t) => !seen.has(t.id));
      const final = [...deduped, ...missing.map((t) => t.id)];
      const byId = new Map(this.pinnedTabs.map((t) => [t.id, t]));
      this.pinnedTabs = final.map((id) => byId.get(id)!);
    } else {
      // Строим карту itemId → узел (только верхний уровень; внутри групп — отдельный reorder).
      // SingleNode: itemId=tabId. SplitPairNode: itemId=leftTabId. GroupNode: itemId='group:${id}'.
      const itemToNode = new Map<string, SidebarNode>();
      for (const node of this.nodes) {
        if (node.type === 'single') {
          itemToNode.set(node.tabId, node);
        } else if (node.type === 'split-pair') {
          itemToNode.set(node.leftTabId, node);
        } else if (node.type === 'group') {
          itemToNode.set(`group:${node.id}`, node);
        }
      }

      const allItemIds = [...itemToNode.keys()];
      const currentSet = new Set(allItemIds);
      const valid = orderedIds.filter((id) => currentSet.has(id));
      const seen = new Set<string>();
      const deduped = valid.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
      const missing = allItemIds.filter((id) => !seen.has(id));
      const final = [...deduped, ...missing];

      // Реконструируем nodes из итогового порядка item-ID.
      this.nodes = final.map((id) => itemToNode.get(id)!);
    }
    this.onChange(); // → TABS_CHANGED немедленно + scheduleSave (debounce 1.5s)
  }

  // Атомарный перенос вкладки между секциями (drag через границу).
  // Одна транзакция: убрать из A + добавить в B. При нарушении инварианта — откат без onChange.
  moveTabSection(tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number): void {
    if (tabId === HUB_ID || !this.tabMap.has(tabId)) return;
    this.clearOrganizeSnapshot();

    const isPinned = this.pinnedTabs.some((t) => t.id === tabId);
    const isNormal = this.nodes.some((n): n is SingleNode => n.type === 'single' && n.tabId === tabId);

    // Снимок для отката
    const prevPinned = [...this.pinnedTabs];
    const prevNodes  = [...this.nodes];

    if (targetSection === 'pinned' && !isPinned && isNormal) {
      // Обычная → закреплённые
      const nodeIdx = this.nodes.findIndex(
        (n): n is SingleNode => n.type === 'single' && n.tabId === tabId,
      );
      this.nodes.splice(nodeIdx, 1);
      const tab = this.tabMap.get(tabId)!;
      const safeIdx = Math.max(0, Math.min(targetIndex, this.pinnedTabs.length));
      this.pinnedTabs.splice(safeIdx, 0, tab);

    } else if (targetSection === 'normal' && isPinned && !isNormal) {
      // Закреплённая → обычные
      const pinnedIdx = this.pinnedTabs.findIndex((t) => t.id === tabId);
      const [tab] = this.pinnedTabs.splice(pinnedIdx, 1);

      // Если вкладка в split — снимаем (не должно быть для закреплённых, но защитно)
      if (this.#pairContaining(tabId)) {
        this.exitSplit(tabId, tabId);
      }

      // targetIndex — item-индекс (SplitPairNode считается единицей), граница = nodes.length.
      const safeIdx = Math.max(0, Math.min(targetIndex, this.nodes.length));
      this.nodes.splice(safeIdx, 0, { type: 'single', tabId: tab.id });

    } else {
      return; // уже в нужной секции — нет операции
    }

    // Валидация инварианта: вкладка ровно в одной структуре, состав tabMap не изменился
    const inPinnedAfter = this.pinnedTabs.some((t) => t.id === tabId);
    const inNodesAfter  = this.nodes.some((n): n is SingleNode => n.type === 'single' && n.tabId === tabId);

    if (inPinnedAfter === inNodesAfter) {
      // Нарушение (обе или ни одна) → откат
      this.pinnedTabs = prevPinned;
      this.nodes      = prevNodes;
      console.error('[TabManager] moveTabSection: нарушение инварианта, откат');
      return;
    }

    const pinnedSet = new Set(this.pinnedTabs.map((t) => t.id));
    // #flattenNodes рекурсивно обходит группы — без этого дети GroupNode не попадали в nodeSet,
    // и инвариант всегда нарушался при наличии хотя бы одной группы → откат вместо переноса.
    const nodeSet   = new Set(this.#flattenNodes().map((t) => t.id));
    const mapIds = [...this.tabMap.keys()];
    const setsValid = mapIds.length === pinnedSet.size + nodeSet.size
      && mapIds.every((id) => pinnedSet.has(id) !== nodeSet.has(id));

    if (!setsValid) {
      this.pinnedTabs = prevPinned;
      this.nodes      = prevNodes;
      console.error('[TabManager] moveTabSection: несоответствие состава, откат');
      return;
    }

    this.onChange();
  }

  // ── Группы вкладок ───────────────────────────────────────────────────────────

  // Заворачивает узел, содержащий tabId, в новую группу целиком — SingleNode или
  // SplitPairNode (пара переезжает ОБЕИМИ вкладками разом, ratio не трогаем, не разбираем
  // её на две — #findTabParent уже матчит tabId по leftTabId/rightTabId, так что клик по
  // любой из двух панелей резолвит один и тот же узел-пару).
  createGroup(tabId: string): void {
    const found = this.#findTabParent(tabId);
    if (!found) return;
    this.clearOrganizeSnapshot();
    const node = found.parent[found.idx];
    if (node.type === 'group') return; // группы не вложены (Phase 3) — сюда не попадаем
    const group: GroupNode = {
      type: 'group', id: randomUUID(),
      label: 'Новая группа', color: null, collapsed: false, children: [node],
    };
    found.parent.splice(found.idx, 1, group);
    this.onChange();
  }

  // Перемещает узел (SingleNode или SplitPairNode целиком) в конец children указанной
  // группы — та же логика "не разбираем пару", что и в createGroup.
  addTabToGroup(groupId: string, tabId: string): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    this.clearOrganizeSnapshot();
    const found = this.#findTabParent(tabId);
    if (!found) return;
    const node = found.parent[found.idx];
    if (node.type === 'group') return;
    found.parent.splice(found.idx, 1);
    group.children.push(node);
    this.onChange();
  }

  // Вынимает вкладку (или ЕЁ ПАРУ целиком, если tabId — панель split-pair) из группы;
  // помещает узел после группы. Если группа опустела — расформировывает её.
  removeTabFromGroup(groupId: string, tabId: string): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    this.clearOrganizeSnapshot();
    const childIdx = group.children.findIndex((c) =>
      (c.type === 'single' && c.tabId === tabId) ||
      (c.type === 'split-pair' && (c.leftTabId === tabId || c.rightTabId === tabId)),
    );
    if (childIdx === -1) return;
    const [node] = group.children.splice(childIdx, 1);
    if (group.children.length === 0) {
      // Пустая группа — расформировываем.
      this.#disbandGroupIn(groupId, this.nodes);
      this.nodes.push(node);
    } else {
      // Вставляем после группы в её родительском массиве.
      const groupParent = this.#findGroupParent(groupId) ?? this.nodes;
      const gi = groupParent.findIndex((n) => n.type === 'group' && (n as GroupNode).id === groupId);
      groupParent.splice(gi + 1, 0, node);
    }
    this.onChange();
  }

  renameGroup(groupId: string, label: string): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    group.label = label.trim() || 'Группа';
    this.onChange();
  }

  setGroupColor(groupId: string, color: string | null): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    group.color = color;
    this.onChange();
  }

  toggleGroupCollapse(groupId: string): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    group.collapsed = !group.collapsed;
    this.onChange();
  }

  // Расформировывает группу: дети выносятся на место группы в родительском массиве.
  disbandGroup(groupId: string): void {
    this.clearOrganizeSnapshot();
    this.#disbandGroupIn(groupId, this.nodes);
    this.onChange();
  }

  #disbandGroupIn(groupId: string, nodes: SidebarNode[]): boolean {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.type === 'group') {
        if (node.id === groupId) {
          nodes.splice(i, 1, ...node.children);
          return true;
        }
        if (this.#disbandGroupIn(groupId, node.children)) return true;
      }
    }
    return false;
  }

  // {url,title} каждой листовой вкладки группы (рекурсивно, split-pair — обе половины) — для
  // «Скопировать содержимое» в ПКМ-меню группы (main.ts::GROUP_SHOW_MENU). title падает на url,
  // если страница ещё не отдала заголовок (см. #tabTitle) — пустой текст ссылки хуже, чем URL дважды.
  setGraphMenuBuilder(
    fn: (items: Array<{ url: string; title: string }>, sticker?: string) => MenuItemConstructorOptions | null,
  ): void {
    this.#graphMenuBuilder = fn;
  }

  // WebContents уже открытой вкладки с этим адресом. Нужен извлечению (NotebookExtract):
  // страница у пользователя УЖЕ прошла антибот, капчу и логин и полностью дорисована —
  // открывать её второй раз в скрытой вью значит начинать всё это заново и упираться в
  // защиту от ботов на ровном месте. Спящие вкладки пропускаем: у них нет вью, и будить
  // их ради извлечения — сюрприз для пользователя.
  //
  // Сначала точное совпадение, потом по origin+pathname: у товарных ссылок хвост запроса
  // (utm, spm, sku_id) меняется от клика к клику, а страница за ними одна и та же.
  getWebContentsForUrl(url: string): WebContents | null {
    const norm = (u: string): string => {
      try { const p = new URL(u); return p.origin + p.pathname.replace(/\/+$/, ''); } catch { return u; }
    };
    const wanted = norm(url);
    let fallback: WebContents | null = null;
    for (const tab of this.tabMap.values()) {
      if (!tab.view || tab.sleeping || tab.view.webContents.isDestroyed()) continue;
      const current = tab.view.webContents.getURL();
      if (!/^https?:\/\//i.test(current)) continue;
      if (current === url) return tab.view.webContents;
      if (!fallback && norm(current) === wanted) fallback = tab.view.webContents;
    }
    return fallback;
  }

  // Принадлежит ли этот webContents вкладке ЭТОГО окна. Нужно запросам разрешений: они
  // приходят от страницы, а показать вопрос надо в том окне, где она открыта (см.
  // PermissionPopoverManager). Сравниваем по id, а не по объекту: у Chromium запрос приходит
  // с «сырым» wc, и объект может быть не тем же самым обёрточным экземпляром.
  ownsWebContents(wcId: number): boolean {
    for (const tab of this.tabMap.values()) {
      const wc = tab.view?.webContents;
      if (wc && !wc.isDestroyed() && wc.id === wcId) return true;
    }
    return false;
  }

  // ── Умное имя вкладки (см. electron/TabRenamer.ts) ─────────────────────────
  // Сам текст придумывает модель в main; сюда приезжает готовый результат. Менеджер вкладок про
  // модель не знает — тот же приём, что с пунктом графа в меню (setGraphMenuBuilder).
  setAiTitle(id: string, title: string | null): void {
    const tab = this.tabMap.get(id) ?? this.pinnedTabs.find((t) => t.id === id);
    if (!tab) return;
    tab.aiTitle = title ?? undefined;
    this.onChange();
  }

  getAiTitle(id: string): string | null {
    const tab = this.tabMap.get(id) ?? this.pinnedTabs.find((t) => t.id === id);
    return tab?.aiTitle ?? null;
  }

  // WebContents вкладки — нужен переименованию, чтобы прочитать содержимое страницы.
  getWebContentsForTab(id: string): WebContents | null {
    const tab = this.tabMap.get(id) ?? this.pinnedTabs.find((t) => t.id === id);
    const wc = tab?.view?.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  // Имя группы для подписи стикера при «Добавить в граф» (main.ts::GROUP_SHOW_MENU).
  getGroupTitle(groupId: string): string | null {
    return this.#findGroupById(groupId)?.label ?? null;
  }

  getGroupContents(groupId: string): Array<{ url: string; title: string }> {
    const group = this.#findGroupById(groupId);
    if (!group) return [];
    const result: Array<{ url: string; title: string }> = [];
    for (const tab of this.#flattenNodes(group.children)) {
      const url = this.#tabUrl(tab);
      if (!/^https?:\/\//i.test(url)) continue; // псевдо-вкладки/ещё не открывшиеся сюда попасть не должны, но не доверяем вслепую
      result.push({ url, title: this.#tabTitle(tab) || url });
    }
    return result;
  }

  // Закрывает группу целиком: каждую листовую вкладку — через штатный closeTab() (снимает
  // WebContentsView, разбирает split-pair, чистит tabMap), узел группы не трогаем напрямую —
  // closeTab() уже вызывает #pruneEmptyGroups(this.nodes) на каждом вызове, последний оставшийся
  // ребёнок уберёт опустевшую группу сам. Снимок листьев берём ДО цикла: closeTab мутирует
  // group.children на каждой итерации (в т.ч. может разобрать split-pair на два SingleNode).
  // closeTab() также вызывает clearOrganizeSnapshot() на каждом шаге — organizeRollback() после
  // этого недоступен (hasOrganizeSnapshot()===false), «Вернуть» не спутать с отменой закрытия.
  closeGroupAndTabs(groupId: string): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    const tabs = this.#flattenNodes(group.children);
    for (const tab of tabs) this.closeTab(tab.id);
  }

  // Перестановка детей внутри группы (аналог reorderTabs для group.children).
  reorderGroupChildren(groupId: string, orderedIds: string[]): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    this.clearOrganizeSnapshot();
    const childMap = new Map<string, SidebarNode>();
    for (const child of group.children) {
      if (child.type === 'single')     childMap.set(child.tabId, child);
      else if (child.type === 'split-pair') childMap.set(child.leftTabId, child);
      else if (child.type === 'group') childMap.set(`group:${child.id}`, child);
    }
    const allIds = [...childMap.keys()];
    const seen = new Set<string>();
    const deduped = orderedIds.filter((id) => childMap.has(id) && (seen.has(id) ? false : (seen.add(id), true)));
    const missing = allIds.filter((id) => !seen.has(id));
    group.children = [...deduped, ...missing].map((id) => childMap.get(id)!);
    this.onChange();
  }

  // Возвращает true если вкладка находится в какой-либо группе.
  isTabInGroup(tabId: string): boolean {
    const found = this.#findTabParent(tabId);
    return !!found && found.parent !== this.nodes;
  }

  // Возвращает groupId если вкладка непосредственно в группе, иначе null.
  // Phase 3: группы не вложены, достаточно одного уровня.
  getTabGroupId(tabId: string): string | null {
    for (const node of this.nodes) {
      if (node.type !== 'group') continue;
      for (const child of node.children) {
        if (child.type === 'single' && child.tabId === tabId) return node.id;
        if (child.type === 'split-pair' &&
            (child.leftTabId === tabId || child.rightTabId === tabId)) return node.id;
      }
    }
    return null;
  }

  // Перезагружает все живые (не спящие) вкладки. Если domain задан — только с этим hostname
  // (и его поддоменами). Используется адблоком после смены настроек.
  reloadTabsForDomain(domain?: string): void {
    for (const tab of this.tabMap.values()) {
      if (!this.isHttpView(tab.view) || tab.sleeping) continue;
      const url = tab.view.webContents.getURL();
      if (!url) continue;
      if (domain) {
        let hostname: string;
        try { hostname = new URL(url).hostname.toLowerCase(); } catch { continue; }
        if (hostname !== domain && !hostname.endsWith('.' + domain)) continue;
      }
      tab.view.webContents.reload();
    }
  }

  // ── Split View ────────────────────────────────────────────────────────────

  // Войти в split: текущая активная вкладка → левая панель, rightId → правая.
  // Только обычные (не закреплённые, не хаб) вкладки могут участвовать.
  enterSplit(rightId: string): void {
    // Коммит 4: лимит на ОБЩЕЕ число пар снят — блокируем только если конкретно левая
    // (текущая активная) или правая вкладка УЖЕ состоит в какой-то паре (нельзя одну и
    // ту же вкладку впихнуть сразу в две). Разные вкладки без пары — новая пара разрешена,
    // существующие пары это не блокирует (мульти-сплит).
    if (this.#pairContaining(this.activeId) || this.#pairContaining(rightId)) return;
    this.clearOrganizeSnapshot();
    const rightTab = this.tabMap.get(rightId);
    if (!rightTab || (!this.isHttpView(rightTab.view) && !rightTab.sleeping) || this.isTabPinned(rightId)) return;

    const leftId = this.activeId;
    if (leftId === rightId) return;

    const leftTab = this.tabMap.get(leftId);
    if (!leftTab || (!this.isHttpView(leftTab.view) && !leftTab.sleeping) || this.isTabPinned(leftId)) return;

    // Обе вкладки должны быть в одном родительском массиве (верхний уровень или одна группа).
    const leftParent  = this.#findTabParent(leftId);
    const rightParent = this.#findTabParent(rightId);
    if (!leftParent || !rightParent || leftParent.parent !== rightParent.parent) return;

    if (rightTab.sleeping) this.wakeTab(rightId);

    const activeWc = this.getActiveWebContents();
    if (activeWc) { activeWc.stopFindInPage('clearSelection'); this.lastQuery = ''; }
    this.findBarOpen = false;
    this.onFindCloseCb();

    // Прячем ВСЁ постороннее — не только одиночные вкладки, но и панели ДРУГИХ пар, если
    // такие уже есть. Корректно и под мульти-сплит: activeId уже равен leftId (см. выше),
    // поэтому новая пара становится #activePair() автоматически — все остальные, включая
    // прежде показываемую пару (если была), уходят в парковку (их узлы остаются в дереве).
    for (const t of this.tabMap.values()) {
      if (!this.isHttpView(t.view)) continue;
      if (t.id !== leftId && t.id !== rightId) t.view.setVisible(false);
    }

    // Заменяем два SingleNode одним SplitPairNode в родительском массиве.
    const pair: SplitPairNode = { type: 'split-pair', leftTabId: leftId, rightTabId: rightId, ratio: 0.5 };
    const targetNodes = leftParent.parent;
    let pairInserted = false;
    const newNodes: SidebarNode[] = [];
    for (const node of targetNodes) {
      if (node.type === 'single' && (node.tabId === leftId || node.tabId === rightId)) {
        if (!pairInserted) { newNodes.push(pair); pairInserted = true; }
      } else {
        newNodes.push(node);
      }
    }
    if (!pairInserted) newNodes.push(pair);
    targetNodes.splice(0, targetNodes.length, ...newNodes);

    this.splitPairs.push({ leftId, rightId, activePanel: 'left', splitRatio: 0.5 });

    for (const splitId of [leftId, rightId]) {
      const splitTab = this.tabMap.get(splitId);
      if (!splitTab || !this.isHttpView(splitTab.view)) continue;
      const children = this.win.contentView.children;
      if (!children.includes(splitTab.view)) this.win.contentView.addChildView(splitTab.view);
    }

    // Левая панель встаёт на место сразу (одна смена размера), правая приезжает из-за
    // правого края — так появление сплита читается как действие, а не как щелчок.
    this.repositionViews();
    const right = this.getTabViewBounds(rightId);
    this.slideIn(rightId, right, this.bounds.x + this.bounds.width);
    this.onChange();
    this.focusActiveView();
  }

  // Выйти из split пары, содержащей tabId (резолв через #pairContaining — любая из двух
  // панелей подходит), keepId — какую панель НАЙДЕННОЙ пары оставить активной (по умолчанию —
  // её текущая активная панель); имеет смысл только когда пара и так показываемая, семантически
  // отдельно от tabId. Явный выход: пара удаляется из splitPairs насовсем. Отличается от «ухода»
  // (activate другой вкладки), который оставляет пару в коллекции для последующего восстановления.
  //
  // Раньше резолвили пару через #activePair() (по activeId) — кнопка "Выйти из split" в сайдбаре
  // технически достижима и на строке ПРИПАРКОВАННОЙ пары (см. Sidebar.tsx::SortablePairBlock
  // leftShowExit = leftActive || !rightActive), и с #activePair() клик по ней тихо разбирал
  // ПОКАЗЫВАЕМУЮ пару вместо той, на которой кликнули. #pairContaining(tabId) резолвит именно
  // кликнутую пару; #activePair() ниже используется только чтобы отличить показываемую пару
  // (полный флоу с фокусом/вьюхами) от припаркованной (чисто структурный разбор, см. ветку ниже
  // — тот же паттерн, что уже в togglePin/closeTab).
  exitSplit(tabId: string, keepId?: string): void {
    const pair = this.#pairContaining(tabId);
    if (!pair) return;
    this.clearOrganizeSnapshot();
    const { leftId, rightId, activePanel } = pair;

    if (pair !== this.#activePair()) {
      // Припаркованная (не показываемая) пара: разбираем канонически (→ два SingleNode),
      // текущий показ не трогаем — её вьюхи уже скрыты с момента парковки, activeId в этой
      // паре не участвует (иначе она была бы #activePair()).
      this.#dissolveSplitPair(leftId, rightId);
      this.splitPairs = this.splitPairs.filter((p) => p !== pair);
      this.onChange();
      return;
    }

    // Показываемая пара — прежняя логика без изменений (фокус/видимость/bounds).
    // Всегда разворачиваем SplitPairNode → два SingleNode (до удаления пары из коллекции).
    this.#dissolveSplitPair(leftId, rightId);
    this.splitPairs = this.splitPairs.filter((p) => p !== pair);

    const stayId = keepId ?? (activePanel === 'left' ? leftId : rightId);
    const hideId = stayId === leftId ? rightId : leftId;

    console.log(`[shutdown] exitSplit: stayId=${stayId} hideId=${hideId} winDestroyed=${this.win.isDestroyed()}`);

    // isLiveHttpView (не isHttpView) — hideId часто ИМЕННО та вкладка, что сейчас закрывается
    // через closeTab → exitSplit(otherId, otherId) (см. closeTab ниже): её webContents уже может быть
    // destroyed (window.close() из контента, напр. OAuth-логина, либо снос окна при выходе
    // браузера), а из tabMap она пока не удалена — exitSplit вызывается раньше этой уборки.
    const hideTab = this.tabMap.get(hideId);
    console.log(`[shutdown] exitSplit: hideTab exists=${!!hideTab} destroyed=${hideTab && this.isHttpView(hideTab.view) ? hideTab.view.webContents.isDestroyed() : 'no-view'}`);
    if (hideTab && this.isLiveHttpView(hideTab.view)) {
      hideTab.view.webContents.stopFindInPage('clearSelection');
      hideTab.view.setVisible(false);
    }

    this.activeId = stayId;
    const stayTab = this.tabMap.get(stayId);
    console.log(`[shutdown] exitSplit: stayTab exists=${!!stayTab} destroyed=${stayTab && this.isHttpView(stayTab.view) ? stayTab.view.webContents.isDestroyed() : 'no-view'}`);
    if (stayTab && this.isLiveHttpView(stayTab.view) && !this.errors.has(stayId)) {
      const children = this.win.contentView.children;
      if (!children.includes(stayTab.view)) this.win.contentView.addChildView(stayTab.view);
      stayTab.view.setVisible(true);
      this.applyBounds(stayTab.view);
    }

    this.onChange();
    this.focusActiveView();
  }

  // Установить соотношение панелей split (вызывается при drag разделителя) — относится
  // к ПОКАЗЫВАЕМОЙ паре (renderer-контракт без id пары, drag-разделитель виден только
  // у той, что сейчас на экране). Нет показываемой пары — no-op.
  setSplitRatio(ratio: number): void {
    const pair = this.#activePair();
    if (!pair) return;
    const clamped = Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
    pair.splitRatio = clamped;
    // Синхронизируем с SplitPairNode, чтобы следующий сейв взял актуальный ratio.
    const { leftId, rightId } = pair;
    const found = this.#findTabParent(leftId);
    if (found) {
      const node = found.parent[found.idx];
      if (node.type === 'split-pair' && node.leftTabId === leftId && node.rightTabId === rightId) {
        node.ratio = clamped;
      }
    }
    this.repositionViews();
  }

  // Переключить фокус между левой и правой панелью split — та же логика: относится
  // к ПОКАЗЫВАЕМОЙ паре. Нет показываемой пары — no-op.
  focusSplitPanel(side: 'left' | 'right'): void {
    const pair = this.#activePair();
    if (!pair) return;
    const newId = side === 'left' ? pair.leftId : pair.rightId;
    if (this.activeId === newId) return;
    this.onActiveTabChangedCb?.(); // та же логика, что и в activate() — активная панель реально меняется

    // Останавливаем поиск на панели, с которой уходим.
    const prevWc = this.getActiveWebContents();
    if (prevWc) { prevWc.stopFindInPage('clearSelection'); this.lastQuery = ''; }
    this.findBarOpen = false;

    pair.activePanel = side;
    this.activeId = newId;
    const tab = this.tabMap.get(newId);
    if (tab) tab.lastActiveAt = Date.now();
    this.onChange();
    this.focusActiveView();
  }

  // Визуальный порядок вкладок: хаб → закреплённые → узлы (flat).
  // Используется Ctrl+1–9 и Ctrl+Tab; совпадает с порядком сайдбара.
  private tabsInVisualOrder(withHub: boolean): ManagedTab[] {
    const normal = this.#flattenNodes();
    if (!withHub) return [...this.pinnedTabs, ...normal];
    return [this.hubTab, ...this.pinnedTabs, ...normal];
  }

  selectNext(): void {
    const ordered = this.tabsInVisualOrder(true);
    const idx = ordered.findIndex((t) => t.id === this.activeId);
    this.activate(ordered[(idx + 1) % ordered.length].id);
  }

  selectPrev(): void {
    const ordered = this.tabsInVisualOrder(true);
    const idx = ordered.findIndex((t) => t.id === this.activeId);
    this.activate(ordered[(idx - 1 + ordered.length) % ordered.length].id);
  }

  navigate(id: string, input: string) {
    // Хаб: навигация = создать новую вкладку.
    if (id === HUB_ID) { this.createTab(this.resolveInput(input)); return; }
    const tab = this.tabMap.get(id);
    if (!tab) return;
    const target = this.resolveInput(input);
    if (!this.isHttpView(tab.view) && !tab.sleeping) {
      this.createTab(target);
      return;
    }
    if (tab.sleeping) {
      this.wakeTab(id);
      this.activate(id);
      const freshTab = this.tabMap.get(id);
      if (freshTab && this.isHttpView(freshTab.view)) freshTab.view.webContents.loadURL(target);
      return;
    }
    tab.view!.webContents.loadURL(target);
  }

  goBack(id: string) {
    const t = this.tabMap.get(id);
    if (this.isHttpView(t?.view ?? null) && t!.view!.webContents.canGoBack())
      t!.view!.webContents.goBack();
  }
  goForward(id: string) {
    const t = this.tabMap.get(id);
    if (this.isHttpView(t?.view ?? null) && t!.view!.webContents.canGoForward())
      t!.view!.webContents.goForward();
  }
  reload(id: string) {
    const t = this.tabMap.get(id);
    if (!this.isHttpView(t?.view ?? null)) return;
    const err = this.errors.get(id);
    // После краша renderer-процесс мёртв — loadURL надёжно пересоздаёт процесс.
    if (err?.type === 'crash' && err.url) {
      t!.view!.webContents.loadURL(err.url);
    } else {
      t!.view!.webContents.reload();
    }
  }

  // ── Поиск по странице ────────────────────────────────────────────────────
  // Публичный (не private) — единственная точка, где AiPanelManager.ts достаёт WebContents
  // активной вкладки для извлечения текста страницы в контекст чата (Заход 4). Само поведение
  // метода не менялось ни на строку — только видимость.
  getActiveWebContents() {
    const tab = this.tabMap.get(this.activeId);
    return tab && this.isHttpView(tab.view) ? tab.view.webContents : null;
  }

  // Менеджер паролей, шаг 2 — адресная отправка заполнения строго ОДНОЙ вкладке (не broadcast).
  // Используется PasswordAutofillManager.ts после явного клика пользователя в поповере — только
  // fill, страница сама решает, что делать с полями (submit никогда не вызывается нами).
  // username отсутствует (не пустая строка, а именно отсутствует) — не трогать поле логина,
  // см. handleGenerateAndFill(): генератор пишет только пароль, не должен затирать то, что
  // пользователь уже успел ввести в поле логина.
  // onlyIfEmpty — автозаполнение без клика (PasswordAutofillManager.handleFormDetected): страница
  // НЕ должна затирать уже введённое пользователем, preload-content пропустит непустые поля.
  sendPasswordFill(tabId: string, payload: { username?: string; password: string; onlyIfEmpty?: boolean }): boolean {
    const tab = this.tabMap.get(tabId);
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    wc.send(IPC.PASSWORDS_FILL, payload);
    return true;
  }

  // Автозаполнение — карта «категория поля → значение» уходит в конкретную гостевую вкладку (не
  // broadcast). preload-content заполнит только те поля, что нашёл, и только в top-frame.
  sendAutofillFill(tabId: string, fields: Record<string, string>): boolean {
    const tab = this.tabMap.get(tabId);
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    wc.send(IPC.AUTOFILL_FILL_FIELDS, fields);
    return true;
  }

  findInPage(query: string, forward: boolean): void {
    const wc = this.getActiveWebContents();
    if (!wc) return;
    // findNext:true = продолжить существующий поиск; false = начать новый.
    const startsNew = query !== this.lastQuery;
    wc.findInPage(query, { forward, findNext: !startsNew });
    // ⚠️ Electron 40 НЕ шлёт `found-in-page` на начало нового поиска (findNext:false) — вообще
    // никогда, ни через секунду, ни через десять. Замерено в голом Electron, без нашего кода:
    // одиночный findNext:false молчит во всех случаях, а «продолжение» отвечает мгновенно.
    // Из-за этого счётчик «3 / 12» не появлялся, пока человек не нажмёт Enter: первый — набор
    // запроса — как раз и есть новый поиск. Лечится вторым вызовом того же запроса с
    // findNext:true: он отвечает, а активное совпадение при этом остаётся ПЕРВЫМ (проверено на
    // странице с тремя вхождениями: matches=3, activeMatchOrdinal=1) — то есть на подсветку и
    // порядок обхода обход не влияет, только возвращает нам ответ.
    if (startsNew) wc.findInPage(query, { forward, findNext: true });
    this.lastQuery = query;
  }

  findNext(forward: boolean): void {
    const wc = this.getActiveWebContents();
    if (!wc || !this.lastQuery) return;
    wc.findInPage(this.lastQuery, { forward, findNext: true });
  }

  /**
   * Подсветка ЦИТАТЫ, выбранной смысловым поиском (см. SmartFind.ts). Кандидаты идут от длинного
   * к короткому: цитата собрана из innerText со схлопнутыми пробелами, а на странице тот же текст
   * бывает разорван вёрсткой — длинный вариант тогда не находится, короткий находится.
   *
   * Возвращает число совпадений (0 — не нашлось ни одним вариантом). Дальше поиск живёт как
   * обычный: lastQuery выставлен, стрелки/Enter в панели листают совпадения штатным findNext.
   */
  async findQuoteInPage(candidates: string[]): Promise<number> {
    const wc = this.getActiveWebContents();
    if (!wc) return 0;
    for (const q of candidates) {
      const matches = await this.#findOnce(wc, q);
      // Лог по каждому кандидату: без него «не нашлось» неотличимо от «модель выбрала не то»,
      // а это два разных дефекта в двух разных местах.
      console.log(`[smart-find] подсветка ${q.length} симв. «${q.slice(0, 40)}…» → ${matches}`);
      if (matches > 0) {
        this.lastQuery = q;
        return matches;
      }
    }
    // Не нашлось ничем — снимаем выделение, иначе на странице осталась бы подсветка от
    // предыдущего, уже неактуального запроса.
    try { wc.stopFindInPage('clearSelection'); } catch { /* вкладка могла закрыться */ }
    this.lastQuery = '';
    return 0;
  }

  // Один заход findInPage с ожиданием ответа. ⚠️ Ждём именно finalUpdate и сверяем requestId:
  // Chromium шлёт found-in-page несколько раз по ходу обхода документа, и промежуточные значения
  // счётчика ещё не окончательны. Таймаут — страховка от страницы, которая ответ не пришлёт
  // вовсе (навигация прямо во время поиска): без него промис завис бы, а с ним человек получит
  // честное «не нашлось».
  #findOnce(wc: WebContents, query: string): Promise<number> {
    return new Promise((resolve) => {
      let requestId = 0;
      let done = false;
      const finish = (n: number) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        wc.removeListener('found-in-page', onFound);
        resolve(n);
      };
      const onFound = (_e: unknown, r: Electron.Result) => {
        if (r.requestId !== requestId || !r.finalUpdate) return;
        finish(r.matches);
      };
      const timer = setTimeout(() => {
        // Отличать «ноль совпадений» от «Chromium вообще не ответил» обязательно: для человека
        // это одинаковое «не нашлось», а для починки — два разных места.
        console.warn(`[smart-find] found-in-page не пришёл за ${FIND_QUOTE_TIMEOUT_MS} мс`);
        finish(0);
      }, FIND_QUOTE_TIMEOUT_MS);
      wc.on('found-in-page', onFound);
      try {
        // Пара вызовов, а не один — см. подробный разбор в findInPage выше: на одиночный
        // «начать новый поиск» Electron 40 не отвечает никогда, и ждать тут было бы нечего.
        // Ответ приходит на ВТОРОЙ вызов, его requestId и сверяем.
        wc.findInPage(query, { forward: true, findNext: false });
        requestId = wc.findInPage(query, { forward: true, findNext: true });
      } catch {
        finish(0);
      }
    });
  }

  stopFind(): void {
    const wc = this.getActiveWebContents();
    if (wc) wc.stopFindInPage('clearSelection');
    this.lastQuery = '';
    this.findBarOpen = false;
  }

  // ── Зум активной вкладки ──────────────────────────────────────────────────
  // Хаб пропускаем: у него нет WebContentsView.
  private adjustZoom(delta: number): void {
    const tab = this.tabMap.get(this.activeId);
    if (!tab || !this.isHttpView(tab.view)) return;
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX,
      tab.view.webContents.getZoomFactor() + delta));
    tab.view.webContents.setZoomFactor(next);
  }

  private resetZoom(): void {
    const tab = this.tabMap.get(this.activeId);
    if (!tab || !this.isHttpView(tab.view)) return;
    tab.view.webContents.setZoomFactor(1.0);
  }

  // ── Ctrl+1..9: переключиться на вкладку по номеру ──
  // Счёт в визуальном порядке (закреплённые сверху, потом обычные), без хаба.
  // Ctrl+9 = всегда последняя (стандарт браузеров), Ctrl+1..8 = по индексу.
  selectByIndex(n: number): void {
    const real = this.tabsInVisualOrder(false); // без хаба
    if (real.length === 0) return;
    const target = n === 9 ? real[real.length - 1] : real[n - 1];
    if (target) this.activate(target.id);
  }

  // DevTools активной вкладки в отдельном окне (не путать с DevTools хром-слоя).
  private toggleActiveDevTools(): void {
    const wc = this.getActiveWebContents();
    if (!wc) return;
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
    } else {
      wc.openDevTools({ mode: 'detach' });
    }
  }

  // ── Хоткеи: перехватываем до рендерера, чтобы работало и на сайтах ──
  // Вызывается для каждой новой вкладки (из wirePageEvents) и для chromeView
  // (из main.ts), чтобы покрыть и страницы, и хаб.
  //
  // ВСЕ хоткеи матчим по input.code (физическая позиция клавиши), а НЕ по input.key.
  // input.key зависит от раскладки: на русской F→«а», W→«ц» и т.д.
  // Ctrl+N. Само окно этот класс не создаёт — окнами владеет main (см. createWindow), сюда
  // приходит только «человек попросил новое окно», как и с быстрым поиском по Ctrl+E.
  private onNewWindowCb: (() => void) | null = null;
  setOnBookmarkPage(cb: () => void): void { this.onBookmarkPageCb = cb; }
  setOnBookmarksOpen(cb: () => void): void { this.onBookmarksOpenCb = cb; }
  setOnNewWindow(cb: () => void): void { this.onNewWindowCb = cb; }

  // ПКМ по ссылке → «Открыть ссылку в новом окне». Тоже отдаём наружу: окно создаёт main.
  private onOpenInNewWindowCb: ((url: string) => void) | null = null;
  setOnOpenInNewWindow(cb: (url: string) => void): void { this.onOpenInNewWindowCb = cb; }

  // Ctrl+Shift+M — вернуть активную вкладку в другое окно. Про другие окна этот класс не знает
  // (реестр окон живёт в main), поэтому наружу уходит только «человек попросил вернуть вкладку»
  // с её id — тот же приём, что у Ctrl+N выше.
  private onReturnTabCb: ((tabId: string) => void) | null = null;
  setOnReturnTab(cb: (tabId: string) => void): void { this.onReturnTabCb = cb; }

  // Снимок вкладки (см. ScreenshotManager.ts). Хоткеи ловятся здесь, а не в самой карточке
  // снимка: та НЕ забирает фокус (человек мог снимать посреди набора текста), а без фокуса
  // before-input-event в ней молчит. Флаг ставит и снимает менеджер карточки — пока она жива,
  // Ctrl+S принадлежит ей, а не странице.
  private screenshotOpen = false;
  setScreenshotOpen(open: boolean): void { this.screenshotOpen = open; }
  private onScreenshotCb: (() => void) | null = null;
  private onScreenshotSaveCb: (() => void) | null = null;
  private onScreenshotCloseCb: (() => void) | null = null;
  setOnScreenshot(cb: () => void): void { this.onScreenshotCb = cb; }
  setOnScreenshotSave(cb: () => void): void { this.onScreenshotSaveCb = cb; }
  setOnScreenshotClose(cb: () => void): void { this.onScreenshotCloseCb = cb; }

  // source — откуда пришёл ввод. Слой хрома принадлежит окну навсегда и никуда не переезжает;
  // вкладка — может (см. detachTabForMove), и это решает всё, см. гвард ниже.
  registerHotkeyHandler(wc: WebContents, source: 'chrome' | 'tab' = 'tab'): void {
    wc.on('before-input-event', (event, input) => {
      // ⚠️ Тот же закон, что у mine() в wirePageEvents, только здесь он был пропущен: после
      // переезда вкладки в другое окно слушатель ПРЕЖНЕГО менеджера остаётся на её webContents
      // навсегда, снять его нечем. Без этой проверки один Ctrl+W закрывал бы вкладку и здесь,
      // и в старом окне (там — свою активную, ни в чём не виноватую), а Ctrl+T открывал бы хаб
      // в обоих. Поймано живой проверкой возврата вкладки: жест срабатывал сразу в двух окнах
      // и отменял сам себя.
      if (source === 'tab' && !this.ownsWebContents(wc.id)) return;
      if (input.type !== 'keyDown') return;
      const { code, shift } = input;

      // ── Без Ctrl ──────────────────────────────────────────────────────────
      if (!input.control) {
        // Esc: приоритет — убрать карточку снимка (она появилась последней и висит поверх всего),
        // затем закрыть FindBar; иначе — остановить загрузку страницы.
        if (code === 'Escape' && !shift) {
          if (this.screenshotOpen) {
            event.preventDefault();
            this.screenshotOpen = false;    // немедленный сброс — как у findBarOpen ниже
            this.onScreenshotCloseCb?.();
          } else if (this.findBarOpen) {
            event.preventDefault();
            this.findBarOpen = false;   // немедленный сброс, чтобы второй Esc не зацикливался
            this.onFindCloseCb();
          } else {
            const active = this.getActiveWebContents();
            if (active) { event.preventDefault(); active.stop(); }
          }
          return;
        }
        // F5: обновить активную вкладку.
        if (code === 'F5' && !shift) {
          event.preventDefault();
          this.reload(this.activeId);
          return;
        }
        // F12: DevTools активной вкладки (открыть / закрыть).
        if (code === 'F12' && !shift && !input.alt) {
          event.preventDefault();
          this.toggleActiveDevTools();
          return;
        }
        // Alt+← / Alt+→: назад / вперёд (клавиатурная альтернатива Mouse4/Mouse5).
        // Боковые кнопки мыши (XButton1/2) обрабатываются нативно через WebContentsViewAura.
        if (code === 'ArrowLeft' && input.alt && !shift) {
          event.preventDefault();
          this.goBack(this.activeId);
          return;
        }
        if (code === 'ArrowRight' && input.alt && !shift) {
          event.preventDefault();
          this.goForward(this.activeId);
          return;
        }
        return;
      }

      // ── Ctrl+... ──────────────────────────────────────────────────────────
      if (code === 'KeyT' && !shift) {
        event.preventDefault();
        this.activate(HUB_ID);             // Ctrl+T: открыть хаб
      } else if (code === 'KeyT' && shift) {
        event.preventDefault();
        this.reopenLastClosedTab();         // Ctrl+Shift+T: восстановить закрытую
      } else if (code === 'KeyN' && !shift) {
        event.preventDefault();
        this.onNewWindowCb?.();             // Ctrl+N: новое окно (main решает, какой роли)
      } else if (code === 'KeyN' && shift) {
        event.preventDefault();
        this.createTab(undefined, false, false, true); // Ctrl+Shift+N: новая вкладка инкогнито
      } else if (code === 'KeyM' && shift) {
        event.preventDefault();
        this.onReturnTabCb?.(this.activeId); // Ctrl+Shift+M: вернуть вкладку в другое окно
      } else if (code === 'KeyW' && !shift) {
        event.preventDefault();
        this.closeTab(this.activeId);       // Ctrl+W: закрыть активную (хаб защищён)
      } else if (code === 'Tab' && !shift) {
        event.preventDefault();
        this.selectNext();                  // Ctrl+Tab: следующая вкладка
      } else if (code === 'Tab' && shift) {
        event.preventDefault();
        this.selectPrev();                  // Ctrl+Shift+Tab: предыдущая вкладка
      } else if (code === 'Equal' || code === 'NumpadAdd') {
        event.preventDefault();
        this.adjustZoom(ZOOM_STEP);         // Ctrl+= / Ctrl++
      } else if (code === 'Minus' || code === 'NumpadSubtract') {
        event.preventDefault();
        this.adjustZoom(-ZOOM_STEP);        // Ctrl+-
      } else if (code === 'Digit0' || code === 'Numpad0') {
        event.preventDefault();
        this.resetZoom();                   // Ctrl+0: сбросить к 100%
      } else if (code === 'KeyF' && !shift) {
        event.preventDefault();
        this.findBarOpen = true;
        this.onFindOpenCb();                // Ctrl+F: открыть / сфокусировать FindBar
      } else if (code === 'KeyE' && !shift) {
        event.preventDefault();
        this.onQuickSearchCb?.();           // Ctrl+E: поповер быстрого поиска поверх страницы
      } else if (code === 'KeyR' && !shift) {
        event.preventDefault();
        this.reload(this.activeId);         // Ctrl+R: обновить страницу
      } else if (code === 'KeyL' && !shift) {
        event.preventDefault();
        this.onOmniboxFocusCb();            // Ctrl+L: фокус в омнибокс
      } else if (code === 'KeyH' && !shift) {
        event.preventDefault();
        this.onHistoryOpenCb?.();           // Ctrl+H: открыть панель истории
      } else if (code === 'KeyD' && !shift) {
        event.preventDefault();
        this.onBookmarkPageCb?.();          // Ctrl+D: сохранить страницу в закладки
      } else if (code === 'KeyS' && shift) {
        event.preventDefault();
        this.onScreenshotCb?.();            // Ctrl+Shift+S: снять активную вкладку
      } else if (code === 'KeyS' && !shift && this.screenshotOpen) {
        // Ctrl+S — только пока висит карточка снимка. Без неё клавиша остаётся странице:
        // перехватывать «сохранить» вообще у нас нет права, сохранения страниц в браузере нет.
        event.preventDefault();
        this.onScreenshotSaveCb?.();
      } else if (code === 'KeyO' && shift) {
        event.preventDefault();
        this.onBookmarksOpenCb?.();         // Ctrl+Shift+O: открыть раздел закладок
      } else if (code === 'KeyI' && shift) {
        event.preventDefault();
        this.toggleActiveDevTools();        // Ctrl+Shift+I: DevTools (альтернатива F12)
      } else if (code.startsWith('Digit') && !shift) {
        const n = parseInt(code[5]!, 10);   // 'Digit1'→1 … 'Digit9'→9
        if (n >= 1 && n <= 9) {
          event.preventDefault();
          this.selectByIndex(n);            // Ctrl+1..8: вкладка по номеру; Ctrl+9: последняя
        }
      }
    });
  }

  // ── Показать / скрыть вьюху активной вкладки ──
  // revealView: вызывается после did-navigate (успешная загрузка) — показываем.
  private revealView(id: string): void {
    const tab = this.tabMap.get(id);
    if (!tab || !this.isHttpView(tab.view)) return;
    const pair = this.#pairContaining(id);
    const inSplit = !!pair;
    // Партнёр ПРИПАРКОВАННОЙ (не показываемой сейчас) пары — не поднимаем его вьюху поверх
    // экрана из-за фоновой навигации. Самостоятельная гарантия здесь, не только у вызывающего
    // кода (did-navigate уже фильтрует, но revealView не должен на это полагаться молча).
    if (inSplit && pair !== this.#activePair()) return;
    const children = this.win.contentView.children;
    if (!children.includes(tab.view)) this.win.contentView.addChildView(tab.view);
    tab.view.setVisible(true);
    // В (активной) паре: перепозиционируем обе панели (bounds мог прийти раньше вьюхи).
    if (inSplit) {
      this.repositionViews();
    } else {
      this.applyBounds(tab.view);
    }
  }

  // hideView: вызывается при ошибке/краше — скрываем, React нарисует экран ошибки.
  private hideView(id: string): void {
    const tab = this.tabMap.get(id);
    if (!tab || !this.isHttpView(tab.view)) return;
    tab.view.setVisible(false);
  }

  // ── AI-группировка вкладок (Phase 4) ──────────────────────────────────────

  hasOrganizeSnapshot(): boolean {
    return this.organizeSnapshot !== null;
  }

  hasRenameSnapshot(): boolean {
    return this.renameSnapshot !== null;
  }

  // Запомнить нынешние имена перед пачкой переименований. ⚠️ Пишем и undefined тоже: «имени не
  // было» — это состояние, к которому надо уметь вернуться, а не отсутствие записи.
  beginRenameBatch(ids: string[]): void {
    const snap = new Map<string, string | undefined>();
    for (const id of ids) {
      const tab = this.tabMap.get(id) ?? this.pinnedTabs.find((t) => t.id === id);
      if (tab) snap.set(id, tab.aiTitle);
    }
    this.renameSnapshot = snap;
  }

  rollbackRenames(): void {
    if (!this.renameSnapshot) return;
    for (const [id, prev] of this.renameSnapshot) {
      const tab = this.tabMap.get(id) ?? this.pinnedTabs.find((t) => t.id === id);
      if (tab) tab.aiTitle = prev;
    }
    this.renameSnapshot = null;
    this.onChange();
  }

  // Список вкладок, которым имеет смысл придумывать имя: обычные страницы, без хаба,
  // псевдо-вкладок и уже переименованных вручную в этом заходе.
  renamableTabIds(): string[] {
    const ids: string[] = [];
    for (const tab of [...this.pinnedTabs, ...this.tabMap.values()]) {
      if (tab.kind || tab.id === HUB_ID) continue;
      const url = tab.sleeping?.url ?? (this.isHttpView(tab.view) ? tab.view.webContents.getURL() : '');
      if (!/^https?:/i.test(url)) continue;
      if (!ids.includes(tab.id)) ids.push(tab.id);
    }
    return ids;
  }

  // Материал для имени: у живой вкладки — её webContents, у спящей — только адрес и заголовок
  // (будить вкладку ради подписи нельзя, это вернуло бы к жизни десятки страниц разом).
  renameSourceFor(id: string): { wc: WebContents | null; title: string; url: string } | null {
    const tab = this.tabMap.get(id) ?? this.pinnedTabs.find((t) => t.id === id);
    if (!tab) return null;
    if (tab.sleeping) return { wc: null, title: tab.sleeping.title, url: tab.sleeping.url };
    const wc = tab.view?.webContents;
    if (!wc || wc.isDestroyed()) return null;
    return { wc, title: wc.getTitle(), url: wc.getURL() };
  }

  // Очищает снимок; вызывается в начале каждого структурного метода (drag, создание/удаление группы и т.п.),
  // чтобы баннер «Вернуть» пропал при любом ручном изменении топологии.
  private clearOrganizeSnapshot(): void {
    this.organizeSnapshot = null;
  }

  // Применяет предложенные кластеры: сохраняет снимок nodes, создаёт GroupNode-ы,
  // проверяет инвариант tabMap.size. При нарушении — откат без onChange-петли.
  applyOrganize(clusters: import('../shared/ipc').OrganizeCluster[]): void {
    if (clusters.length === 0) return;

    // Глубокая копия через JSON: SidebarNode сериализуем по определению.
    this.organizeSnapshot = JSON.parse(JSON.stringify(this.nodes)) as SidebarNode[];

    const toGroup = new Set<string>();
    for (const c of clusters) for (const id of c.nodeIds) toGroup.add(id);

    // Узлы, не входящие ни в одну предложенную группу, остаются на верхнем уровне.
    const remaining: SidebarNode[] = this.nodes.filter((node) => {
      if (node.type === 'single')     return !toGroup.has(node.tabId);
      if (node.type === 'split-pair') return !toGroup.has(node.leftTabId);
      return true; // существующие GroupNode — не трогаем
    });

    // Строим новые GroupNode по предложениям кластеризации.
    const newGroups: GroupNode[] = [];
    for (const c of clusters) {
      const children: SidebarNode[] = [];
      for (let i = 0; i < c.nodeIds.length; i++) {
        const nodeId = c.nodeIds[i]!;
        const ntype  = c.nodeTypes[i]!;
        if (ntype === 'single') {
          children.push({ type: 'single', tabId: nodeId });
        } else {
          // split-pair: берём оригинальный узел чтобы сохранить ratio
          const orig = (this.organizeSnapshot as SidebarNode[]).find(
            (n): n is SplitPairNode => n.type === 'split-pair' && n.leftTabId === nodeId,
          );
          if (orig) children.push({ ...orig });
        }
      }
      if (children.length === 0) continue;
      newGroups.push({
        type: 'group', id: randomUUID(),
        label: c.label, color: null, collapsed: true, children,
      });
    }

    this.nodes = [...remaining, ...newGroups];

    // Инвариант: каждый таб в tabMap должен присутствовать ровно один раз.
    const flatCount = this.#flattenNodes().length;
    if (this.pinnedTabs.length + flatCount !== this.tabMap.size) {
      console.error(
        `[TabManager] applyOrganize: инвариант нарушен ` +
        `(tabMap=${this.tabMap.size}, pinned=${this.pinnedTabs.length}, flat=${flatCount}). Откат.`,
      );
      this.nodes = this.organizeSnapshot;
      this.organizeSnapshot = null;
      this.onChange();
      return;
    }

    this.onChange();
  }

  // Возвращает nodes к состоянию до последней AI-группировки.
  rollbackOrganize(): void {
    if (!this.organizeSnapshot) return;
    this.nodes = this.organizeSnapshot;
    this.organizeSnapshot = null;
    this.onChange();
  }

  // ── Геометрия "дырки" под контент ──
  // Просьба к странице увести/вернуть кадр из окошка поверх окон. ⚠️ Второй аргумент
  // executeJavaScript означает «это действие человека»: без него запрос на
  // Picture-in-Picture отклоняется — API требует жеста, а переключение вкладки им и было.
  // Ошибки глушим намеренно: у страницы может не быть видео вовсе, и это норма.
  private sendPip(tabId: string, script: string): void {
    const tab = this.tabMap.get(tabId);
    if (!tab || !this.isHttpView(tab.view)) return;
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) return;
    wc.executeJavaScript(script, true).catch(() => { /* нет видео — обычное дело */ });
  }

  // Вью, которая сейчас въезжает, — repositionViews её не трогает, иначе первый же
  // ResizeObserver рендерера поставил бы её на место посреди движения.
  private slidingId: string | null = null;

  // Въезд панели сплита справа. ⚠️ Двигаем ТОЛЬКО x, размер задан сразу конечный: смена
  // размера заставляет страницу пересчитывать вёрстку на каждом кадре (два тяжёлых сайта
  // разом — гарантированные рывки), а сдвиг по горизонтали для страницы бесплатен, она о
  // нём вовсе не знает. Поэтому панель не «разворачивается», а именно приезжает.
  private slideIn(tabId: string, to: ContentBounds, fromX: number): void {
    const tab = this.tabMap.get(tabId);
    if (!tab || !this.isHttpView(tab.view)) return;
    const view = tab.view;
    const DUR = 240;
    const start = Date.now();
    this.slidingId = tabId;

    const step = (): void => {
      if (this.slidingId !== tabId || view.webContents.isDestroyed()) return;
      const t = Math.min(1, (Date.now() - start) / DUR);
      // Та же кривая, что у --ease-out в токенах: быстрый старт, мягкая остановка.
      const e = 1 - Math.pow(1 - t, 3);
      const x = Math.round(fromX + (to.x - fromX) * e);
      view.setBounds({ x, y: Math.round(to.y), width: Math.round(to.width), height: Math.round(to.height) });
      if (t < 1) setTimeout(step, 16);
      else this.slidingId = null;
    };
    view.setBounds({ x: Math.round(fromX), y: Math.round(to.y), width: Math.round(to.width), height: Math.round(to.height) });
    view.setBorderRadius(CONTENT_CORNER_RADIUS);
    setTimeout(step, 16);
  }

  setContentBounds(b: ContentBounds) {
    this.bounds = b;
    this.repositionViews();
  }

  // Актуальные оконные bounds вьюхи КОНКРЕТНОЙ вкладки — то же вычисление, что repositionViews
  // использует для split. Нужно PasswordAutofillManager.ts: координаты поля пароля, которые
  // приходит из preload-content.ts (getBoundingClientRect гостя), заданы относительно вьюпорта
  // СТРАНИЦЫ — чтобы получить оконные координаты для поповера паролей, нужно прибавить именно
  // этот оффсет, а не общий this.bounds (в split-режиме вкладка занимает только половину).
  getTabViewBounds(tabId: string): ContentBounds {
    // Пара, содержащая tabId, должна быть ИМЕННО показываемой (#activePair()) — таб из
    // припаркованной пары не занимает половину экрана визуально, для него полагается
    // полный this.bounds, как для обычной невидимой вкладки.
    const pair = this.#pairContaining(tabId);
    if (!pair || pair !== this.#activePair()) return this.bounds;
    const { leftId, splitRatio } = pair;
    const leftWidth = Math.floor((this.bounds.width - ISLAND_GAP) * splitRatio);
    // +/-SPLIT_HEADER_HEIGHT: над каждой split-панелью — полоса заголовка (favicon/title/×),
    // рисуется React в App.tsx в освободившейся сверху зоне (см. shared/layout.ts).
    if (tabId === leftId) {
      return {
        x: this.bounds.x, y: this.bounds.y + SPLIT_HEADER_HEIGHT,
        width: leftWidth, height: this.bounds.height - SPLIT_HEADER_HEIGHT,
      };
    }
    return {
      x: this.bounds.x + leftWidth + ISLAND_GAP, y: this.bounds.y + SPLIT_HEADER_HEIGHT,
      width: this.bounds.width - leftWidth - ISLAND_GAP, height: this.bounds.height - SPLIT_HEADER_HEIGHT,
    };
  }

  // Позиционирует видимые вьюхи согласно текущему режиму (single / split).
  // «Припаркованные» пары (есть в splitPairs, но activeId — сторонняя вкладка) ведут
  // себя как single: позиционируем только текущую активную вкладку. Раскладка остаётся
  // строго бинарной — на ОДНУ показываемую (#activePair()) пару, не на всю коллекцию.
  private repositionViews(): void {
    const pair = this.#activePair();

    if (!pair) {
      const active = this.tabMap.get(this.activeId);
      if (active && this.isHttpView(active.view) && !this.errors.has(this.activeId)) {
        this.applyBounds(active.view);
      }
      return;
    }
    // Split: разделяем bounds по текущему splitRatio с ISLAND_GAP-зазором. y/height дополнительно
    // урезаны на SPLIT_HEADER_HEIGHT сверху — та же полоса заголовка, что и в getTabViewBounds.
    const { leftId, rightId, splitRatio } = pair;
    const leftWidth = Math.floor((this.bounds.width - ISLAND_GAP) * splitRatio);
    const leftB:  ContentBounds = {
      x: this.bounds.x, y: this.bounds.y + SPLIT_HEADER_HEIGHT,
      width: leftWidth, height: this.bounds.height - SPLIT_HEADER_HEIGHT,
    };
    const rightB: ContentBounds = {
      x: this.bounds.x + leftWidth + ISLAND_GAP, y: this.bounds.y + SPLIT_HEADER_HEIGHT,
      width: this.bounds.width - leftWidth - ISLAND_GAP, height: this.bounds.height - SPLIT_HEADER_HEIGHT,
    };
    this.applySplitBounds(leftId, leftB);
    this.applySplitBounds(rightId, rightB);
  }

  // Позиционирует одну split-панель; при ошибке скрывает вьюху (React рисует TabError).
  private applySplitBounds(id: string, b: ContentBounds): void {
    if (this.slidingId === id) return;   // панель ещё въезжает — не сбивать её на месте
    const tab = this.tabMap.get(id);
    if (!tab || !this.isHttpView(tab.view)) return;
    if (this.errors.has(id)) { tab.view.setVisible(false); return; }
    const children = this.win.contentView.children;
    if (!children.includes(tab.view)) this.win.contentView.addChildView(tab.view);
    tab.view.setVisible(true);
    tab.view.setBounds({
      x: Math.round(b.x), y: Math.round(b.y),
      width: Math.max(0, Math.round(b.width)),
      height: Math.max(0, Math.round(b.height)),
    });
    tab.view.setBorderRadius(CONTENT_CORNER_RADIUS);
  }

  private applyBounds(view: WebContentsView) {
    // Полноэкранный ролик занимает ВСЁ окно, а не дырку под контент. Скругление снимаем:
    // на краю экрана оно давало бы чёрные засечки по углам кадра.
    if (this.fullscreenTabId && this.tabMap.get(this.fullscreenTabId)?.view === view) {
      const { width: w, height: h } = this.win.getContentBounds();
      view.setBounds({ x: 0, y: 0, width: w, height: h });
      view.setBorderRadius(0);
      return;
    }
    const { x, y, width, height } = this.bounds;
    view.setBounds({
      x: Math.round(x), y: Math.round(y),
      width: Math.max(0, Math.round(width)),
      height: Math.max(0, Math.round(height)),
    });
    view.setBorderRadius(CONTENT_CORNER_RADIUS);
  }
}
