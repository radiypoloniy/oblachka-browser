import { app, WebContentsView, BrowserWindow, ipcMain, net } from 'electron';
import type { LoadURLOptions, MenuItemConstructorOptions, PostBody, Referrer, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { IPC, INCOGNITO_PARTITION } from '../shared/ipc';
import { profilePartition, DEFAULT_PROFILE_ID } from '../shared/profiles';
import { getActiveProfile } from './ProfileStore';
import { closeWindowView } from './viewTeardown';
import { wirePageContextMenu } from './pageContextMenu';
import { wireWindowOpenPolicy } from './windowOpenPolicy';
import type { WindowOpenHost } from './windowOpenPolicy';
import { SplitPairRegistry } from './SplitPairRegistry';
import { startPageFind, findQuoteInWebContents } from './tabFind';
import { wireTabHotkeys } from './tabHotkeys';
import { wireTabNavigationGuard } from './tabNavigationGuard';
import { wireTabGuestSignals } from './tabGuestSignals';
import { wireTabPageLifecycle } from './tabPageLifecycle';
import { wireTabCrashEvents } from './tabCrashEvents';
import { startTabSleepTimer } from './tabSleepController';
import type { SplitPair } from './SplitPairRegistry';
import type { PageContextMenuHost } from './pageContextMenu';
import type { TabState, TabErrorState, ContentBounds, FindResult, SidebarNode, SingleNode, SplitPairNode, GroupNode, AiAction, SpecialTabKind, ClipboardLink, MediaSessionReport, MediaCommand } from '../shared/ipc';

// Разметка и ссылки скопированного куска — то, что страница присылает вместе с текстом, чтобы
// повторная копия из буфера не теряла ссылки (см. ClipboardBuffer.ts и preload-content.ts).
export interface PageCopyRich {
  html: string;
  links: ClipboardLink[];
}
import type { SessionSnapshot, SavedNode, SavedActiveRef, SavedTab } from './SessionManager';
import { PIP_ENTER_SCRIPT, PIP_EXIT_SCRIPT, runPipScript } from './videoPip';
import { getSearchEngine, DEFAULT_SEARCH_ENGINE_ID } from '../shared/searchEngines';
import type { SearchEngineId } from '../shared/searchEngines';
import { parseBangCandidate, applyBangTemplate, bangHomeUrl } from '../shared/bangs';
import { resolveOmniboxInput } from '../shared/omniboxResolve';
import type { BangStore } from './BangStore';
import { SPLIT_PANE_RADIUS, splitPaneBounds, splitIslandRects, splitPanelEntryFrom, clampSplitRatio } from '../shared/layout';
import { PANEL_SLIDE_MS, slideSplitViews, type SplitSlideMove } from './tabSplitMotion';
import { prepareSleepUnload } from './tabSleepIndex';
import { serializeNodes, countSavedTabs, buildNodesFromSaved, collectSplitPairs } from '../shared/sessionTree';
import { buildOrganizedTree } from '../shared/organizeTree';
import { collectTabIds, collectDirectGroupTabIds, findTopLevelGroupId, reorderNodes, filterNodesByTab, wrapTabInGroup, moveTabNodeToGroup, removeTabNodeFromGroup, findTabParent, groupContaining, findGroupByLabel, findGroupById, renameGroupNode, setGroupNodeColor, toggleGroupNodeCollapse, pruneEmptyGroups, insertSplitPairAt, replaceSplitPairPanelNode, setSplitPairNodeRatio, swapSplitPairNode, dissolveSplitPair, disbandGroup } from '../shared/nodeTree';
import type { TabView } from '../shared/sessionTree';
import { hostOfUrl } from '../shared/rules';
import { localPathToFileUrl } from './localFileUrl';
import { isRussianCaCandidate } from './CertificateTrust';
import { pushClosed, popClosed, peekClosed, type ClosedTab } from '../shared/closedTabStack';
// Менеджер паролей, шаг 2 — ПЕРВЫЙ preload на гостевых страницах (сканер форм, см.
// electron/preload-content.ts). Тот же приём резолва пути, что AiPanelManager.ts использует
// для preload-aipanel.js (__dirname здесь и там — один и тот же dist-electron/electron после
// компиляции, см. electron/tsconfig.json).
const CONTENT_PRELOAD_PATH = path.join(__dirname, 'preload-content.js');

// Сколько ждём загрузку страницы при переходе к источнику скопированного (см. revealCopiedText).
const REVEAL_LOAD_TIMEOUT_MS = 8000;

const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 2.5;
const ZOOM_STEP = 0.1; // 10% за шаг, как в Chrome

// Радиус скругления углов контентной вью (px). Должен совпадать с --radius-island
// в src/styles/tokens/radii.css — то же скругление, что у сайдбара/панелей острова.
// setBorderRadius — чисто визуальный вырез; хит-тест углов остаётся прямоугольным
// (штатное поведение Electron View.setBorderRadius, не дефект — см. заход).
const CONTENT_CORNER_RADIUS = 20;

// Кап на размер тела favicon перед base64-кэшированием в сессию (заход C) — без него один
// «тяжёлый» сайт (нестандартный favicon.ico на сотни КБ) непредсказуемо раздувает session.json.
const FAVICON_CACHE_MAX_BYTES = 100 * 1024; // 100 КБ сырых байт (до base64, т.е. ~133 КБ в файле)

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
  /**
   * К какому профилю принадлежит вкладка (см. shared/profiles.ts).
   *
   * ⚠️ Хранится НА ВКЛАДКЕ, а не берётся из «активного профиля» в момент обращения. Вкладка
   * живёт долго, активный профиль меняется — и вкладка обязана остаться в своей сессии, иначе
   * человек, переключившийся в другой профиль, увидит чужие куки в уже открытой вкладке.
   */
  profileId?: string;
  // Звук выключен человеком. ⚠️ Хранится ЗДЕСЬ, а не только в webContents: при усыплении вью
  // уничтожается вместе со своим состоянием, и проснувшаяся вкладка снова заорала бы.
  muted?: boolean;
  // Когда в этой вкладке в последний раз ВИДЕЛИ играющее медиа (звук от Electron или опрос кадров,
  // см. tabSleepController.ts). Даёт отсрочку MEDIA_GRACE: без неё достаточно паузы на буферизацию
  // ровно в момент минутной проверки, чтобы выгрузить вкладку посреди просмотра.
  lastMediaAt?: number;
  // Псевдо-вкладка (История/Настройки, см. createSpecialTab) — обычная запись в tabMap/nodes
  // (не синглтон-хаб: свой id, закрываемая, можно открыть несколько), но БЕЗ WebContentsView —
  // переиспользован только сам приём хаба (view: null). #tabUrl() для такой вкладки вернёт ''
  // (см. ниже) → savable()===false и isHttpView(null)===false уже естественно исключают её из
  // сессии/сна без отдельных правок в SessionManager/sleep-таймере (см. диагностику, подтверждено
  // чтением кода: serializeNodes фильтрует по savable(), sleep-таймер — по isHttpView).
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

export class TabManager {
  private win: BrowserWindow;

  // Строитель пункта «Добавить в граф» для ПКМ-меню ссылки. Ставится из main
  // (setGraphMenuBuilder): TabManager не должен знать про хранилище графов — ему отдают
  // готовый пункт меню, тот же приём, что с tabManagerRef у менеджеров вью.
  #graphMenuBuilder:
    | ((items: Array<{ url: string; title: string }>, sticker?: string) => MenuItemConstructorOptions | null)
    | null = null;

  // Правила-автоматизации (см. RuleEngine.ts). Тот же приём, что с меню графа: TabManager не
  // знает ни про хранилище правил, ни про VPN с адблоком — он лишь сообщает «вкладка пришла
  // на такой-то адрес, а до того была на таком-то сайте».
  #ruleHook: ((ev: { tabId: string; url: string; fromHost: string; incognito: boolean }) => void) | null = null;
  // Хост страницы, С КОТОРОЙ вкладка попала на текущий адрес. Нужен триггеру «перешёл по ссылке
  // с сайта X»: у навигации в самой вкладке источник — её же предыдущий адрес, а у вкладки,
  // открытой ссылкой, — адрес открывшей страницы (сеется в момент создания, см. createTab-вызовы
  // в setWindowOpenHandler и в ПКМ-меню ссылки).
  #navFrom = new Map<string, string>();
  // Кто открыл эту вкладку (дочерняя → родительская). Нужно ТОЛЬКО закрытию, см. closeTab.
  //
  // ⚠️ Связь живёт до первого переключения вкладок и стирается ЦЕЛИКОМ — это `ForgetAllOpeners`
  // из Chrome (TabStripModel). Без забывания «вернуться к родителю» срабатывало бы и через час
  // работы в открытой ссылке, когда человек давно про неё забыл, а прыжок в другой конец полосы
  // выглядит как сбой. Забываем на любом переключении, а не только на пользовательском: у нас
  // activate() зовётся и из кода, и лишний раз забыть безопаснее, чем лишний раз прыгнуть.
  #openerOf = new Map<string, string>();

  // Распознавание полей формы моделью (AutofillFieldMapper.ts). Тот же приём, что с
  // #graphMenuBuilder: менеджер вкладок про модель и кэш не знает, ему дают готовую функцию.
  // Ссылка в стороннее приложение (sbolpay:, tg:, …). Спрашивать человека и звать ОС — работа
  // main (см. ExternalProtocol.ts): менеджеру вкладок про shell.openExternal знать незачем, тот же
  // приём, что с #graphMenuBuilder и #autofillMapper.
  // ⚠️ Второй аргумент — АДРЕС СТРАНИЦЫ целиком, а не хост: хост из него считает сам
  // ExternalProtocol. Пока считали здесь, а второй путь (переход по ссылке в main.ts) — у себя,
  // два места нормализовали по-разному, и согласие «больше не спрашивать» не находилось.
  #externalOpenCb: ((url: string, fromPageUrl: string, wcId: number) => void) | null = null;
  setOnExternalOpen(cb: (url: string, fromPageUrl: string, wcId: number) => void): void {
    this.#externalOpenCb = cb;
  }

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
  // «Этот сайт нельзя выгружать из памяти» (ПКМ по вкладке → настройки). Подключается извне сразу
  // после конструктора, как и bangs выше: конструктор и без того на два десятка аргументов, а
  // изолированные стенды за флагами OBLAKO_*_TEST поднимают TabManager без настроек вовсе.
  // Не подключён — считаем, что защищённых сайтов нет: усыпление работает как раньше.
  private isNeverSleepHost: (host: string) => boolean = () => false;
  private onChange: () => void;
  private onFindResultCb: (r: FindResult) => void;
  private onFindOpenCb: () => void;
  private onFindCloseCb: () => void;
  private onOmniboxFocusCb: () => void;
  private onFocusChromeCb: () => void;
  // wc — навигировавшая вкладка, не активная (фоновая чужого профиля).
  private onNavigateCb?: (url: string, title: string, wc: WebContents) => void;
  private onTitleUpdateCb?: (url: string, title: string, wc: WebContents) => void;
  private onBeforeSleepCb?: (url: string, title: string, wc: WebContents) => Promise<boolean>;
  /** Висит ли поверх хрома модальный экран (см. setChromeModal). */
  private chromeModal = false;
  private onHistoryOpenCb?: () => void;
  // Ctrl+D / Ctrl+Shift+O. Отдельными сеттерами, а не через конструктор: закладки появились
  // позже, и расширять и без того длинный список параметров ради двух колбэков незачем.
  private onBookmarkPageCb?: () => void;
  private onBookmarksOpenCb?: () => void;
  private onQuickSearchCb?: () => void;
  private onFirstTabLoadCb?: () => void;
  // Общий колбэк для ВСЕХ AI-действий над выделением (перевод/выжимка/пересказ/объяснение) — та же
  // труба «координаты → Qwen → поповер», разные action только меняют промпт (см. TranslationService.ts).
  // canReplace — текст взят из поля ввода и его можно вернуть обратно (см. EDIT_FIELD_CAPTURE_SCRIPT
  // в pageContextMenu.ts).
  private onAiActionCb?: (action: AiAction, text: string, rect: SelectionRect, wc: WebContents, canReplace?: boolean, targetLang?: string) => void;
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
  // Поповер паролей, заякоренный на поле (не на тулбар) — rect в координатах вьюпорта СТРАНИЦЫ,
  // main сам транслирует в оконные через getTabViewBounds() (см. PasswordAutofillManager.ts).
  // ⚠️ Поводов два — значок-ключ и клик в само пустое поле, — но права у них ОДИНАКОВЫЕ:
  // подставить сохранённое либо придумать новый пароль. Разными каналами они приезжают потому,
  // что у клика в поле свои гейты на стороне страницы (жест, пустое поле, isTrusted).
  private onPasswordFieldAnchorCb?: (tabId: string, rect: { x: number; y: number; width: number; height: number }, url: string) => void;
  // Автозаполнение форм — фокус на поле адреса/карты (см. wirePageEvents). url — из wc.getURL().
  private onAutofillFieldFocusCb?: (tabId: string, rect: { x: number; y: number; width: number; height: number }, kind: 'address' | 'card', url: string) => void;
  private onAutofillPasteBlobCb?: (tabId: string, text: string, rect: { x: number; y: number; width: number; height: number }) => void;
  private onPageCopyCb?: (text: string, url: string, title: string, rich?: PageCopyRich) => void;
  // «Сохранить как…»: пометить СЛЕДУЮЩУЮ загрузку этого адреса как требующую диалога. Менеджер
  // загрузок тут не хранится — умение приходит колбэком из main (тот же приём, что setGraphMenuBuilder).
  private onSaveAsCb?: (url: string) => void;
  private onClipboardToggleCb?: () => void;
  // Автозаполнение — страница просит убрать поповер (Esc, уход фокуса, прокрутка).
  private onAutofillDismissCb?: () => void;
  // Пароли — то же самое: клик мимо поля, Esc, прокрутка (см. PASSWORDS_DISMISS).
  private onPasswordDismissCb?: () => void;
  // Медиасессия страницы (см. MediaSessionManager.ts). url — из wc.getURL(), не из payload.
  private onMediaReportCb?: (tabId: string, report: MediaSessionReport, url: string) => void;
  // Автозаполнение — отправка формы с данными адреса/карты (offer-save). url — из wc.getURL().
  private onAutofillSubmitCb?: (tabId: string, kind: 'address' | 'card', fields: Record<string, string>, url: string) => void;
  // Взводится при создании инкогнито-вкладки; см. takeIncognitoClearIfDone (чистка сессии инкогнито).
  #pendingIncognitoClear = false;
  private firstTabLoaded = false; // защита: колбэк вызывается ровно один раз
  private closedTabs: ClosedTab[] = []; // стек закрытых вкладок для Ctrl+Shift+T и панели омнибокса
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
  // Пар может быть несколько, но показывается только та, где activeId — одна из двух панелей;
  // остальные припаркованы. Самой коллекцией владеет реестр, чтобы восстановление, добавление и
  // удаление не расходились по разным вариантам мутации массива.
  private readonly splitPairs = new SplitPairRegistry();

  constructor(
    win: BrowserWindow,
    onChange: () => void,
    onFindResult: (r: FindResult) => void,
    onFindOpen: () => void,
    onFindClose: () => void,
    onOmniboxFocus: () => void,
    onFocusChrome: () => void,
    onNavigate?: (url: string, title: string, wc: WebContents) => void,
    onTitleUpdate?: (url: string, title: string, wc: WebContents) => void,
    onHistoryOpen?: () => void,
    onFirstTabLoad?: () => void,
    onAiAction?: (action: AiAction, text: string, rect: SelectionRect, wc: WebContents, canReplace?: boolean, targetLang?: string) => void,
    onActiveTabChanged?: () => void,
    onTabClosed?: (wc: WebContents, tabId: string) => void,
    onContentFocus?: () => void,
    onPasswordForm?: (tabId: string, hasLoginForm: boolean, hasUsernameField: boolean, url: string) => void,
    onPasswordSubmit?: (tabId: string, username: string, password: string, url: string) => void,
    onPasswordFieldAnchor?: (tabId: string, rect: { x: number; y: number; width: number; height: number }, url: string) => void,
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
    this.onPasswordFieldAnchorCb = onPasswordFieldAnchor;
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

  /** Подключить проверку «сайт защищён от выгрузки» (см. isNeverSleepHost выше). */
  setNeverSleepCheck(fn: (host: string) => boolean): void {
    this.isNeverSleepHost = fn;
  }

  /** Хост вкладки — для пункта меню «не выгружать этот сайт». Пусто = вкладка не про сайт. */
  getTabHost(id: string): string {
    const tab = this.tabMap.get(id);
    return tab ? hostOfUrl(this.#tabUrl(tab)) : '';
  }

  // Разбор омнибокса — в shared/omniboxResolve.ts (порядок бэнг → схема → файл → хост → поиск).
  private resolveInput(input: string): string {
    return resolveOmniboxInput(input, {
      resolveBang: (s) => this.resolveBang(s),
      fileUrl: localPathToFileUrl,
      buildSearchUrl: (q) => getSearchEngine(this.searchEngineId).buildUrl(q),
    });
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
  /**
   * Принадлежит ли вкладка профилю, в котором человек сейчас находится.
   *
   * ⚠️ Вкладки чужих профилей НЕ УНИЧТОЖАЮТСЯ — они просто не попадают в снимок, то есть
   * исчезают из полосы вкладок и возвращаются при обратном переключении. Уничтожать их было бы
   * потерей работы человека: он переключился посмотреть почту, а не закрыть двадцать вкладок.
   * Видимость самих вью и так держится активной вкладкой (см. #applyLayout), поэтому фильтра
   * снимка достаточно.
   *
   * ⚠️ Вкладки БЕЗ profileId — это записи, созданные до появления профилей (и восстановленные из
   * сессии старого формата). Они принадлежат основному профилю: там их данные и лежат.
   */
  #inActiveProfile(t: ManagedTab): boolean {
    if (t.incognito) return true; // приватная вкладка видна всегда — она вне профилей
    // ⚠️ Настройки, История, Закладки, Загрузки — это ИНТЕРФЕЙС БРАУЗЕРА, а не содержимое сайта.
    // Профиля у них нет и быть не может, а спрятать их значит запереть человека: живой случай
    // 22.08 — в чужом профиле кнопка «Настройки» переставала открываться, и выйти из профиля
    // было нечем. Данные у этих экранов и так общие на всё приложение.
    if (t.kind) return true;
    const active = getActiveProfile().id;
    return (t.profileId ?? DEFAULT_PROFILE_ID) === active;
  }

  /** Есть ли у профиля хоть одна своя вкладка — нужно при переключении. */
  #firstTabOfActiveProfile(): string | null {
    for (const t of this.pinnedTabs) if (this.#inActiveProfile(t)) return t.id;
    for (const t of this.#flattenNodes()) if (this.#inActiveProfile(t)) return t.id;
    return null;
  }

  /**
   * Человек переключил профиль. Полоса вкладок обязана показать ЕГО вкладки, а активной не может
   * остаться чужая: её вью принадлежит другой сессии и в новом профиле ей делать нечего.
   */
  onProfileSwitched(): void {
    const current = this.tabMap.get(this.activeId);
    const stay = !current || this.#inActiveProfile(current);
    if (!stay) {
      const next = this.#firstTabOfActiveProfile();
      // Своих вкладок в профиле нет — открываем хаб, а не пустоту.
      this.activate(next ?? HUB_ID);
      return;
    }
    this.onChange();
  }

  snapshot(): TabState[] {
    const result: TabState[] = [];

    // Хаб
    result.push({
      id: HUB_ID, isActive: HUB_ID === this.activeId,
      tabError: null,
      url: '', title: 'Новая вкладка · AI-хаб',
      faviconUrl: null, isLoading: false,
      canGoBack: false, canGoForward: false, isHub: true, isPinned: false, audible: false, muted: false,
      splitSide: null, isSleeping: false, incognito: false, kind: 'hub',
    });

    // Закреплённые
    for (const t of this.pinnedTabs) {
      if (this.#inActiveProfile(t)) result.push(this.#tabToState(t, true));
    }

    // Обычные (через узлы)
    for (const t of this.#flattenNodes()) {
      if (this.#inActiveProfile(t)) result.push(this.#tabToState(t, false));
    }

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
        isHub: false, isPinned, splitSide: null, isSleeping: false, incognito: false, audible: false, muted: false, kind: t.kind, section: t.section,
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
        // Спящая вкладка звучать не может — её WebContentsView выгружен целиком.
        isSleeping: true, incognito: !!t.incognito, audible: false, muted: !!t.muted, kind: 'page',
      };
    }
    if (!this.isHttpView(t.view) || t.view.webContents.isDestroyed()) {
      // Хаб и псевдо-вкладки обрабатываются отдельно выше; сюда не должны попадать.
      // Уничтоженный (но ещё не вычищенный из tabMap) WebContents — тот же короткий фоллбэк.
      return {
        id: t.id, isActive: t.id === this.activeId,
        tabError: null, url: '', title: '', faviconUrl: null,
        isLoading: false, canGoBack: false, canGoForward: false,
        isHub: false, isPinned, splitSide: null, isSleeping: false, incognito: !!t.incognito, audible: false, muted: !!t.muted, kind: 'page',
      };
    }
    const wc = t.view.webContents;
    return {
      id: t.id, isActive: t.id === this.activeId,
      tabError: this.errors.get(t.id) ?? null,
      url: wc.getURL(),
      title: t.aiTitle || wc.getTitle() || wc.getURL() || 'Загрузка…',
      // data: важнее URL: blob гостя хром не откроет; пустой page-favicon-updated не затирает.
      faviconUrl: ((m) => m._oblakoFaviconData ?? (m._oblakoFavicon && /^(data:|https?:)/i.test(m._oblakoFavicon) ? m._oblakoFavicon : null))(wc as unknown as { _oblakoFavicon?: string; _oblakoFaviconData?: string }),
      isLoading: wc.isLoadingMainFrame(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isHub: false, isPinned,
      splitSide: this.#tabSplitSide(t.id),
      isSleeping: false, incognito: !!t.incognito,
      // Состояние момента: Chromium сам гасит его на паузе и в тишине между треками.
      audible: wc.isCurrentlyAudible(),
      muted: wc.isAudioMuted(),
      kind: 'page',
    };
  }

  // Плоский список ManagedTab из дерева узлов (рекурсивный — обходит группы).
  #flattenNodes(nodes: SidebarNode[] = this.nodes): ManagedTab[] {
    const result: ManagedTab[] = [];
    for (const id of collectTabIds(nodes)) {
      const tab = this.tabMap.get(id);
      if (tab) result.push(tab);
    }
    return result;
  }

  // ── Навигация по дереву узлов ───────────────────────────────────────────────
  // Сами обходы — в shared/nodeTree.ts (чистая логика под scripts/node-tree-check.mjs).
  // Здесь тонкие обёртки: они держат умолчание `= this.nodes`, ради которого десятки мест
  // вызова остались как были.
  #findTabParent(tabId: string, nodes: SidebarNode[] = this.nodes): { parent: SidebarNode[]; idx: number } | null {
    return findTabParent(tabId, nodes);
  }

  #groupContaining(tabId: string, nodes: SidebarNode[] = this.nodes): GroupNode | null {
    return groupContaining(tabId, nodes);
  }

  #findGroupByLabel(label: string, nodes: SidebarNode[] = this.nodes): GroupNode | null {
    return findGroupByLabel(label, nodes);
  }

  #findGroupById(groupId: string, nodes: SidebarNode[] = this.nodes): GroupNode | null {
    return findGroupById(groupId, nodes);
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

  // Всё, что о вкладке нужно знать сохранению сессии, одним объектом — граница между владельцем
  // состояния (здесь) и чистой раскладкой дерева (shared/sessionTree.ts).
  #tabView(tab: ManagedTab): TabView {
    const url = this.#tabUrl(tab);
    return {
      url,
      title: this.#tabTitle(tab),
      faviconData: this.#tabFaviconData(tab),
      // Короткоживущие вкладки (OAuth-попапы, см. wirePageEvents/setWindowOpenHandler) в сейв не
      // идут — при рестарте нет смысла «воскрешать» страницу логина. Инкогнито — тем более.
      savable: !tab.ephemeral && !tab.incognito && /^https?:\/\//i.test(url),
    };
  }

  // Заменяет SplitPairNode двумя SingleNode — рекурсивный поиск (пара может быть в группе).
  #dissolveSplitPair(leftId: string, rightId: string): void {
    dissolveSplitPair(leftId, rightId, this.nodes);
  }

  // Пара, которая ПОКАЗЫВАЕТСЯ сейчас — не отдельный указатель, а та единственная запись
  // в splitPairs, где activeId — одна из двух панелей. Остальные пары (если появятся) —
  // «припаркованы»: существуют в коллекции, но их вьюхи скрыты.
  #activePair(): SplitPair | undefined {
    return this.splitPairs.active(this.activeId);
  }

  // Пара, содержащая конкретный tabId (не обязательно показываемая сейчас) — для мест,
  // которым нужно "эта вкладка вообще в какой-то паре", а не "она в показываемой".
  #pairContaining(id: string): SplitPair | undefined {
    return this.splitPairs.containing(id);
  }

  // Какие вкладки ВИДНЫ, когда активна эта. Для одиночной — она сама, для панели split — обе
  // панели пары. Нужно там, где важна именно видимость, а не активность: кадр «следует за вами»
  // обязан уезжать со всего, что скрылось, и возвращаться во всё, что показалось.
  // Хаб вкладкой не является и в множество не попадает — sendPip его и так не знает.
  #visibleTabIds(id: string): Set<string> {
    return id && id !== HUB_ID ? this.splitPairs.visibleTabIds(id) : new Set();
  }

  // Сторона вкладки в СВОЕЙ паре (не в показываемой — TabState.splitSide отражает
  // "я вообще в сплите", парковка на это не влияет, см. Sidebar.tsx).
  #tabSplitSide(id: string): 'left' | 'right' | null {
    return this.splitPairs.sideOf(id);
  }

  // Вычисляет SavedActiveRef (v4 формат: 'url' вместо 'normal'/'split').
  // URL однозначно идентифицирует активную вкладку в подавляющем большинстве случаев.
  #computeActiveRef(): SavedActiveRef {
    if (this.activeId === HUB_ID) return { type: 'hub' };

    const pinnedIdx = this.pinnedTabs.findIndex((t) => t.id === this.activeId);
    if (pinnedIdx !== -1) return { type: 'pinned', index: pinnedIdx };

    const tab = this.tabMap.get(this.activeId);
    const url = tab ? this.#tabUrl(tab) : '';
    // Инкогнито не пишем в activeRef: иначе приватный URL оказывается в session.json на диске,
    // хотя сама вкладка в дерево не сериализуется. После рестарта это не «та же» сессия — хаб.
    if (tab?.incognito) return { type: 'hub' };
    // Активный OAuth-попап (ephemeral) сам в сейв не попадает — ссылаться на него в activeRef нельзя,
    // после рестарта такого URL в сохранённых вкладках не будет.
    if (tab && !tab.ephemeral && /^https?:\/\//i.test(url)) return { type: 'url', url };
    return { type: 'hub' }; // фоллбэк: about:blank, ephemeral или без реального URL
  }

  // Текущее дерево узлов для SYNC_CHANGED (шлём как есть из this.nodes).
  sidebarNodesSnapshot(): SidebarNode[] {
    // DBG: проверяем инвариант split-pair в момент сборки nodes-снимка.
    this.#debugCheckSplitInvariant('sidebarNodesSnapshot');
    return this.#nodesOfActiveProfile(this.nodes);
  }

  /**
   * Дерево, очищенное от вкладок чужих профилей.
   *
   * ⚠️ Пустые группы ВЫБРАСЫВАЮТСЯ, а не показываются пустыми. Живая жалоба 22.08: в новом
   * профиле вкладок нет, а папки остались — «да, пустые, но это палево». И это верно по сути:
   * имя папки («Работа», «Ипотека») само по себе рассказывает о человеке, даже когда внутри
   * ничего не видно.
   *
   * ⚠️ Режется КОПИЯ для показа, а не this.nodes: настоящее дерево хранит вкладки всех профилей
   * и обязано остаться целым, иначе переключение обратно вернуло бы пустоту.
   */
  #nodesOfActiveProfile(nodes: SidebarNode[]): SidebarNode[] {
    return filterNodesByTab(nodes, (tabId) => {
      const tab = this.tabMap.get(tabId);
      return !!tab && this.#inActiveProfile(tab);
    });
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
      // Основной профиль не пишем: это умолчание при чтении, и лишнее поле в каждой строке
      // сессии ничего не сообщает.
      if (t.profileId && t.profileId !== DEFAULT_PROFILE_ID) pin.profileId = t.profileId;
      pinnedTabs.push(pin);
    }

    // Сама раскладка дерева — в shared/sessionTree.ts (чистая логика под тестом). Отсюда туда
    // уходит только доступ к вкладкам: владелец состояния по-прежнему TabManager.
    const nodes = serializeNodes(this.nodes, {
      view: (tabId) => {
        const t = this.tabMap.get(tabId);
        return t ? this.#tabView(t) : null;
      },
      liveRatio: (leftTabId) => this.#pairContaining(leftTabId)?.splitRatio ?? null,
    });

    // Инвариант: число сериализованных вкладок == число сохраняемых вкладок tabMap.
    const expectedCount = [...this.tabMap.values()].filter(savable).length;
    const actualCount = pinnedTabs.length + countSavedTabs(nodes);

    if (actualCount !== expectedCount) {
      console.error(
        `[TabManager] инвариант сессии нарушен: ожидали ${expectedCount}, сериализовали ${actualCount}. Сохранение пропущено.`,
      );
      return null;
    }

    return { pinnedTabs, nodes, activeRef: this.#computeActiveRef() };
  }

  // Восстанавливает дерево узлов из сохранённой сессии.
  // urlToIds: URL → очередь tabId (поддерживает дубликаты URL).
  // Вызывается после создания всех вкладок через createTab, ДО activate().
  rebuildNodeTree(savedNodes: SavedNode[], urlToIds: Map<string, string[]>): void {
    this.nodes = buildNodesFromSaved(savedNodes, urlToIds);
    // Регистрируем КАЖДУЮ найденную пару, не только первую: какая окажется показываемой,
    // решает activate(targetId) через #pairContaining, а не порядок здесь.
    this.splitPairs.replace(collectSplitPairs(this.nodes)
      .map((p) => ({ leftId: p.leftId, rightId: p.rightId, activePanel: 'left' as const, splitRatio: p.ratio })));
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
    pruneEmptyGroups(nodes);
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
  // postBody и referrer — тело формы и Referer перехода, оба приходят из setWindowOpenHandler;
  // без них ломается оплата, разбор там же.
  // Выключить/включить звук вкладки. Флаг дублируется в записи вкладки, чтобы пережить
  // усыпление (вью с её состоянием уничтожается, см. ManagedTab.muted).
  setTabMuted(id: string, muted: boolean): void {
    const t = this.tabMap.get(id);
    if (!t) return;
    t.muted = muted;
    if (t.view && !t.view.webContents.isDestroyed()) t.view.webContents.setAudioMuted(muted);
    this.onChange();
  }

  createTab(
    rawUrl?: string,
    background = false,
    ephemeral = false,
    incognito = false,
    postBody?: PostBody,
    profileId?: string,
    referrer?: Referrer,
  ): string {
    const id = randomUUID();
    // ⚠️ Профиль фиксируется В МОМЕНТ СОЗДАНИЯ и дальше не меняется: партиция задаётся при
    // создании WebContentsView и переставить её у живой вьюхи нельзя.
    // ⚠️ Инкогнито сильнее профиля: приватная вкладка идёт в свою in-memory сессию, что бы
    // ни было выбрано. Иначе «приватная вкладка в профиле работа» писала бы куки на диск.
    const profile = incognito ? DEFAULT_PROFILE_ID : (profileId ?? getActiveProfile().id);
    const partition = incognito ? INCOGNITO_PARTITION : profilePartition(profile);
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
        // Профили: своя persist-партиция у каждого, КРОМЕ основного — у него partition не
        // задаётся вовсе, потому что его данные уже лежат в defaultSession (см. profilePartition).
        ...(partition ? { partition } : {}),
      },
    });
    const tab: ManagedTab = {
      id, view, sleeping: null, lastActiveAt: Date.now(), ephemeral, incognito,
      profileId: incognito ? undefined : profile,
    };
    if (incognito) this.#pendingIncognitoClear = true; // при закрытии последней приватной — чистим сессию
    this.tabMap.set(id, tab);
    this.nodes.push({ type: 'single', tabId: id });
    this.wirePageEvents(id, view);

    const target = this.resolveInput(rawUrl ?? 'about:blank');
    if (target !== 'about:blank') {
      const opts: LoadURLOptions = {};
      if (postBody) {
        // Content-Type обязателен вместе с телом: без него сервер не разберёт поля формы, и
        // отсутствие данных будет неотличимо от прежнего GET.
        opts.postData = postBody.data;
        opts.extraHeaders = 'Content-Type: ' + postBody.contentType
          + (postBody.boundary ? '; boundary=' + postBody.boundary : '');
      }
      // ⚠️ Referer берём ГОТОВЫМ, а не собираем из адреса открывшей страницы: Chromium уже применил
      // к нему её Referrer-Policy. Своя сборка утекала бы полным адресом там, где сайт просил не.
      if (referrer) opts.httpReferrer = referrer;
      view.webContents.loadURL(target, opts);
    }

    if (background) {
      this.onChange(); // показываем новую вкладку в сайдбаре без переключения
    } else {
      this.activate(id);
    }
    return id;
  }

  // ── Дубликат вкладки (ПКМ «Дублировать») ──────────────────────────────────────────────────
  // Три вещи, без которых это не дубликат, а «ещё одна вкладка с тем же адресом»:
  //  • ⚠️ Приватность НАСЛЕДУЕТСЯ. У createTab incognito — четвёртый аргумент с умолчанием false,
  //    и забыть его тут значит вынести приватную страницу в обычную сессию, то есть на диск.
  //  • Место в дереве: сразу ПОСЛЕ исходной, а не в конце списка. Уехавший в хвост дубликат на
  //    десятке вкладок человек просто не находит и жмёт «дублировать» ещё раз.
  //  • История навигации: «назад» в дубликате обязан работать так же, как в оригинале.
  // Возвращает null, когда дублировать нечего: псевдо-вкладки (История/Настройки) и хаб сайта
  // за собой не держат, #tabUrl() у них пуст.
  duplicateTab(sourceId: string): string | null {
    const src = this.tabMap.get(sourceId);
    if (!src) return null;
    const url = this.#tabUrl(src);
    if (!url) return null;

    // Закреплённая дублируется закреплённой: иначе копия молча меняет род и уезжает из ленты
    // закреплённых вниз, к обычным вкладкам, — выглядит как «кнопка сработала не туда».
    if (this.isTabPinned(sourceId)) {
      const newId = this.createPinnedTab(url);
      this.#adoptHistory(sourceId, newId);
      const from = this.pinnedTabs.findIndex((t) => t.id === newId);
      const at   = this.pinnedTabs.findIndex((t) => t.id === sourceId);
      if (from >= 0 && at >= 0) this.pinnedTabs.splice(at + (from > at ? 1 : 0), 0, ...this.pinnedTabs.splice(from, 1));
      this.activate(newId);
      return newId;
    }

    // background: активируем в самом конце, уже после перестановки узла, — иначе сайдбар успеет
    // подсветить вкладку в хвосте и тут же перерисовать её на новом месте.
    // ephemeral намеренно НЕ наследуется: этим флагом помечены попапы из window.open (их не
    // воскрешают при рестарте), а дубликат — осознанный жест человека, обычная вкладка.
    const newId = this.createTab(url, true, false, src.incognito === true);
    this.#adoptHistory(sourceId, newId);

    // createTab кладёт узел в КОНЕЦ this.nodes — переносим его вплотную к исходному. Исходная
    // может лежать в группе или быть половиной split-пары: findTabParent рекурсивен и отдаёт узел
    // ПАРЫ целиком, поэтому дубликат встаёт рядом с парой, а не внутрь неё (третьей панели в
    // split не бывает). Порядок важен: сперва вынимаем свой узел, потом ищем место, — иначе
    // найденный индекс сдвинулся бы у нас под руками.
    const from = this.nodes.findIndex((n) => n.type === 'single' && n.tabId === newId);
    if (from >= 0) {
      const [node] = this.nodes.splice(from, 1);
      const at = findTabParent(sourceId, this.nodes);
      if (at) at.parent.splice(at.idx + 1, 0, node);
      else this.nodes.push(node); // исходную закрыли, пока мы дублировали — просто вернём в конец
    }
    this.activate(newId);
    return newId;
  }

  // Переносит историю навигации из одной вкладки в другую (для duplicateTab выше).
  // ⚠️ У СПЯЩЕГО оригинала истории нет вовсе — session.json её не хранит, там только адрес. Тогда
  // дубликат остаётся с одной записью, и это ожидаемое поведение, а не сбой.
  #adoptHistory(sourceId: string, newId: string): void {
    const from = this.tabMap.get(sourceId)?.view?.webContents;
    const to   = this.tabMap.get(newId)?.view?.webContents;
    if (!from || !to || from.isDestroyed() || to.isDestroyed()) return;
    try {
      const entries = from.navigationHistory.getAllEntries();
      // Одна запись — переносить нечего: loadURL в createTab уже сделал ровно то же самое.
      if (entries.length < 2) return;
      // restore() сам навигирует на выбранный индекс и тем самым отменяет незавершённый loadURL
      // из createTab (адрес там тот же). Промис отклоняется, если страница не загрузилась, —
      // для нас это не ошибка: дубликат уже создан и виден.
      void to.navigationHistory.restore({ entries, index: from.navigationHistory.getActiveIndex() })
        .catch(() => { /* страница не догрузилась — вкладка всё равно рабочая */ });
    } catch {
      // Дубликат без истории полезнее, чем упавшее меню.
    }
  }

  // Псевдо-вкладка (История/Настройки) — тот же tabMap/nodes-путь, что у createTab выше, но
  // без WebContentsView/wirePageEvents (переиспользован только приём "view: null" от хаба, не
  // сам синглтон-механизм хаба — см. диагностику: HUB_ID жёстко захардкожен и не масштабируется
  // на несколько экземпляров, а эта вкладка — обычная запись со своим id, закрываемая, можно
  // открыть несколько сразу). #tabUrl()==='' для неё уже естественно исключает её из
  // savable()/session-снимка и isHttpView()/sleep-таймера — без отдельных правок там.
  createSpecialTab(kind: SpecialTabKind, section?: string): string {
    const id = randomUUID();
    const tab: ManagedTab = { id, view: null, sleeping: null, lastActiveAt: Date.now(), kind, section };
    this.tabMap.set(id, tab);
    this.nodes.push({ type: 'single', tabId: id });
    this.activate(id);
    return id;
  }

  // Закреп. cachedFaviconData — data: из session.json: и в URL, и в байтовый кэш ДО loadURL,
  // чтобы сайдбар не мигал буквой и пустой page-favicon-updated (SPA) не стёр заглушку.
  createPinnedTab(rawUrl: string, cachedFaviconData?: string): string {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: CONTENT_PRELOAD_PATH },
    });
    if (cachedFaviconData) {
      const w = view.webContents as unknown as { _oblakoFavicon?: string; _oblakoFaviconData?: string };
      w._oblakoFavicon = w._oblakoFaviconData = cachedFaviconData;
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
  createSleepingPinnedTab(rawUrl: string, seedTitle?: string, seedFaviconData?: string, profileId?: string): string {
    const id = randomUUID();
    const url = this.resolveInput(rawUrl);
    const tab: ManagedTab = {
      id, view: null, lastActiveAt: Date.now(),
      // ⚠️ Пусто в файле = основной профиль: там лежат данные вкладок, записанных до профилей.
      profileId: profileId ?? DEFAULT_PROFILE_ID,
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
  createSleepingTab(rawUrl: string, seedTitle?: string, seedFaviconData?: string, profileId?: string): string {
    const id = randomUUID();
    const url = this.resolveInput(rawUrl);
    const tab: ManagedTab = {
      id, view: null, lastActiveAt: Date.now(),
      profileId: profileId ?? DEFAULT_PROFILE_ID,
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
          this.splitPairs.remove(pair);
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

  // Фоновый кэш favicon → data: на webContents. Fire-and-forget: snapshot/#write синхронны
  // (в т.ч. win.on('close')), await там нельзя. Кап FAVICON_CACHE_MAX_BYTES.
  // ⚠️ fetch сессией САМОЙ вкладки (чужой профиль/инкогнито), не активного окна.
  // credentials: 'omit' — как FaviconService: куки к картинке не прикладываем.
  #cacheFaviconData(wc: WebContents, url: string): void {
    if (url.startsWith('data:')) { (wc as unknown as { _oblakoFaviconData?: string })._oblakoFaviconData = url; this.onChange(); return; }
    if (!/^(https?:|blob:)/i.test(url)) return;
    wc.session.fetch(url, { credentials: 'omit' }).then(async (res) => {
      if (!res.ok || wc.isDestroyed()) return;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > FAVICON_CACHE_MAX_BYTES || wc.isDestroyed()) return;
      if (/^<!doctype|^<html/i.test(buf.subarray(0, 64).toString('utf8').trimStart())) return;
      const contentType = res.headers.get('content-type') || 'image/x-icon';
      (wc as unknown as { _oblakoFaviconData?: string })._oblakoFaviconData =
        `data:${contentType.split(';')[0].trim() || 'image/x-icon'};base64,${buf.toString('base64')}`;
      this.onChange();
    }).catch(() => { /* сеть недоступна/CORS/т.п. — просто не кэшируем, не критично */ });
  }

  // ── Усыпление: выгружаем WebContentsView, сохраняем метаданные ──
  private sleepTab(id: string): void { void this.sleepTabAsync(id); }

  private async sleepTabAsync(id: string): Promise<void> {
    const tab = this.tabMap.get(id);
    if (!tab || !this.isHttpView(tab.view) || tab.sleeping) return;
    const wc = tab.view.webContents;
    const url = wc.getURL();
    if (!/^https?:\/\//i.test(url)) return;
    if (!(await prepareSleepUnload(this.onBeforeSleepCb, wc))) return;
    if (tab.sleeping || id === this.activeId || !this.isHttpView(tab.view)) return;
    const live = tab.view.webContents;
    if (live.isDestroyed() || !/^https?:\/\//i.test(live.getURL())) return;
    tab.sleeping = {
      url: live.getURL(),
      title: live.getTitle() || live.getURL(),
      faviconUrl: (live as unknown as { _oblakoFavicon?: string })._oblakoFavicon ?? null,
      faviconData: (live as unknown as { _oblakoFaviconData?: string })._oblakoFaviconData ?? null,
    };
    try { this.win.contentView.removeChildView(tab.view); } catch { /* noop */ }
    try { (live as unknown as { close?: () => void }).close?.(); } catch { /* noop */ }
    tab.view = null;
    this.errors.delete(id);
    this.onChange();
  }

  // ── Пробуждение: пересоздаём WebContentsView и начинаем загрузку ──
  // Синхронный: создаёт вьюху и стартует загрузку. Страница появится когда загрузится (did-navigate).
  private wakeTab(id: string): void {
    const tab = this.tabMap.get(id);
    if (!tab?.sleeping) return;
    const { url, faviconData, faviconUrl } = tab.sleeping;
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: CONTENT_PRELOAD_PATH },
    });
    const w = view.webContents as unknown as { _oblakoFavicon?: string; _oblakoFaviconData?: string };
    if (faviconData) w._oblakoFavicon = w._oblakoFaviconData = faviconData;
    else if (faviconUrl && /^(data:|https?:)/i.test(faviconUrl)) w._oblakoFavicon = faviconUrl;
    tab.sleeping = null;
    tab.view = view;
    tab.lastActiveAt = Date.now();
    this.errors.delete(id);
    this.wirePageEvents(id, view);
    // Приглушение переживает сон: вью новая, её состояние звука по умолчанию «включён», и без
    // этой строки проснувшаяся вкладка заорала бы, хотя человек её выключал.
    if (tab.muted) view.webContents.setAudioMuted(true);
    view.webContents.loadURL(url);
  }

  // ── Таймер засыпания: периодически проверяет кандидатов ──
  //
  // ⚠️ Ссылку на таймер держим ради остановки. Пока окно было одно, интервал жил столько же,
  // сколько процесс, и разницы не было. С несколькими окнами каждый открытый-и-закрытый экземпляр
  // оставлял бы после себя вечный минутный таймер, ходящий по мёртвому менеджеру, — их набирается
  // ровно столько, сколько окон человек успел закрыть за сеанс. Останавливаем в dispose().
  private sleepTimer: NodeJS.Timeout | null = null;

  // Суммарный Working Set ВСЕХ процессов приложения — своя мерка давления памяти.
  // app.getAppMetrics() отдаёт килобайты и уже включает и main, и все рендереры, и GPU.
  #appWorkingSetBytes(): number {
    let kb = 0;
    for (const m of app.getAppMetrics()) kb += m.memory.workingSetSize;
    return kb * 1024;
  }

  private startSleepTimer(): void {
    this.sleepTimer = startTabSleepTimer({
      tabs: () => this.tabMap.values(),
      tab: (id) => this.tabMap.get(id),
      activeId: () => this.activeId,
      activePair: () => this.#activePair(),
      isPinned: (id) => this.isTabPinned(id),
      isNeverSleepHost: (host) => this.isNeverSleepHost(host),
      tabUrl: (tab) => { const current = this.tabMap.get(tab.id); return current ? this.#tabUrl(current) : ''; },
      appWorkingSetBytes: () => this.#appWorkingSetBytes(),
      sleepTab: (id) => this.sleepTab(id),
    });
  }

  // Окно закрылось — менеджер больше никому не нужен. Снимаем всё, что переживает окно само по
  // себе: таймер сна и ВЬЮ ВСЕХ ВКЛАДОК.
  //
  // ⚠️ Вью закрываем руками: Electron не уничтожает их вместе с окном (замер и разбор — в
  // `viewTeardown.ts`). До этого закрытие окна с пятью вкладками оставляло пять живых процессов
  // рендерера без единого способа до них добраться. Особенно заметно стало с автозакрытием
  // опустевшего лёгкого окна: оно закрывается САМО и, значит, часто.
  //
  // ⚠️ Переданные другому окну вкладки сюда не попадают by design: `detachTabForMove` убирает их
  // из `tabMap` в момент передачи, поэтому «закрыть всё своё» не означает «закрыть чужое».
  dispose(): void {
    if (this.sleepTimer) { clearInterval(this.sleepTimer); this.sleepTimer = null; }
    // tabMap хватает: закреплённые лежат в нём тем же объектом (createPinnedTab кладёт в оба),
    // и обход обоих списков закрывал бы их дважды.
    for (const tab of this.tabMap.values()) closeWindowView(tab.view);
    this.tabMap.clear();
    this.pinnedTabs = [];
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


    // Дальше — только проводка событий, разнесённая по темам. Тела обработчиков не менялись:
    // каждый из них по-прежнему первым делом спрашивает mine() — вкладку могли передать другому
    // окну, а снять слушатели выборочно нечем (см. разбор выше).
    wireTabNavigationGuard(wc);
    wireTabGuestSignals(wc, {
      mine,
      isIncognito: () => !!this.tabMap.get(id)?.incognito,
      onPasswordForm: (hasLoginForm, hasUsernameField, url) => this.onPasswordFormCb?.(id, hasLoginForm, hasUsernameField, url),
      onPasswordSubmit: (username, password, url) => this.onPasswordSubmitCb?.(id, username, password, url),
      onPasswordFieldAnchor: (rect, url) => this.onPasswordFieldAnchorCb?.(id, rect, url),
      onMediaReport: (report, url) => this.onMediaReportCb?.(id, report, url),
      onPasswordDismiss: () => this.onPasswordDismissCb?.(),
      onAutofillFieldFocus: (rect, kind, url) => this.onAutofillFieldFocusCb?.(id, rect, kind, url),
      onAutofillPasteBlob: (text, rect) => this.onAutofillPasteBlobCb?.(id, text, rect),
      onPageCopy: (text, url, title, rich) => this.onPageCopyCb?.(text, url, title, rich),
      onAutofillDismiss: () => this.onAutofillDismissCb?.(),
      mapFields: (origin, fields) => this.#autofillMapper?.(origin, fields),
      onAutofillSubmit: (kind, fields, url) => this.onAutofillSubmitCb?.(id, kind, fields, url),
    });
    wireTabPageLifecycle(id, wc, {
      win: this.win,
      mine,
      notify,
      focusedSplitSide: () => {
        const pair = this.#pairContaining(id);
        return pair && pair === this.#activePair() && this.activeId !== id
          ? (id === pair.leftId ? 'left' : 'right') : null;
      },
      focusSplitPanel: (side) => this.focusSplitPanel(side),
      onContentFocus: () => this.onContentFocusCb?.(),
      firstTabLoaded: () => this.firstTabLoaded,
      markFirstTabLoaded: () => { this.firstTabLoaded = true; this.onFirstTabLoadCb?.(); },
      clearError: () => { this.errors.delete(id); },
      clearAiTitle: () => {
        const tab = this.tabMap.get(id) ?? this.pinnedTabs.find((t) => t.id === id);
        if (tab?.aiTitle) tab.aiTitle = undefined;
      },
      isActive: () => this.activeId === id,
      splitState: () => {
        const pair = this.#pairContaining(id);
        return { inSplit: !!pair, shownPartner: !!pair && pair === this.#activePair() };
      },
      clearFind: () => { wc.stopFindInPage('clearSelection'); this.lastQuery = ''; this.onFindCloseCb(); },
      touch: () => { const tab = this.tabMap.get(id); if (tab) tab.lastActiveAt = Date.now(); },
      reveal: () => this.revealView(id),
      incognito: () => !!this.tabMap.get(id)?.incognito,
      onNavigate: (url, title, page) => this.onNavigateCb?.(url, title, page),
      onRuleNavigate: (url) => {
        this.#ruleHook?.({ tabId: id, url, fromHost: this.#navFrom.get(id) ?? '', incognito: !!this.tabMap.get(id)?.incognito });
        this.#navFrom.set(id, hostOfUrl(url));
      },
      getFullscreenTabId: () => this.fullscreenTabId,
      setFullscreenTabId: (tabId) => { this.fullscreenTabId = tabId; },
      repositionViews: () => this.repositionViews(),
      onTitleUpdate: (url, title, page) => this.onTitleUpdateCb?.(url, title, page),
      cacheFavicon: (page, url) => this.#cacheFaviconData(page, url),
      markAudio: () => { const tab = this.tabMap.get(id); if (tab) tab.lastMediaAt = Date.now(); },
      onFindResult: (result) => this.onFindResultCb(result),
    });
    wireWindowOpenPolicy(this.#windowOpenHost, id, view);
    wireTabCrashEvents(wc, {
      mine,
      notify,
      onZoom: (direction) => this.adjustZoom(direction === 'in' ? ZOOM_STEP : -ZOOM_STEP),
      isOnline: () => net.isOnline(),
      isRussianCaCandidate,
      reportError: (error) => {
        this.errors.set(id, error);
        if (this.activeId === id || this.#pairContaining(id)) this.hideView(id);
      },
      windowDestroyed: () => this.win.isDestroyed(),
      viewStillCurrent: () => this.tabMap.get(id)?.view === view,
      closeTab: () => this.closeTab(id),
    });
    wirePageContextMenu(this.#menuHost, id, view);


    this.registerHotkeyHandler(wc);
  }

  /**
   * Хост политики окон — поле, а не снимок в конструкторе: вью проводятся и после него,
   * а колбэки ставятся сеттерами. Стрелками, не значениями: иначе `undefined` заморозится.
   */
  #windowOpenHost: WindowOpenHost = {
    externalOpen: (url, fromUrl, wcId) => this.#externalOpenCb?.(url, fromUrl, wcId),
    isIncognito: (tabId) => this.tabMap.get(tabId)?.incognito ?? false,
    openTab: (url, background, ephemeral, incognito, postBody, referrer) =>
      this.createTab(url, background, ephemeral, incognito, postBody, undefined, referrer),
    // ⚠️ Обе связи ставятся ПОСЛЕ createTab: активация внутри него забывает все связи, как
    // ForgetAllOpeners в Chrome. openerOf нужен закрытию — закрыв открытую отсюда вкладку,
    // человек возвращается к этой, а не к случайному соседу (см. closeTab).
    noteOpened: (openedId, fromHost, openerId) => {
      this.#navFrom.set(openedId, fromHost);
      this.#openerOf.set(openedId, openerId);
    },
  };

  /**
   * Что контекстное меню спрашивает у менеджера.
   *
   * ⚠️ Один объект на менеджер, а не на вкладку: он ничего не помнит, id щёлкнутой вкладки меню
   * приносит с собой. ⚠️ Стрелками, а не значениями: колбэки ставятся сеттерами уже после
   * конструктора, и снимок при проводке вкладки заморозил бы здесь undefined навсегда.
   */
  #menuHost: PageContextMenuHost = {
    window: () => this.win,
    searchEngineId: () => this.searchEngineId,
    isIncognito: (tabId) => this.tabMap.get(tabId)?.incognito ?? false,
    openTab: (url, background, incognito, referrer) => this.createTab(url, background, false, incognito, undefined, undefined, referrer),
    noteOpened: (openedId, fromHost, openerId) => {
      this.#navFrom.set(openedId, fromHost);
      this.#openerOf.set(openedId, openerId);
    },
    splitShown: () => this.#activePair() !== undefined,
    enterSplit: (tabId) => this.enterSplit(tabId),
    openInNewWindow: (url) => this.onOpenInNewWindowCb?.(url),
    saveAs: (url) => this.onSaveAsCb?.(url),
    graphMenuItem: (items) => this.#graphMenuBuilder?.(items, undefined) ?? null,
    aiAction: () => this.onAiActionCb ?? null,
  };

  // ── Активация: показываем нужную вьюху, прячем остальные ──
  activate(id: string) {
    // Хаб не в tabMap — обрабатываем отдельно.
    const tab = id === HUB_ID ? this.hubTab : this.tabMap.get(id);
    if (!tab) return;

    // Поповер перевода анкорится к прежней активной вкладке — при реальной смене (не при
    // повторном activate() того же id, напр. клик по уже активной вкладке в сайдбаре) его пора
    // закрыть. Раньше остального в функции — событие должно уйти сразу, а не в конце разбора.
    if (this.activeId !== id) {
      this.onActiveTabChangedCb?.();
      // ⚠️ Переключились — забываем ВСЕ связи «кто кого открыл» (см. #openerOf и closeTab). Это
      // ForgetAllOpeners из Chrome: без него «закрыл — вернулся к родителю» срабатывало бы и
      // через час, когда человек про ту ссылку давно забыл, а прыжок в другой конец полосы
      // выглядит уже не заботой, а сбоем. Правило живёт ровно по горячим следам.
      this.#openerOf.clear();
    }

    // Пробуждаем вкладку, если она спит (до любой логики с view).
    if (tab.sleeping) this.wakeTab(id);

    // ⚠️ Под модальным экраном хрома вкладка становится активной, но НЕ показывается: иначе
    // страница легла бы поверх модалки. Показ отдаётся снятию модалки (setChromeModal(false)).
    if (this.chromeModal) {
      this.activeId = id;
      tab.lastActiveAt = Date.now();
      for (const t of this.tabMap.values()) if (this.isHttpView(t.view)) t.view.setVisible(false);
      this.onChange();
      return;
    }

    // Останавливаем поиск на уходящей вкладке перед переключением.
    if (this.activeId !== id) {
      const prev = this.activeId === HUB_ID ? null : this.tabMap.get(this.activeId);
      if (prev && this.isHttpView(prev.view)) {
        prev.view.webContents.stopFindInPage('clearSelection');
        this.lastQuery = '';
      }
      this.findBarOpen = false; // FindBar уйдёт при смене activeId в renderer'е
    }

    // ⚠️ ПЕРЕДАЧА КАДРА СЧИТАЕТСЯ ДО ВЕТВЛЕНИЯ НА SPLIT, и это не косметика. Раньше эти строки
    // стояли НИЖЕ ветки split, а та кончается своим return, — то есть при переходе НА разделённую
    // вкладку кадр не уезжал вообще. Со стороны выглядело загадочно: «через обычную вкладку в
    // сплит — работает, сразу в сплит — нет», хотя разница ровно в этом return.
    // ⚠️ Считаем МНОЖЕСТВАМИ видимых вкладок, а не «прежняя → новая»: у пары видимы ОБЕ панели,
    // поэтому уход со сплита обязан увести кадр и с той панели, что не была активной, а приход на
    // сплит — вернуть кадр в обе. С одиночным id множество из одного элемента, прежнее поведение.
    const wasVisible = this.#visibleTabIds(this.activeId);
    const willBeVisible = this.#visibleTabIds(id);
    for (const gone of wasVisible) if (!willBeVisible.has(gone)) this.sendPip(gone, PIP_ENTER_SCRIPT);
    for (const shown of willBeVisible) this.sendPip(shown, PIP_EXIT_SCRIPT);

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
    // ⚠️ isLiveHttpView, а не isHttpView: exitSplit зовёт этот метод в хвосте, и «выживший»
    // stayId тоже может оказаться с уже уничтоженным webContents (window.close() из контента
    // у соседней панели) — .focus() на нём бросил бы "Object has been destroyed". Мёртвая
    // вкладка честно уводит фокус в чром, а не роняет main.
    if (tab && this.isLiveHttpView(tab.view) && !this.errors.has(this.activeId)) {
      tab.view.webContents.focus();
    } else {
      this.onFocusChromeCb();
    }
  }

  closeTab(id: string) {
    if (id === HUB_ID) return;
    if (this.isTabPinned(id)) return;
    this.clearOrganizeSnapshot();
    this.#navFrom.delete(id); // карта «откуда пришли» не должна копить мёртвые вкладки

    // ⚠️ Соседей считаем ЗДЕСЬ, до всякой уборки. Ниже вкладка исчезает и из tabMap, и из дерева
    // узлов, после чего findIndex по визуальному порядку возвращает -1 — а прежний код брал
    // `ordered[idx + 1]`, то есть `ordered[0]`, и человека увозило в начало полосы, на хаб. Ровно
    // это и была жалоба «при закрытии перебрасывает на главную»: не выбор соседа, а промах по
    // индексу в уже вычищенном списке.
    const orderBefore = this.tabsInVisualOrder(true);
    const closingIdx = orderBefore.findIndex((t) => t.id === id);
    const openerId = this.#openerOf.get(id);
    this.#openerOf.delete(id);
    // Вкладки, открытые ЗАКРЫВАЕМОЙ, теряют родителя — иначе они возвращали бы к мёртвому id.
    for (const [child, parent] of this.#openerOf) if (parent === id) this.#openerOf.delete(child);
    // Закрытие вкладки, входящей в (возможно припаркованную) пару.
    const closingPair = this.#pairContaining(id);
    if (closingPair) {
      const { leftId, rightId } = closingPair;
      const otherId = id === leftId ? rightId : leftId;
      const currentlyShown = closingPair === this.#activePair();
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
        this.splitPairs.remove(closingPair);
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
        this.closedTabs = pushClosed(this.closedTabs, { url, title: this.#tabTitle(tab) || url, closedAt: Date.now() });
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
        this.closedTabs = pushClosed(this.closedTabs, { url, title: tab.sleeping.title || url, closedAt: Date.now() });
      }
    }

    // Закрыли активную — куда переходить. Порядок правил взят у Chrome (TabStripModel) и
    // совпадает с Firefox и Safari: СОСЕД СПРАВА, а не «предыдущая по времени» и тем более не
    // начало полосы. Справа — потому что вкладки читают слева направо, и закрытие прочитанной
    // естественно продвигает к следующей; «предыдущая по времени» в этих браузерах не поведение
    // по умолчанию нигде.
    //
    // ⚠️ Перед соседом идёт РОДИТЕЛЬ — вкладка, из которой эту открыли (см. #openerOf). Так же
    // делают и Chrome, и Firefox (там это browser.tabs.selectOwnerOnClose, включён по умолчанию):
    // открыл ссылку из статьи, посмотрел, закрыл — вернулся в статью, а не к случайному соседу.
    // Связь живёт до первого переключения вкладок, поэтому сработает только по горячим следам.
    if (this.activeId === id) {
      // closingIdx === -1 быть уже не должно, но проверка стоит: именно промах по индексу и был
      // тем багом, а `orderBefore[-1 + 1]` — это снова начало полосы, то есть тот же симптом.
      const neighbour = closingIdx < 0
        ? undefined
        : (orderBefore[closingIdx + 1] ?? orderBefore[closingIdx - 1]);
      const nextId = openerId && this.tabMap.has(openerId)
        ? openerId
        : (neighbour && this.tabMap.has(neighbour.id) ? neighbour.id : this.hubTab.id);
      this.activate(nextId);
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
    // ⚠️ Проводка — под catch, и это не глушение ошибки, а порядок восстановления: вкладка УЖЕ в
    // дереве этого окна, и не активировать её после этого — худший из исходов (человек видит её
    // в сайдбаре, а на экране пусто, см. разбор у removeHandler в wirePageEvents). Сбой проводки
    // стоит части возможностей одной вкладки и громко пишется в лог; пропущенный activate стоит
    // видимости страницы и уносит с собой хвост вызывающей стороны.
    try {
      this.wirePageEvents(id, d.view);
    } catch (e) {
      console.error('[TabMgr] проводка принятой вкладки не удалась:', (e as Error).message);
    }
    this.activate(id); // activate сам добавит вью в окно и выставит bounds
    return id;
  }

  reopenLastClosedTab(): void {
    const { tab, rest } = popClosed(this.closedTabs); this.closedTabs = rest;
    if (tab) this.createTab(tab.url);
  }

  // Есть ли что восстанавливать — для активности пункта меню «Открыть закрытую вкладку».
  hasClosedTabs(): boolean {
    return this.closedTabs.length > 0;
  }

  /** Свежие первыми — сырьё строк «Продолжить» в панели. */
  closedSnapshot(): ClosedTab[] { return peekClosed(this.closedTabs); }

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
      this.nodes = reorderNodes(this.nodes, orderedIds);
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
  // Возвращает id созданной группы (или null), чтобы вызывающий мог, например, предложить ей имя
  // моделью (AI-IDEAS.md №5). Прежние void-вызовы значение просто игнорируют.
  createGroup(tabId: string): string | null {
    const group = wrapTabInGroup(tabId, {
      id: randomUUID(), label: 'Новая группа', color: null, collapsed: false,
    }, this.nodes);
    if (!group) return null;
    this.clearOrganizeSnapshot();
    this.onChange();
    return group.id;
  }

  // Заголовок+url каждой вкладки группы — материал для предложения имени (см. TabOrganizer
  // suggestGroupName). Спящие тоже годятся: url/title у них есть в записи, будить не нужно.
  groupTabInfos(groupId: string): { title: string; url: string }[] {
    const group = this.#findGroupById(groupId);
    if (!group) return [];
    const out: { title: string; url: string }[] = [];
    for (const id of collectDirectGroupTabIds(group)) {
      const tab = this.tabMap.get(id);
      if (tab) out.push({ title: this.#tabTitle(tab) ?? '', url: this.#tabUrl(tab) });
    }
    return out;
  }

  // Перемещает узел (SingleNode или SplitPairNode целиком) в конец children указанной
  // группы — та же логика "не разбираем пару", что и в createGroup.
  addTabToGroup(groupId: string, tabId: string): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    this.clearOrganizeSnapshot();
    if (!moveTabNodeToGroup(group, tabId, this.nodes)) return;
    this.onChange();
  }

  // Вынимает вкладку (или ЕЁ ПАРУ целиком, если tabId — панель split-pair) из группы;
  // помещает узел после группы. Если группа опустела — расформировывает её.
  removeTabFromGroup(groupId: string, tabId: string): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    this.clearOrganizeSnapshot();
    if (!removeTabNodeFromGroup(group, tabId, this.nodes)) return;
    this.onChange();
  }

  /**
   * Кладёт вкладку в группу с таким ИМЕНЕМ, создавая её при необходимости. Точка входа для
   * правил-автоматизаций (см. RuleEngine.ts): правило знает имя, а не id.
   *
   * ⚠️ Идемпотентна: вкладка, уже лежащая в нужной группе, не трогается вовсе — иначе каждая
   * навигация внутри сайта перекладывала бы её в конец списка прямо под рукой у человека.
   * ⚠️ Закреплённая вкладка живёт вне дерева (`pinnedTabs`), в группу не попадает и остаётся
   * закреплённой: закреп — это место в полосе, и молча отнимать его правило не вправе.
   */
  putTabInNamedGroup(tabId: string, label: string): void {
    const name = label.trim();
    if (!name) return;
    if (!this.#findTabParent(tabId)) return;
    const current = this.#groupContaining(tabId);
    if (current && current.label.trim().toLowerCase() === name.toLowerCase()) return;
    const target = this.#findGroupByLabel(name);
    if (target) {
      this.addTabToGroup(target.id, tabId);
      return;
    }
    this.createGroup(tabId);
    // createGroup id наружу не отдаёт (у неё другой вызывающий) — берём созданную группу по факту.
    const created = this.#groupContaining(tabId);
    if (created) this.renameGroup(created.id, name);
  }

  /** Закрепить, если ещё не закреплена. `togglePin` для правила не годится — оно бы открепляло. */
  pinTab(tabId: string): void {
    if (this.pinnedTabs.some((t) => t.id === tabId)) return;
    this.togglePin(tabId);
  }

  // Текущая метка группы (или null, если группы нет) — вызывающему в main нужно отличить
  // ещё не названную «Новую группу» от уже названной, чтобы не перебивать имя предложением.
  groupLabel(groupId: string): string | null {
    return this.#findGroupById(groupId)?.label ?? null;
  }

  renameGroup(groupId: string, label: string): void {
    if (!renameGroupNode(groupId, label, this.nodes)) return;
    this.onChange();
  }

  setGroupColor(groupId: string, color: string | null): void {
    if (!setGroupNodeColor(groupId, color, this.nodes)) return;
    this.onChange();
  }

  toggleGroupCollapse(groupId: string): void {
    if (!toggleGroupNodeCollapse(groupId, this.nodes)) return;
    this.onChange();
  }

  // Расформировывает группу: дети выносятся на место группы в родительском массиве.
  disbandGroup(groupId: string): void {
    this.clearOrganizeSnapshot();
    disbandGroup(groupId, this.nodes);
    this.onChange();
  }

  // {url,title} каждой листовой вкладки группы (рекурсивно, split-pair — обе половины) — для
  // «Скопировать содержимое» в ПКМ-меню группы (main.ts::GROUP_SHOW_MENU). title падает на url,
  // если страница ещё не отдала заголовок (см. #tabTitle) — пустой текст ссылки хуже, чем URL дважды.
  setGraphMenuBuilder(
    fn: (items: Array<{ url: string; title: string }>, sticker?: string) => MenuItemConstructorOptions | null,
  ): void {
    this.#graphMenuBuilder = fn;
  }

  // Правила-автоматизации: main подписывается на «вкладка пришла на адрес» (см. RuleEngine.ts).
  // Отдельным сеттером, а не параметром конструктора — по тому же соображению, что закладки:
  // список параметров и без того длинный, а фича появилась позже.
  setRuleHook(fn: (ev: { tabId: string; url: string; fromHost: string; incognito: boolean }) => void): void {
    this.#ruleHook = fn;
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

  /**
   * Усыпить вкладку по требованию человека из диспетчера задач.
   *
   * ⚠️ Через TabManager, а не убийством процесса. Снять рендерер мимо модели вкладок значило бы
   * оставить её в состоянии, которого не бывает: вкладка есть, вью нет, и никто об этом не знает.
   *
   * ⚠️ Активную вкладку не усыпляем: пробуждение у нас — полная перезагрузка страницы, и человек
   * получил бы мигание и потерю прокрутки прямо в том, на что смотрит. Хаб и спящие — нечего.
   */
  sleepTabById(id: string): boolean {
    const tab = this.tabMap.get(id);
    if (!tab || tab.sleeping !== null || !tab.view) return false;
    if (id === this.activeId || id === HUB_ID) return false;
    this.sleepTab(id);
    return true;
  }

  /**
   * id вкладки по её webContents. Нужен тем, кто получил в колбэке только `wc` и должен связать
   * результат со вкладкой (распознавание товара, см. PRICE-TRACKING.md). Сравнение по id — по той
   * же причине, что в ownsWebContents выше.
   */
  tabIdForWebContents(wcId: number): string | null {
    for (const [id, tab] of this.tabMap) {
      const wc = tab.view?.webContents;
      if (wc && !wc.isDestroyed() && wc.id === wcId) return id;
    }
    return null;
  }

  /**
   * Профиль вкладки по её webContents.
   *
   * ⚠️ Нужен там, где событие пришло ОТ СТРАНИЦЫ, а записать его надо в базу её профиля —
   * запись визита в историю прежде всего. Брать активный профиль там нельзя: фоновая вкладка
   * профиля «Работа» продолжает грузиться, пока человек смотрит «Личное», и её визит ушёл бы
   * в чужую историю — то есть ровно та утечка между профилями, которую мы и закрываем.
   *
   * Вкладка без profileId — созданная до появления профилей; её место в основном.
   */
  profileOfWebContents(wcId: number): string {
    for (const tab of this.tabMap.values()) {
      const wc = tab.view?.webContents;
      if (wc && !wc.isDestroyed() && wc.id === wcId) return tab.profileId ?? DEFAULT_PROFILE_ID;
    }
    return DEFAULT_PROFILE_ID;
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
    group.children = reorderNodes(group.children, orderedIds);
    this.onChange();
  }

  // Возвращает true если вкладка находится в какой-либо группе.
  isTabInGroup(tabId: string): boolean {
    return this.#groupContaining(tabId) !== null;
  }

  // Возвращает groupId если вкладка непосредственно в группе, иначе null.
  // Phase 3: группы не вложены, достаточно одного уровня.
  getTabGroupId(tabId: string): string | null {
    return findTopLevelGroupId(tabId, this.nodes);
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

  // Войти в split: текущая активная вкладка и ПРИВОДИМАЯ (movedId) встают парой.
  //
  // side — какую половину займёт приводимая; активная забирает вторую. По умолчанию правую: так
  // входят в сплит из контекстного меню ссылки, где стороне взяться неоткуда. Перетаскивание же
  // передаёт край, за который тянули (см. shared/ipc.ts::TabDropResult.side) — раньше пара
  // собиралась одинаково, куда бы человек ни вёл, и жест обещал одно, а делал другое.
  //
  // ⚠️ Роли «где встать» и «кто едет» разведены нарочно. Пара занимает место АКТИВНОЙ вкладки в
  // дереве и на экране — человек смотрел туда, и оттуда ничего не должно прыгать. Приводимую
  // вынимают из её места и вводят анимацией. Раньше это совпадало со сторонами (активная всегда
  // левая), поэтому и жило под именами leftId/rightId; со свободной стороной совпадение
  // кончилось, и путать их больше нельзя.
  // Только обычные (не закреплённые, не хаб) вкладки могут участвовать.
  enterSplit(movedId: string, side: 'left' | 'right' = 'right'): void {
    // Коммит 4: лимит на ОБЩЕЕ число пар снят — блокируем только если конкретно активная
    // или приводимая вкладка УЖЕ состоит в какой-то паре (нельзя одну и ту же вкладку
    // впихнуть сразу в две). Разные вкладки без пары — новая пара разрешена,
    // существующие пары это не блокирует (мульти-сплит).
    if (this.#pairContaining(this.activeId) || this.#pairContaining(movedId)) return;
    this.clearOrganizeSnapshot();
    const movedTab = this.tabMap.get(movedId);
    if (!movedTab || (!this.isHttpView(movedTab.view) && !movedTab.sleeping) || this.isTabPinned(movedId)) return;

    const anchorId = this.activeId;
    if (anchorId === movedId) return;

    const anchorTab = this.tabMap.get(anchorId);
    if (!anchorTab || (!this.isHttpView(anchorTab.view) && !anchorTab.sleeping) || this.isTabPinned(anchorId)) return;

    const leftId  = side === 'left' ? movedId : anchorId;
    const rightId = side === 'left' ? anchorId : movedId;

    // ⚠️ Раньше здесь стоял отказ, если вкладки лежат в РАЗНЫХ родителях (одна в папке, другая
    // снаружи). Из-за него перетаскивание вкладки из папки на край страницы молча не давало
    // ничего: пара строится с АКТИВНОЙ вкладкой, а она почти всегда в другом месте дерева.
    // Формат от этого не меняется — SplitPairNode и так живёт и в корне, и внутри папки; меняется
    // только то, что приводимую вкладку сначала вынимают из её массива.
    const anchorParent = this.#findTabParent(anchorId);
    const movedParent  = this.#findTabParent(movedId);
    if (!anchorParent || !movedParent) return;

    if (movedTab.sleeping) this.wakeTab(movedId);

    const activeWc = this.getActiveWebContents();
    if (activeWc) { activeWc.stopFindInPage('clearSelection'); this.lastQuery = ''; }
    this.findBarOpen = false;
    this.onFindCloseCb();

    // Прячем ВСЁ постороннее — не только одиночные вкладки, но и панели ДРУГИХ пар, если
    // такие уже есть. Корректно и под мульти-сплит: activeId равен anchorId, то есть одной
    // из двух панелей новой пары, поэтому она становится #activePair() автоматически — все
    // остальные, включая прежде показываемую пару (если была), уходят в парковку (их узлы
    // остаются в дереве).
    for (const t of this.tabMap.values()) {
      if (!this.isHttpView(t.view)) continue;
      if (t.id !== leftId && t.id !== rightId) t.view.setVisible(false);
    }

    // Пара встаёт на место АКТИВНОЙ вкладки — она остаётся там, где человек её видел.
    const pair: SplitPairNode = { type: 'split-pair', leftTabId: leftId, rightTabId: rightId, ratio: 0.5 };

    insertSplitPairAt(this.nodes, anchorParent, movedParent, movedId, pair);

    // ⚠️ activePanel обязан указывать на сторону АКТИВНОЙ вкладки, а не всегда на левую:
    // activeId остаётся anchorId, и разъедься эти двое — Ctrl-переключение панелей и выход из
    // сплита без keepId начнут врать (тот же инвариант, что сторожит комментарий у #activePair).
    this.splitPairs.add({
      leftId, rightId, splitRatio: 0.5,
      activePanel: anchorId === leftId ? 'left' : 'right',
    });

    for (const splitId of [leftId, rightId]) {
      const splitTab = this.tabMap.get(splitId);
      if (!splitTab || !this.isHttpView(splitTab.view)) continue;
      const children = this.win.contentView.children;
      if (!children.includes(splitTab.view)) this.win.contentView.addChildView(splitTab.view);
    }

    // Активная панель встаёт на место сразу (одна смена размера — она уже была на экране, и
    // приезжать ей неоткуда), приводимая въезжает из-за ТОГО края, к которому её вели: так
    // появление сплита читается как продолжение жеста, а не как щелчок.
    this.repositionViews();
    const to = this.getTabViewBounds(movedId);
    this.slideViews([{ tabId: movedId, to, ...this.#panelEntryFrom(side, to) }]);
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
    const exit = this.splitPairs.planExit(tabId, this.activeId, keepId);
    if (!exit) return;
    const { pair, leftId, rightId, stayId, hideId } = exit;
    // Пары, о которой шёл жест перетаскивания, больше нет — значит и раскладка жеста ни при чём:
    // дальше видимость и bounds расставляет сам exitSplit. Проверяем именно ЭТУ пару, иначе
    // распад чужой пары (при мультисплите) обрывал бы чужой жест на полпути.
    if (this.panelDrag && (pair.leftId === this.panelDrag.tabId || pair.rightId === this.panelDrag.tabId)) {
      this.panelDrag = null;
    }
    this.clearOrganizeSnapshot();
    // Для обеих пар сначала разворачиваем узел, затем удаляем runtime-запись. У припаркованной
    // пары визуальное состояние не трогаем: её вью уже скрыты с момента парковки.
    this.#dissolveSplitPair(leftId, rightId);
    this.splitPairs.remove(pair);
    if (!exit.shown) {
      this.onChange();
      return;
    }

    // isLiveHttpView (не isHttpView) — hideId часто ИМЕННО та вкладка, что сейчас закрывается
    // через closeTab → exitSplit(otherId, otherId) (см. closeTab ниже): её webContents уже может быть
    // destroyed (window.close() из контента, напр. OAuth-логина, либо снос окна при выходе
    // браузера), а из tabMap она пока не удалена — exitSplit вызывается раньше этой уборки.
    const hideTab = this.tabMap.get(hideId);
    if (hideTab && this.isLiveHttpView(hideTab.view)) {
      hideTab.view.webContents.stopFindInPage('clearSelection');
      hideTab.view.setVisible(false);
    }

    this.activeId = stayId;
    const stayTab = this.tabMap.get(stayId);
    if (stayTab && this.isLiveHttpView(stayTab.view) && !this.errors.has(stayId)) {
      const children = this.win.contentView.children;
      if (!children.includes(stayTab.view)) this.win.contentView.addChildView(stayTab.view);
      stayTab.view.setVisible(true);
      this.applyBounds(stayTab.view);
    }

    this.onChange();
    this.focusActiveView();
  }

  // Откуда панель въезжает в слот. Формула и разбор несимметрии краёв — в splitPanelEntryFrom.
  #panelEntryFrom(side: 'left' | 'right', to: ContentBounds): { fromX: number; fromY: number } {
    return splitPanelEntryFrom(side, to, this.bounds);
  }

  // Прямоугольники ОСТРОВОВ показываемой пары, в оконных координатах. Нужны зонам перетаскивания
  // (electron/DropZoneManager.ts): пока сплита нет, края области контента можно делить по
  // фиксированной доле, но как только панели на экране, человек целится в КОНКРЕТНУЮ панель — а
  // она может занимать и треть ширины, и две трети (разделитель таскают).
  //
  // ⚠️ Остров, а не рамка страницы (#splitPaneBounds): формула в splitIslandRects.
  splitPanelRects(): { leftId: string; rightId: string; left: ContentBounds; right: ContentBounds } | null {
    const pair = this.#activePair();
    if (!pair) return null;
    const { left, right } = splitIslandRects(this.bounds, pair.splitRatio);
    return { leftId: pair.leftId, rightId: pair.rightId, left, right };
  }

  // Заменить одну панель показываемой пары вкладкой из списка — жест «принести вкладку на
  // половину сплита». До этого сплит был тупиком: enterSplit отказывает, когда активная уже в
  // паре, и перетаскивание вкладки на страницу в режиме сплита не делало ровно ничего.
  //
  // ⚠️ Выселенная панель НЕ закрывается. Она возвращается в список обычной вкладкой и встаёт
  // сразу за парой, из которой вышла, — там, где человек будет её искать. Закрыть чужую страницу
  // по жесту, который человек считает перестановкой, — потеря его работы без спроса.
  replaceSplitPanel(panelId: string, newId: string): void {
    const pair = this.#pairContaining(panelId);
    // Только ПОКАЗЫВАЕМАЯ пара: припаркованная не на экране, целиться в её панель нечем.
    if (!pair || pair !== this.#activePair()) return;
    if (panelId === newId || newId === HUB_ID) return;
    if (this.#pairContaining(newId)) return;           // уже половина какой-то пары
    if (this.isTabPinned(newId)) return;
    const newTab = this.tabMap.get(newId);
    if (!newTab || (!this.isHttpView(newTab.view) && !newTab.sleeping)) return;
    this.clearOrganizeSnapshot();

    const side = this.splitPairs.sideOf(panelId);
    if (!side) return;
    if (newTab.sleeping) this.wakeTab(newId);

    replaceSplitPairPanelNode(this.nodes, panelId, newId, side);

    this.splitPairs.replacePanel(pair, panelId, newId);
    // ⚠️ activeId переставляем ДО repositionViews: #activePair() ищет пару по activeId, и с
    // прежним (уже выселенным) id пара перестала бы находиться — раскладка на кадр схлопнулась
    // бы в одиночную вкладку.
    if (this.activeId === panelId) {
      this.activeId = newId;
      pair.activePanel = side;
    }

    const evicted = this.tabMap.get(panelId);
    if (evicted && this.isLiveHttpView(evicted.view)) evicted.view.webContents.stopFindInPage('clearSelection');

    const incoming = this.tabMap.get(newId);
    if (incoming && this.isHttpView(incoming.view)) {
      // ⚠️ Порядок детей = порядок слоёв, и приезжающую надо поднять НАД выселенной: та остаётся
      // видимой на время проезда (см. ниже), и без явного подъёма новая страница ехала бы под
      // ней — то есть невидимо. Переклад безопасен: до этого момента она скрыта, мелькнуть нечему.
      if (this.win.contentView.children.includes(incoming.view)) {
        this.win.contentView.removeChildView(incoming.view);
      }
      this.win.contentView.addChildView(incoming.view);
      incoming.view.setVisible(true);
    }

    // Новая панель въезжает с ближайшего свободного края своего слота — тем же движением, что и
    // при входе в сплит (см. #panelEntryFrom).
    this.repositionViews();
    const to = this.getTabViewBounds(newId);
    this.slideViews([{ tabId: newId, to, ...this.#panelEntryFrom(side, to) }]);

    // ⚠️ Выселенная панель гаснет не сейчас, а когда новая уже доехала. Мгновенное скрытие и было
    // половиной рывка: слот на четверть секунды становился пустым, и человек видел дырку вместо
    // замены. Теперь новая страница просто наезжает на старую и занимает её место.
    setTimeout(() => {
      if (this.win.isDestroyed()) return;
      // За эти кадры человек мог успеть что угодно — вернуть выселенную в сплит, переключиться
      // на неё, открыть её в другой паре. Гасим, только если её по-прежнему никто не показывает.
      if (this.activeId === panelId || this.#pairContaining(panelId)) return;
      const tab = this.tabMap.get(panelId);
      if (tab && this.isLiveHttpView(tab.view)) tab.view.setVisible(false);
    }, PANEL_SLIDE_MS);

    this.onChange();
    this.focusActiveView();
  }

  // Миниатюра страницы для карточки, которую человек несёт в руке, перетаскивая половину сплита
  // за шапку (src/components/SplitDragCard.tsx). Один снимок на жест.
  //
  // ⚠️ Почему снимок, а не живая вьюха. Уменьшить нативную вьюху на лету нельзя: смена размера
  // заставляет страницу пересчитывать вёрстку на каждом кадре (см. slideViews — там же и причина,
  // почему двигаем только x). Картинку же рендерер крутит, наклоняет и масштабирует бесплатно.
  //
  // ⚠️ capturePage ждёт следующего скомпонованного кадра и на загруженной машине занимает
  // заметное время — этот урок уже оплачен в ScreenshotManager.ts. Поэтому его зовут на
  // pointerdown, ДО порога начала драга (см. App.tsx), а не в момент старта: иначе карточка
  // появлялась бы с опозданием ровно тогда, когда человек ждёт отклика.
  async capturePaneThumb(tabId: string, width: number, maxHeight: number): Promise<string | null> {
    const tab = this.tabMap.get(tabId);
    if (!tab || !this.isLiveHttpView(tab.view)) return null;
    try {
      const shot = await tab.view.webContents.capturePage();
      if (shot.isEmpty()) return null;
      // Только ширина — высоту NativeImage считает сам, по пропорции кадра.
      const scaled = shot.resize({ width });
      const { width: w, height: h } = scaled.getSize();
      // Панель сплита узкая и высокая: отдавать её целиком незачем, карточка всё равно покажет
      // верх (objectFit: cover в SplitDragCard). Режем здесь, а не в CSS, чтобы не гонять через
      // IPC то, чего никто не увидит.
      const cropped = h > maxHeight ? scaled.crop({ x: 0, y: 0, width: w, height: maxHeight }) : scaled;
      // ⚠️ JPEG, а не toDataURL(): тот отдаёт PNG, и снимок фотографической страницы весит
      // сотни килобайт — а он уходит через IPC дважды (сюда и в оверлей). Для миниатюры 240px
      // разница в качестве не видна, разница в размере — на порядок.
      return `data:image/jpeg;base64,${cropped.toJPEG(72).toString('base64')}`;
    } catch {
      return null; // вкладка могла закрыться посреди снимка — жест обойдётся подписью
    }
  }

  // Установить соотношение панелей split (вызывается при drag разделителя) — относится
  // к ПОКАЗЫВАЕМОЙ паре (renderer-контракт без id пары, drag-разделитель виден только
  // у той, что сейчас на экране). Нет показываемой пары — no-op.
  setSplitRatio(ratio: number): void {
    const pair = this.#activePair();
    if (!pair) return;
    const clamped = clampSplitRatio(ratio);
    this.splitPairs.setRatio(pair, clamped);
    // Синхронизируем с SplitPairNode, чтобы следующий сейв взял актуальный ratio.
    const { leftId, rightId } = pair;
    setSplitPairNodeRatio(this.nodes, leftId, rightId, clamped);
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

    this.splitPairs.focus(pair, side);
    this.activeId = newId;
    const tab = this.tabMap.get(newId);
    if (tab) tab.lastActiveAt = Date.now();
    this.onChange();
    this.focusActiveView();
  }

  // ── Раскладка на время перетаскивания панели за шапку (жест — в src/App.tsx) ───────────────
  //
  // Панель, которую несут, ВЫХОДИТ из раскладки: её вьюха скрывается, слот пустеет. Это не
  // украшение, а буквальный смысл жеста — страница сейчас в руке, и показывает её карточка-снимок
  // (src/components/SplitDragCard.tsx), а не остров. Пустой остров с подкрашенной шапкой и есть
  // «отсюда взяли».
  //
  // preview — курсор над второй панелью: та переезжает в опустевший слот, и её собственный слот
  // освобождается под то, что в руке. То есть раскладка ПОКАЗЫВАЕТ исход заранее, и отпускание
  // уже ничего не двигает.
  //
  // ⚠️ Переезд — только по x, размер конечный сразу (см. slideViews): менять размер на каждом
  // кадре нельзя, страница пересчитывала бы вёрстку. Именно поэтому раскладку удаётся показывать
  // ЖИВЫМИ страницами, без снимков и подмен.
  private panelDrag: { tabId: string; preview: boolean } | null = null;

  // Единственная точка входа: renderer шлёт то же самое сообщение, что рисует подсветку (см.
  // SPLIT_SWAP_HINT). Оно приходит на старте, на каждой смене зоны и ровно один раз в конце —
  // с null, каким бы ни был исход, включая отмену. Поэтому и восстановление здесь надёжное:
  // отдельного «конца жеста», который можно не позвать, у этой машинки нет.
  applyPanelDragLayout(hint: { tabId: string; zone: 'swap' | 'sidebar' | null } | null): void {
    if (!hint) { this.#endPanelDragLayout(); return; }

    const pair = this.#pairContaining(hint.tabId);
    // Припаркованную пару не трогаем: её вьюхи и так скрыты, двигать нечего.
    if (!pair || pair !== this.#activePair()) return;

    // ⚠️ СТРАХОВКА ОТ НЕЗАКРЫТОГО ЖЕСТА. Попасть сюда можно только одним способом: о прошлом
    // жесте не пришло закрывающее сообщение. Без этой ветки состояние — ТУПИК: repositionViews держит
    // несомую вью скрытой при каждом пересчёте, а жест по ДРУГОЙ половине молча игнорируется; выйти
    // можно было только разорвав сплит (exitSplit сбрасывает panelDrag) или перезапустив приложение.
    // Тот же приём, что у вкладки: startTabDrag первой строкой зовёт stopDrag по той же причине.
    // ⚠️ ПРИЧИНА ПОТЕРИ НЕ НАЙДЕНА: баг пойман живьём один раз (шапка половины перестала
    // таскаться, лечилось разрывом сплита) и не воспроизводится. Отсюда и лог: если страховка
    // когда-нибудь сработает, она назовёт случай сама.
    if (this.panelDrag && this.panelDrag.tabId !== hint.tabId) {
      console.warn('[split-drag] прошлый жест не закрылся штатно:', this.panelDrag.tabId, '→ новый:', hint.tabId);
      this.#endPanelDragLayout();
    }

    if (!this.panelDrag) {
      this.panelDrag = { tabId: hint.tabId, preview: false };
      const carried = this.tabMap.get(hint.tabId);
      if (carried && this.isLiveHttpView(carried.view)) carried.view.setVisible(false);
      // ⚠️ onChange тут НЕ зовём: модель не изменилась (вкладки и дерево те же), поменялась только
      // видимость вьюхи. Лишний прогон синхронизации перерисовал бы весь чром посреди жеста.
    }

    const wantPreview = hint.zone === 'swap';
    if (this.panelDrag.preview === wantPreview) return;
    this.panelDrag.preview = wantPreview;

    const otherId = pair.leftId === hint.tabId ? pair.rightId : pair.leftId;
    const otherSide: 'left' | 'right' = pair.leftId === otherId ? 'left' : 'right';
    const carriedSide: 'left' | 'right' = otherSide === 'left' ? 'right' : 'left';
    this.slideViews([{
      tabId: otherId,
      to:    this.#splitPaneBounds(wantPreview ? carriedSide : otherSide, pair.splitRatio),
      fromX: this.#splitPaneBounds(wantPreview ? otherSide : carriedSide, pair.splitRatio).x,
    }], 200);
  }

  // Конец жеста без исхода (отмена, отпускание в пустоту) — либо страховка после исхода, который
  // состояние уже сбросил сам. Возвращает несомую панель в раскладку.
  #endPanelDragLayout(): void {
    const d = this.panelDrag;
    if (!d) return;
    this.panelDrag = null;

    const pair = this.#pairContaining(d.tabId);
    if (pair && pair === this.#activePair() && d.preview) {
      // Вторая панель возвращается в свой слот проездом, а не прыжком.
      const otherId = pair.leftId === d.tabId ? pair.rightId : pair.leftId;
      const otherSide: 'left' | 'right' = pair.leftId === otherId ? 'left' : 'right';
      const carriedSide: 'left' | 'right' = otherSide === 'left' ? 'right' : 'left';
      this.slideViews([{
        tabId: otherId,
        to:    this.#splitPaneBounds(otherSide, pair.splitRatio),
        fromX: this.#splitPaneBounds(carriedSide, pair.splitRatio).x,
      }], 200);
    }
    // Видимость и bounds несомой панели вернёт repositionViews (applySplitBounds делает и то, и
    // другое), а уехавшую он не сбьёт — она под защитой slideGen. Если пара к этому моменту
    // ПРИПАРКОВАНА (человек успел уйти на другую вкладку), вьюхи обеих половин обязаны остаться
    // скрытыми — repositionViews это и сделает, поэтому отдельного показа тут нет намеренно.
    this.repositionViews();
  }

  // Поменять половины пары местами (жест: половину тащат на её сестру в сайдбаре). Пара
  // остаётся парой, меняется только то, кто из двух слева. Работает и для ПРИПАРКОВАННОЙ
  // пары — правка чисто структурная, а repositionViews сам двигает только показываемую.
  //
  // ⚠️ Меняются ТРИ вещи, а не одна: leftId/rightId в splitPairs (по ним считаются bounds),
  // leftTabId/rightTabId в SplitPairNode (по нему сайдбар рисует ячейки, а сессия сохраняет
  // порядок) и activePanel — он обязан указывать на сторону, где стоит activeId, иначе
  // exitSplit без keepId и Ctrl-переключение панелей начнут врать.
  //
  // ⚠️ splitRatio НЕ трогаем: слоты сохраняют свою ширину, переезжает только содержимое (так
  // же в Edge). «Унести ширину с собой» было бы ratio = 1 − ratio — сознательно не делаем,
  // иначе жест «поменять местами» заодно молча перекраивает раскладку.
  swapSplitPanels(tabId: string): void {
    const pair = this.#pairContaining(tabId);
    if (!pair) return;
    const { leftId, rightId } = pair;
    // Показываемая пара разъезжается по новым слотам на глазах (ниже) — значит откуда уезжать,
    // надо запомнить ДО правки модели. Припаркованную двигать нечем, у неё вьюхи скрыты.
    const shown = pair === this.#activePair();
    const fromLeftX  = shown ? this.#splitPaneBounds('left',  pair.splitRatio).x : 0;
    const fromRightX = shown ? this.#splitPaneBounds('right', pair.splitRatio).x : 0;
    // Жест уже показал исход раскладкой (см. applyPanelDragLayout): вторая панель стоит в чужом
    // слоте, несомая скрыта. Тогда коммит НИЧЕГО не двигает — только возвращает несомую в
    // освободившийся слот. Забираем состояние до сброса, дальше эта машинка не нужна.
    const drag = this.panelDrag;
    this.panelDrag = null;

    swapSplitPairNode(this.nodes, leftId, rightId);

    this.splitPairs.swap(pair);

    if (!shown) { this.onChange(); return; }

    if (drag?.tabId === tabId && drag.preview) {
      // Превью уже развезло панели: вторая на новом месте, несомая скрыта. Осталось вернуть её —
      // ровно туда, где под курсором висела карточка. Никакого проезда: движение здесь читалось бы
      // как «что-то поехало ещё раз», хотя раскладка уже была правильной до отпускания.
      this.repositionViews();
    } else {
      // Путь без превью (например, пара была припаркована в момент старта): половины ПРОЕЗЖАЮТ в
      // чужие слоты, а не телепортируются — иначе результат выглядит случившимся сам собой.
      this.slideViews([
        { tabId: rightId, to: this.#splitPaneBounds('left',  pair.splitRatio), fromX: fromRightX },
        { tabId: leftId,  to: this.#splitPaneBounds('right', pair.splitRatio), fromX: fromLeftX  },
      ], 220);
    }
    this.onChange();
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
  // Жёсткая перезагрузка (Ctrl+F5 / Ctrl+Shift+R, как в Chrome): та же страница, но мимо кэша —
  // нужна, когда сайт отдал протухшие стили или скрипт и обычное «обновить» ничего не меняет.
  //
  // ⚠️ У СПЯЩЕЙ вкладки живого WebContents нет, и здесь, как и в reload() выше, метод молча
  // выходит. Это осознанно, а не унаследовано: будить вкладку ради сброса кэша бессмысленно —
  // пробуждение и так грузит страницу заново. Чтобы «молча» не выглядело поломкой, пункт меню
  // для такой вкладки неактивен (см. electron/ipc/menus.ts).
  reloadHard(id: string) {
    const t = this.tabMap.get(id);
    if (!this.isHttpView(t?.view ?? null)) return;
    const err = this.errors.get(id);
    // После краша renderer-процесса мёртв сам процесс, а не кэш: пересоздать его может только
    // loadURL — ровно как в reload().
    if (err?.type === 'crash' && err.url) {
      t!.view!.webContents.loadURL(err.url);
    } else {
      t!.view!.webContents.reloadIgnoringCache();
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

  // Отказ человека («крестик» в поповере) — той же вкладке, чтобы она не поднимала предложение
  // для того же поля снова.
  sendAutofillDeclined(tabId: string): void {
    const wc = this.tabMap.get(tabId)?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.AUTOFILL_DECLINED);
  }

  findInPage(query: string, forward: boolean): void {
    const wc = this.getActiveWebContents();
    if (!wc) return;
    startPageFind(wc, query, this.lastQuery, forward);
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
    const result = await findQuoteInWebContents(wc, candidates);
    this.lastQuery = result.query;
    return result.matches;
  }

  /**
   * Переход к источнику записи буфера: открыть страницу, где текст был скопирован, и подсветить
   * его штатным findInPage (см. ClipboardBuffer.ts).
   *
   * ⚠️ УЖЕ ОТКРЫТУЮ вкладку переиспользуем, а не открываем вторую копию, — по той же причине, что
   * и извлечение текста в NotebookExtract: страница у человека уже прошла антибот, капчу и логин,
   * а второй заход начинает всё это заново. Плюс дубль вкладки в списке — сам по себе сюрприз.
   * Спящую при этом БУДИМ (в отличие от getWebContentsForUrl, которому вью нужна прямо сейчас):
   * человек попросил показать место явным кликом, и разбудить одну вкладку — ровно то, чего он ждёт.
   *
   * Возвращает число совпадений и СРАБОТАВШУЮ строку: её показывает панель поиска, и она же
   * единственный способ снять подсветку (см. обработчик CLIPBOARD_OPEN_SOURCE в main.ts).
   * Ноль совпадений — честный исход: страница могла с тех пор измениться.
   */
  async revealCopiedText(url: string, candidates: string[]): Promise<{ matches: number; query: string }> {
    const existing = this.#tabIdForUrl(url);
    const id = existing ?? this.createTab(url);
    if (existing) this.activate(id);

    // Ждём загрузку: у новой вкладки содержимого ещё нет вовсе, у разбуженной — идёт перезагрузка,
    // и findInPage по пустому документу вернул бы ноль совпадений вместо подсветки.
    const wc = this.tabMap.get(id)?.view?.webContents ?? null;
    if (wc && !wc.isDestroyed() && wc.isLoading()) await this.#waitForLoad(wc);

    // Вкладку могли переключить, пока страница грузилась. Подсвечивать в этом случае нечего:
    // findQuoteInPage работает по АКТИВНОЙ вкладке и попал бы в чужую страницу.
    if (this.activeId !== id) return { matches: 0, query: '' };
    const matches = candidates.length > 0 ? await this.findQuoteInPage(candidates) : 0;
    // lastQuery выставляет сама findQuoteInPage — это та ступень лесенки, которая нашлась.
    return { matches, query: this.lastQuery };
  }

  // Вкладка с этим адресом, включая спящую. От getWebContentsForUrl отличается именно этим: там
  // нужна живая вью для чтения, здесь — сама вкладка, которую мы всё равно активируем (и разбудим).
  #tabIdForUrl(url: string): string | null {
    const norm = (u: string): string => {
      try { const p = new URL(u); return p.origin + p.pathname.replace(/\/+$/, ''); } catch { return u; }
    };
    const wanted = norm(url);
    let fallback: string | null = null;
    for (const tab of this.tabMap.values()) {
      const current = this.#tabUrl(tab);
      if (!/^https?:\/\//i.test(current)) continue;
      if (current === url) return tab.id;
      if (!fallback && norm(current) === wanted) fallback = tab.id;
    }
    return fallback;
  }

  // ⚠️ Таймаут обязателен: страница может грузиться сколько угодно (стрим, висящий запрос), а
  // подсветку человек ждёт здесь и сейчас. По таймауту просто пробуем подсветить то, что уже есть.
  #waitForLoad(wc: WebContents): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        wc.removeListener('did-stop-loading', finish);
        resolve();
      };
      const timer = setTimeout(finish, REVEAL_LOAD_TIMEOUT_MS);
      wc.once('did-stop-loading', finish);
    });
  }

  /**
   * Пометить панель поиска открытой, когда её открыл не Ctrl+F, а код (переход к источнику
   * скопированного, см. revealCopiedText).
   *
   * ⚠️ Без этого Esc НА СТРАНИЦЕ панель не закрывает и подсветку не снимает: обработчик Esc в
   * registerHotkeyHandler смотрит ровно на этот флаг, а ставил его только Ctrl+F. Панель, открытая
   * иначе, оказывалась неснимаемой ничем, кроме перезагрузки страницы.
   */
  markFindBarOpen(): void { this.findBarOpen = true; }

  // Диспетчер задач по Shift+Esc. ⚠️ Через колбэк, а не прямым вызовом окна: TabManager
  // принадлежит окну, а диспетчер — приложению, и знать друг о друге им незачем.
  private onTaskManagerCb: (() => void) | null = null;
  onTaskManager(cb: () => void): void { this.onTaskManagerCb = cb; }

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

  /**
   * Человек правит адресную строку прямо сейчас.
   *
   * ⚠️ Заведено ради Escape и только ради него. `before-input-event` в слое хрома срабатывает
   * РАНЬШЕ страницы и раньше React: ветка Escape гасила клавишу и звала stop() у активной вью —
   * то есть «остановить загрузку». Пока фокус в омнибоксе, это неверный адресат: человек ждёт,
   * что Escape вернёт прежний адрес, как в любом браузере.
   *
   * ⚠️ Живой симптом был асимметричным и потому запутанным: на хабе Escape работал (там нет
   * активной вью, gate не срабатывал), а на любой открытой странице — нет вовсе.
   */
  private omniboxEditing = false;
  setOmniboxEditing(on: boolean): void { this.omniboxEditing = on; }
  private onScreenshotCb: (() => void) | null = null;
  private onScreenshotSaveCb: (() => void) | null = null;
  private onScreenshotCloseCb: (() => void) | null = null;
  setOnScreenshot(cb: () => void): void { this.onScreenshotCb = cb; }
  setOnScreenshotSave(cb: () => void): void { this.onScreenshotSaveCb = cb; }
  setOnScreenshotClose(cb: () => void): void { this.onScreenshotCloseCb = cb; }

  // Страница просит убрать поповер автозаполнения (Esc, уход фокуса с поля, прокрутка).
  // Сеттером, а не параметром конструктора: список параметров там уже неприлично длинный, а эта
  // подписка ставится тем же куском main.ts, что и остальные «поздние» колбэки окна.
  setOnAutofillDismiss(cb: () => void): void { this.onAutofillDismissCb = cb; }
  setOnPasswordDismiss(cb: () => void): void { this.onPasswordDismissCb = cb; }
  setOnMediaReport(cb: (tabId: string, report: MediaSessionReport, url: string) => void): void { this.onMediaReportCb = cb; }
  setOnBeforeSleep(cb: (url: string, title: string, wc: WebContents) => Promise<boolean>): void { this.onBeforeSleepCb = cb; }

  // Команда медиасессии — в ту вкладку, что сейчас играет. ⚠️ Спящая вкладка команду не получает
  // и получить не может: живого webContents у неё нет, а будить её ради «паузы» бессмысленно —
  // она и так молчит.
  sendMediaCommand(tabId: string, action: MediaCommand): boolean {
    const wc = this.tabMap.get(tabId)?.view?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    wc.send(IPC.MEDIA_SESSION_COMMAND, action);
    return true;
  }
  setOnAutofillPasteBlob(cb: (tabId: string, text: string, rect: { x: number; y: number; width: number; height: number }) => void): void {
    this.onAutofillPasteBlobCb = cb;
  }
  setOnPageCopy(cb: (text: string, url: string, title: string, rich?: PageCopyRich) => void): void { this.onPageCopyCb = cb; }
  setOnSaveAs(cb: (url: string) => void): void { this.onSaveAsCb = cb; }
  setOnClipboardToggle(cb: () => void): void { this.onClipboardToggleCb = cb; }

  /**
   * Спорный хоткей, который страница себе НЕ забрала (см. preload-content.ts).
   *
   * ⚠️ Слушатель один на менеджер, а не на вкладку, и он обязан проверять принадлежность
   * отправителя: `ipcMain.on` глобален, и без гварда одно нажатие в одном окне сработало бы во
   * всех — ровно та же ловушка, что у `before-input-event` в `tabHotkeys.ts` (после переезда
   * вкладки её слушатель остаётся у прежнего менеджера навсегда).
   */
  private pageHotkeyBound = false;
  private bindPageHotkeys(): void {
    if (this.pageHotkeyBound) return;
    this.pageHotkeyBound = true;
    ipcMain.on(IPC.PAGE_HOTKEY, (event, action: unknown) => {
      if (!this.ownsWebContents(event.sender.id)) return;
      if (typeof action === 'string') this.runPageHotkey(action);
    });
  }

  /** Спорное действие, дошедшее до нас (снизу от страницы либо из кросс-origin кадра). */
  private runPageHotkey(action: string): void {
    switch (action) {
      case 'find':
        this.findBarOpen = true;
        this.onFindOpenCb();
        break;
      case 'quick':    this.onQuickSearchCb?.(); break;
      case 'bookmark': this.onBookmarkPageCb?.(); break;
      case 'history':  this.onHistoryOpenCb?.(); break;
      case 'reload':   this.reload(this.activeId); break;
      default: break;  // незнакомое имя — молча мимо, страница могла быть старой версии
    }
  }

  // Вкладка после передачи сохраняет listener, но старый менеджер больше не владеет её wc.
  registerHotkeyHandler(wc: WebContents, source: 'chrome' | 'tab' = 'tab'): void {
    this.bindPageHotkeys();
    wireTabHotkeys(wc, source, {
      ownsWebContents: (id) => this.ownsWebContents(id),
      screenshotOpen: () => this.screenshotOpen,
      closeScreenshot: () => { this.screenshotOpen = false; this.onScreenshotCloseCb?.(); },
      findBarOpen: () => this.findBarOpen,
      closeFind: () => { this.findBarOpen = false; this.onFindCloseCb(); },
      omniboxEditing: () => this.omniboxEditing,
      activeWebContents: () => this.getActiveWebContents(),
      openTaskManager: () => this.onTaskManagerCb?.(),
      reload: () => this.reload(this.activeId),
      toggleDevTools: () => this.toggleActiveDevTools(),
      goBack: () => this.goBack(this.activeId),
      goForward: () => this.goForward(this.activeId),
      openHub: () => this.activate(HUB_ID),
      reopenLastClosedTab: () => this.reopenLastClosedTab(),
      openNewWindow: () => this.onNewWindowCb?.(),
      newIncognitoTab: () => { this.createTab(undefined, false, false, true); },
      returnActiveTab: () => this.onReturnTabCb?.(this.activeId),
      closeActiveTab: () => this.closeTab(this.activeId),
      selectNext: () => this.selectNext(),
      selectPrev: () => this.selectPrev(),
      zoomIn: () => this.adjustZoom(ZOOM_STEP),
      zoomOut: () => this.adjustZoom(-ZOOM_STEP),
      resetZoom: () => this.resetZoom(),
      runPageHotkey: (action) => this.runPageHotkey(action),
      openFind: () => { this.findBarOpen = true; this.onFindOpenCb(); },
      quickSearch: () => this.onQuickSearchCb?.(),
      openHistory: () => this.onHistoryOpenCb?.(),
      bookmarkPage: () => this.onBookmarkPageCb?.(),
      reloadHard: () => this.reloadHard(this.activeId),
      focusOmnibox: () => this.onOmniboxFocusCb(),
      captureScreenshot: () => this.onScreenshotCb?.(),
      saveScreenshot: () => this.onScreenshotSaveCb?.(),
      openBookmarks: () => this.onBookmarksOpenCb?.(),
      toggleClipboard: () => this.onClipboardToggleCb?.(),
      selectByIndex: (index) => this.selectByIndex(index),
    });
  }

  // ── Показать / скрыть вьюху активной вкладки ──
  // revealView: вызывается после did-navigate (успешная загрузка) — показываем.
  /**
   * Модальный экран в ХРОМЕ (выбор профиля при старте, онбординг) — прятать содержимое.
   *
   * ⚠️ Зачем это нужно вообще. React рисует рамку, а WebContentsView страницы кладётся ПОВЕРХ
   * неё в область контента. Значит любая модалка, нарисованная в React по центру окна, при
   * открытой странице оказывается ПОД ней: человек видит только затемнение по краям — сайдбар
   * и тулбар потемнели, а карточки с кнопками нет. Со стороны это выглядит как «браузер завис
   * и требует выбора, которого не показывает», и пользоваться им нельзя.
   *
   * Живой случай 23.08: экран выбора профиля при старте. Он всегда был уязвим, но всплывал
   * только при восстановленной сессии со страницей — на первом запуске активен Хаб, у которого
   * вьюхи нет вовсе (та же оговорка стоит в Onboarding.tsx и по той же причине).
   */
  setChromeModal(on: boolean): void {
    if (this.chromeModal === on) return;
    this.chromeModal = on;
    if (on) {
      for (const t of this.tabMap.values()) if (this.isHttpView(t.view)) t.view.setVisible(false);
      return;
    }
    // Снятие — через обычный путь показа: он один знает про split-пары, ошибки и спящих.
    if (this.activeId && this.activeId !== HUB_ID) this.activate(this.activeId);
  }

  private revealView(id: string): void {
    // ⚠️ Пока висит модальный экран хрома, поднимать вьюху нельзя ничем — иначе фоновая
    // навигация (did-navigate восстановленной вкладки) вернёт страницу поверх модалки.
    if (this.chromeModal) return;
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

    const organized = buildOrganizedTree(this.nodes, clusters, randomUUID);
    this.organizeSnapshot = organized.snapshot;
    this.nodes = organized.nodes;

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
  // Просьба к странице увести/вернуть кадр из окошка поверх окон.
  private sendPip(tabId: string, script: string): void {
    const tab = this.tabMap.get(tabId);
    if (!tab || !this.isHttpView(tab.view)) return;
    runPipScript(tab.view.webContents, script);
  }

  // Вьюхи, которые сейчас едут: repositionViews их не трогает, иначе первый же ResizeObserver
  // рендерера поставил бы их на место посреди движения. Не одна, а набор — обмен половин сплита
  // двигает ДВЕ вьюхи разом. Значение — номер поколения: новый жест поверх незакончившегося
  // обязан отменить прошлый, иначе два таймера тянули бы одну вьюху в разные стороны.
  private slideGen = new Map<string, number>();

  // Проезд вьюх к новым слотам. Кадры и таймер — tabSplitMotion; поколения остаются здесь,
  // потому что applySplitBounds не должен сбивать едущую панель.
  //
  // ⚠️ Двигаем только положение, размер сразу конечный — разбор в splitSlidePosition.
  private slideViews(moves: Array<{ tabId: string; to: ContentBounds; fromX: number; fromY?: number }>, durMs = PANEL_SLIDE_MS): void {
    const live: SplitSlideMove[] = [];
    for (const m of moves) {
      const tab = this.tabMap.get(m.tabId);
      if (!tab || !this.isHttpView(tab.view)) continue;
      live.push({ tabId: m.tabId, view: tab.view, to: m.to, fromX: m.fromX, fromY: m.fromY });
    }
    slideSplitViews(live, this.slideGen, durMs);
  }

  setContentBounds(b: ContentBounds) {
    this.bounds = b;
    this.repositionViews();
  }

  // Текущий прямоугольник области контента (последний, присланный renderer). Нужен, чтобы засеять
  // им НОВОЕ окно при выносе вкладки: у свежего окна bounds ещё {0,0,0,0}, и принятая вкладка
  // висела бы 0×0 (невидимой), пока React нового окна не смонтируется и не пришлёт свой первый
  // bounds. См. main.ts::moveTabToNewWindow.
  get contentBounds(): ContentBounds {
    return this.bounds;
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
    return this.#splitPaneBounds(tabId === pair.leftId ? 'left' : 'right', pair.splitRatio);
  }

  // Прямоугольник СТРАНИЦЫ одной панели сплита: половина области контента минус полоса заголовка
  // сверху (её рисует React, см. shared/layout.ts) и минус кант карточки со всех сторон —
  // разбор канта там же, в SPLIT_PANE_INSET. Одна формула на getTabViewBounds и repositionViews:
  // раньше она стояла в обоих местах двумя копиями и при любой правке разъезжалась.
  #splitPaneBounds(side: 'left' | 'right', splitRatio: number): ContentBounds {
    return splitPaneBounds(this.bounds, side, splitRatio);
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
    // Split: страницы двух панелей — по #splitPaneBounds (половина области контента минус шапка
    // и минус кант карточки).
    const { leftId, rightId, splitRatio } = pair;

    // ⚠️ Пока панель несут (applyPanelDragLayout), раскладка другая, и она обязана переживать
    // ресайз окна: без этой ветки первый же ResizeObserver рендерера вернул бы несомую страницу
    // на место и показал её — прямо в руке у человека.
    const drag = this.panelDrag;
    if (drag && (drag.tabId === leftId || drag.tabId === rightId)) {
      const otherId = drag.tabId === leftId ? rightId : leftId;
      const otherSide: 'left' | 'right' = otherId === leftId ? 'left' : 'right';
      const carriedSide: 'left' | 'right' = otherSide === 'left' ? 'right' : 'left';
      this.applySplitBounds(otherId, this.#splitPaneBounds(drag.preview ? carriedSide : otherSide, splitRatio));
      const carried = this.tabMap.get(drag.tabId);
      if (carried && this.isLiveHttpView(carried.view)) carried.view.setVisible(false);
      return;
    }

    this.applySplitBounds(leftId,  this.#splitPaneBounds('left',  splitRatio));
    this.applySplitBounds(rightId, this.#splitPaneBounds('right', splitRatio));
  }

  // Позиционирует одну split-панель; при ошибке скрывает вьюху (React рисует TabError).
  private applySplitBounds(id: string, b: ContentBounds): void {
    if (this.slideGen.has(id)) return;   // панель ещё едет — не сбивать её на месте
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
    tab.view.setBorderRadius(SPLIT_PANE_RADIUS);
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
