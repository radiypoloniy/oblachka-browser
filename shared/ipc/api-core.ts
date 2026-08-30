// Контракт main ↔ renderer, часть core: Оболочка окна: вкладки, сайдбар, омнибокс, split, группы, поиск по странице, тема.
//
// ⚠️ Разрезано по ДОМЕНАМ, а не по объёму. Единый OblakoApi перевалил за 700 строк — порог, на
// котором список интерфейсов перестаёт читаться и начинает просматриваться. Домены выбраны те
// же, что у обработчиков в electron/ipc/ и у разделов документации, чтобы «где искать» был один
// вопрос, а не три.
//
// ⚠️ Сам OblakoApi по-прежнему ОДИН тип (api.ts наследует все части): звать его из renderer'а
// приходится как единое window.oblako, и дробить эту точку входа было бы правдой про файлы, а не
// про программу.
import type { ContentBounds, FindResult, SidebarNode, SpecialTabKind, SyncState, TabState } from './core';
import type { BookmarkEntry, DayDigestState, HistoryClearPeriod, HistoryEntry, SemanticSearchResult, SmartSearchResponse, TitleBarOpts } from './history';
import type { AdBlockState, MatchSuggestion, PageChangesResult, ParsedAddressPart, ProductState, SmartTabHit, StuffHit, TrackedProduct, TrackingEvent } from './omnibox';
import type { AiActivityState } from './ai';
import type { CryptoRatesInfo, CurrencyRatesInfo, DragCard, NextHolidayInfo, SplitSwapHint, TabDropResult, TabDropZone, ThemeMode, ThemePaletteId, ThemePrefs, TimerState, WeatherInfo, WindowRole } from './app';


export interface CoreApi {
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
  createSpecialTab(kind: SpecialTabKind, section?: string): Promise<string>;
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
  // Меню «⋯» в адресной строке. Состояние (что переводится, есть ли цена) main берёт у себя —
  // renderer только просит показать.
  showOmniboxMoreMenu(): Promise<void>;
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
  // Начальный счётчик буфера: подписка ниже приходит только на ИЗМЕНЕНИЯ, а закреплённое
  // поднимается с диска ещё до неё.
  getClipboardCount(): Promise<number>;
  onClipboardChanged(cb: (count: number) => void): () => void;
  /** Человек правит адресную строку — пока это так, Escape принадлежит омнибоксу, не странице. */
  setOmniboxEditing(on: boolean): void;
  /** Мышь пришла на кнопку поповера — построить его вью заранее (см. IPC.POPOVER_PREWARM). */
  prewarmPopover(kind: 'clipboard'): void;
  toggleClipboardPopover(): Promise<void>;
  syncClipboardPopoverBounds(b: ContentBounds): void;
  onClipboardPopoverClosed(cb: () => void): () => void;
  onTrackingChanged(cb: () => void): () => void;
  /** Поиск по настройкам фразой — второй эшелон, отдаёт индексы SETTINGS_INDEX (settingsIndex.ts). */
  searchSettingsSmart(query: string): Promise<number[]>;
  /** Страницы из своей истории, связанные с открытой сейчас. Пусто — нечего показать. */
  getRelatedPages(): Promise<SemanticSearchResult[]>;
  /**
   * «Изменилось с прошлого раза» для открытой страницы (см. PageChanges.ts). ⚠️ Не бесплатно:
   * достаёт текст живой страницы и сравнивает со снимком, поэтому вызывающая сторона обязана
   * спрашивать РАЗ на адрес, а не на каждое открытие панели (Toolbar.tsx кэширует по url).
   */
  getPageChanges(): Promise<PageChangesResult>;
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
  // card — что нести в руке над страницей: имя и значок. Рисует карточку оверлей (чром над
  // областью контента не виден), поэтому и данные для неё уходят в main сразу на старте.
  tabDragStart(card: DragCard | null): Promise<void>;
  tabDragEnd(): Promise<TabDropResult>;
  // Зона под курсором, пока тащат вкладку. Чрому нужна ровно затем, чтобы спрятать СВОЙ призрак,
  // когда курсор ушёл на страницу: там карточку ведёт оверлей, и две вещи разом читались бы как
  // сбой. null — курсор над чромом (сайдбар/тулбар), призрак рисует чром.
  onTabDragZone(cb: (zone: TabDropZone | null) => void): () => void;
  /** Жест закрыт страховкой в main (pointerup не доехал до хрома) — вот его исход. */
  onTabDragFinished(cb: (res: TabDropResult) => void): () => void;
  // Сигнал «оболочка отрисована» — main показывает скрытое до этого окно (см. IPC.CHROME_UI_READY).
  chromeUiReady(): void;
  /**
   * Модальный экран в хроме висит/снят.
   *
   * ⚠️ Обязателен для любой модалки, нарисованной React по центру окна: WebContentsView
   * страницы лежит ПОВЕРХ React-рамки, и без этого человек видит затемнение по краям без
   * самой карточки (живой случай 23.08 — выбор профиля при старте).
   */
  setChromeModal(on: boolean): Promise<void>;

