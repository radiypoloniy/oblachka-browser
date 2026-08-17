import type { SearchEngineId } from '../searchEngines';
import type { GraphChatMessage, GraphDoc, GraphMeta, GraphNodeVersion, GraphProgress, GraphStructure } from '../graph';
import type { ImagePreset } from '../imagePresets';
import type { AutomationRule } from '../rules';
import type { ContentBounds, FindResult, OrganizeCluster, OrganizeProposal, RuleParseOutcome, SearchChipCandidate, SearchChipsConfig, SidebarNode, SpecialTabKind, SyncState, TabState } from './core';
import type { BackfillProgress, BookmarkEntry, BookmarkFolderProposal, BookmarkImportResult, BookmarkImportSource, BookmarkNode, DayDigestState, HistoryClearPeriod, HistoryContentCoverage, HistoryEntry, ImportDataType, ImportRunResult, ImportSource, SemanticSearchResult, SmartSearchResponse, TitleBarOpts } from './history';
import type { PasswordAddInput, PasswordCopyField, PasswordGenerateOptions, PasswordIndicatorState, PasswordMeta, PasswordUpdateInput, VpnConnectionState, VpnServerMeta, VpnStatus, VpnSubscriptionResult } from './security';
import type { AdBlockState, DownloadEntry, MatchSuggestion, OmniboxPanel, OmniboxRecommendEdit, PageChangesResult, ParsedAddressPart, ProductState, RecommendedSite, SmartTabHit, StuffHit, SuggestDropdownItem, TrackedProduct, TrackingEvent } from './omnibox';
import type { BangDefWire, BangsSnapshot, BergamotStatus, CatalogEntry, DeleteModelResult, DerivedBangCandidate, DownloadProgress, HardwareSnapshot, HubChatMessage, HubChatOutcome, HubChatSessionMeta, HubMode, ImportBangsResult, InstalledModel, ModelDownloadSpec, ModelLoadMode, PageTranslateProgress, PageTranslateState, PermKey, PermissionRecord, SetDefaultModelResult, Skill, TranslationEngineId, UpdateStatus } from './ai';
import type { AddressInput, AddressProfile, AddressUpdate, CardInput, CardMeta, CardUpdate, CryptoRatesInfo, CurrencyRatesInfo, DefaultBrowserRequest, DragCard, NextHolidayInfo, SplitSwapHint, TabDropResult, TabDropZone, ThemeMode, ThemePaletteId, ThemePrefs, WeatherInfo, WindowRole } from './app';

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
  // Сигнал «оболочка отрисована» — main показывает скрытое до этого окно (см. IPC.CHROME_UI_READY).
  chromeUiReady(): void;

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
  // Заход 11 — панель по нетронутой строке (см. OmniboxPanel). Второй режим ТОЙ ЖЕ вью: что
  // прислали последним, то и нарисовано.
  setSuggestDropdownPanel(panel: OmniboxPanel): Promise<void>;
  // Человек кликнул полоску сайта в панели — Toolbar.tsx открывает поповер замочка.
  onSuggestDropdownSiteInfo(cb: () => void): () => void;
  // Правка «Рекомендуемых» карандашом в панели (см. OmniboxRecommendEdit).
  onSuggestDropdownRecommend(cb: (edit: OmniboxRecommendEdit) => void): () => void;
  getRecommendedSites(): Promise<RecommendedSite[]>;
  setRecommendedSites(list: RecommendedSite[]): Promise<void>;

  // Сайты, защищённые от выгрузки из памяти. Ставится галочкой в ПКМ-меню вкладки, снимается там
  // же или здесь; правило про САЙТ, а не про вкладку — закрытая вкладка его не уносит.
  listNeverSleepSites(): Promise<string[]>;
  removeNeverSleepSite(host: string): Promise<void>;
  onNeverSleepChanged(cb: () => void): () => void;
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