  // Поиск по странице
  findStart(query: string, forward: boolean): Promise<void>;
  findNext(forward: boolean): Promise<void>;
  findStop(): Promise<void>;
  onFindResult(cb: (r: FindResult) => void): () => void;

  // Омнибокс
  onOmniboxFocus(cb: () => void): () => void;

  // Закреплённые вкладки
  togglePinTab(id: string): Promise<void>;
  setTabMuted(id: string, muted: boolean): Promise<void>; // выключить/включить звук вкладки
  showTabMenu(id: string): Promise<void>;
  showNewTabMenu(): Promise<void>; // ПКМ по кнопке «Новая вкладка»: обычная / инкогнито / восстановить
  setChromeTheme(dark: boolean, incognito: boolean, palette: ThemePaletteId, wash?: { accent: string; tint: string } | null): Promise<void>; // раздать тему во все chrome-вью (поповеры). wash — акцент от сетки окна, null сбрасывает.

  // Тема оформления (см. ThemePrefs). setTheme пишет выбор на диск и рассылает его во все окна —
  // применяет тему по-прежнему сам рендерер, у себя на documentElement.
  getTheme(): Promise<ThemePrefs>;
  setTheme(mode: ThemeMode, palette: ThemePaletteId): Promise<void>;
  onThemeChanged(cb: (prefs: ThemePrefs) => void): () => void;

  getWeather(city: string): Promise<WeatherInfo>; // погода для виджета новой вкладки
  /** Таймер стола: состояние держит main, виджет только показывает (см. TimerService.ts). */
  getTimer(): Promise<TimerState>;
  setTimer(next: Partial<TimerState>): Promise<TimerState>;
  onTimerChanged(cb: (state: TimerState) => void): () => void;
  getCurrencyRates(): Promise<CurrencyRatesInfo>;
  /** Ближайший госпраздник. Новый получатель данных (date.nager.at), наружу уходит только код страны. */
  getNextHoliday(country?: string): Promise<NextHolidayInfo>; // курсы ЦБ РФ для виджета новой вкладки
  getCryptoRates(): Promise<CryptoRatesInfo>;     // курсы криптовалют для виджета «Крипта»
  getNewtabPhoto(): Promise<{ ok: boolean; dataUrl?: string }>; // «фото дня» для фона новой вкладки
  /** «Другое фото» — шаг назад по календарю Wikimedia, ответ приходит уже новым снимком. */
  shuffleNewtabPhoto(): Promise<{ ok: boolean; dataUrl?: string }>;
  extractNotebookUrl(url: string): Promise<{ ok: boolean; title?: string; text?: string }>; // текст URL-источника блокнота
  generateStudio(kind: string, context: string, sources?: { title: string; url: string }[]): Promise<{ ok: boolean; text?: string; error?: string }>; // материал Студии блокнота
  // «Собрать материал»: сначала предложить запросы, потом — по команде человека — искать.
  suggestNotebookQueries(topic: string, context: string): Promise<{ ok: boolean; queries?: string[]; error?: string }>;
  searchNotebook(queries: string[]): Promise<{ ok: boolean; hits?: { title: string; url: string; snippet: string }[]; error?: string }>;
  saveNotebookDoc(name: string, html: string): Promise<boolean>; // выгрузка документа Студии одним .html
  /** Ход сборки документа: знаков сгенерировано. Возвращает отписку. */
  onStudioProgress(cb: (chars: number) => void): () => void;
  /** Диалог выбора локальных документов для блокнота. Текст ещё не читается — только пути. */
  pickNotebookFiles(): Promise<{ path: string; name: string }[]>;
  /** Текст локального документа: pdf, docx, txt, md, csv, json, log. */
  extractNotebookFile(path: string): Promise<{ ok: boolean; title?: string; text?: string }>;
  /** Открыть источник: адрес — новой вкладкой, файл — системной программой. */
  openNotebookSource(kind: 'url' | 'file', target: string): Promise<boolean>;
  /** Открыть собранный документ новой вкладкой (через временный файл). */
  openStudioDoc(name: string, html: string): Promise<boolean>;
  /** Та же страница, но напечатанная в PDF (скрытая вью + printToPDF). */
  savePageAsPdf(name: string, html: string): Promise<boolean>;
  /** Что ИИ делает прямо сейчас, или null. cancel возвращает false, если прерывать было нечего. */
  getAiActivity(): Promise<AiActivityState | null>;
  cancelAiActivity(): Promise<boolean>;
  onAiActivityChanged(cb: (state: AiActivityState | null) => void): () => void;

  // Split View
  // side — какую половину займёт ПРИВОДИМАЯ вкладка (по умолчанию правую: так входят в сплит
  // из контекстного меню ссылки, где стороне взяться неоткуда). Перетаскивание же передаёт
  // сторону, за которую человек тянул, — иначе жест обещает одно, а делает другое.
  enterSplit(tabId: string, side?: 'left' | 'right'): Promise<void>;
  // Занять половину показываемой пары вкладкой из списка. Выселенная панель не закрывается —
  // возвращается в список обычной вкладкой сразу за парой, из которой вышла.
  replaceSplitPanel(panelId: string, newId: string): Promise<void>;
  // keepId — какая панель НАЙДЕННОЙ пары остаётся активной (по умолчанию текущая активная).
  // Нужен жесту «вытащить половину в список»: активной обязана остаться та, которую НЕ тащили.
  exitSplit(tabId: string, keepId?: string): Promise<void>; // схлопнуть пару, содержащую tabId; обе вкладки остаются
  focusSplitPanel(side: 'left' | 'right'): Promise<void>; // переключить активную панель
  setSplitRatio(ratio: number): Promise<void>;      // drag разделителя: 0.2..0.8
  swapSplitPanels(tabId: string): Promise<void>;    // половины пары меняются местами; ширины слотов не меняются
  // Подсветка панели-цели во время перетаскивания половины за шапку; null — убрать оверлей.
  setSplitSwapHint(hint: SplitSwapHint | null): Promise<void>;
  // Курсор для призрака, который едет поверх страницы; null — курсор ушёл с области контента.
  sendSplitDragCursor(pos: { x: number; y: number } | null): void;
  // Снимок панели (data-URL) для карточки в руке; width/maxHeight — в пикселях самой картинки.
  captureSplitPane(tabId: string, width: number, maxHeight: number): Promise<string | null>;
  // Тот же снимок — оверлею, чтобы над страницей он вёл ту же карточку, а не другую.
  sendSplitDragThumb(thumb: string | null): void;

  // Переупорядочивание drag-and-drop
  reorderTabs(section: 'normal' | 'pinned', orderedIds: string[]): Promise<void>;
  moveTabSection(tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number): Promise<void>;

  // Структура сайдбара (дерево узлов)
  getSidebarNodes(): Promise<SidebarNode[]>;

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
  // Посайтовые сведения для полоски сайта в панели омнибокса — те же каналы, которыми уже
  // пользуется поповер замочка (preload-sitepopover.ts). Новых обработчиков в main не появилось.
  getSiteBlockedCount(domain: string): Promise<number>;
  isAdblockAllowed(domain: string): Promise<boolean>;

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
}
