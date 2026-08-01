import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { OblakoApi, SyncState, TabState, ContentBounds, TitleBarOpts, FindResult, AdBlockState, HistoryEntry, HistoryClearPeriod, BookmarkEntry, BookmarkImportSource, BookmarkImportResult, ImportSource, ImportDataType, ImportRunResult, AddressProfile, AddressInput, AddressUpdate, CardMeta, CardInput, CardUpdate, WeatherInfo, CurrencyRatesInfo, DownloadEntry, PermissionRequest, SidebarNode, OrganizeCluster, OrganizeProposal, SuggestDropdownItem, BackfillProgress, HistoryContentCoverage, SmartSearchResponse, VpnStatus, VpnServerMeta, VpnSubscriptionResult, VpnConnectionState, PasswordMeta, PasswordAddInput, PasswordUpdateInput, PasswordCopyField, PasswordGenerateOptions, PasswordIndicatorState, HubMode, ModelLoadMode, HubChatMessage, HubChatSessionMeta, HubChatOutcome, PageTranslateState, PageTranslateProgress, TranslationEngineId, BergamotStatus, Skill, HardwareSnapshot, DownloadProgress, ModelDownloadSpec, CatalogEntry, DeleteModelResult, InstalledModel, SetDefaultModelResult, UpdateStatus, BangsSnapshot, BangDefWire, ImportBangsResult, DerivedBangCandidate, SearchChipsConfig, SearchChipCandidate } from '../shared/ipc';
import type { SearchEngineId } from '../shared/searchEngines';
import type {
  GraphChatMessage, GraphDoc, GraphMeta, GraphNodeVersion, GraphProgress, GraphStructure,
} from '../shared/graph';
import type { ImagePreset } from '../shared/imagePresets';

const api: OblakoApi = {
  getAllTabs: () => ipcRenderer.invoke(IPC.TABS_GET_ALL),
  createTab: (url?: string) => ipcRenderer.invoke(IPC.TAB_CREATE, url),
  createIncognitoTab: (url?: string) => ipcRenderer.invoke(IPC.TAB_CREATE_INCOGNITO, url) as Promise<string>,
  createSpecialTab: (kind: 'history' | 'settings' | 'bookmarks', section?: string) => ipcRenderer.invoke(IPC.TAB_CREATE_SPECIAL, kind, section),
  closeTab: (id: string) => ipcRenderer.invoke(IPC.TAB_CLOSE, id),
  activateTab: (id: string) => ipcRenderer.invoke(IPC.TAB_ACTIVATE, id),
  navigate: (id: string, input: string) => ipcRenderer.invoke(IPC.TAB_NAVIGATE, id, input),
  goBack: (id: string) => ipcRenderer.invoke(IPC.TAB_GO_BACK, id),
  goForward: (id: string) => ipcRenderer.invoke(IPC.TAB_GO_FORWARD, id),
  reload: (id: string) => ipcRenderer.invoke(IPC.TAB_RELOAD, id),
  setContentBounds: (b: ContentBounds) => ipcRenderer.invoke(IPC.CONTENT_SET_BOUNDS, b),
  setOmniboxBounds: (b: ContentBounds) => ipcRenderer.invoke(IPC.OMNIBOX_SET_BOUNDS, b),
  setTitleBarOverlay: (opts: TitleBarOpts) => ipcRenderer.invoke(IPC.WINDOW_SET_OVERLAY, opts),
  chromeUiReady: () => ipcRenderer.send(IPC.CHROME_UI_READY),
  onTabsChanged: (cb: (tabs: TabState[]) => void) => {
    const handler = (_e: unknown, tabs: TabState[]) => cb(tabs);
    ipcRenderer.on(IPC.TABS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.TABS_CHANGED, handler);
  },

  findStart: (query: string, forward: boolean) => ipcRenderer.invoke(IPC.FIND_START, query, forward),
  findNext:  (forward: boolean)                => ipcRenderer.invoke(IPC.FIND_NEXT, forward),
  findStop:  ()                                => ipcRenderer.invoke(IPC.FIND_STOP),

  onFindResult: (cb: (r: FindResult) => void) => {
    const handler = (_e: unknown, r: FindResult) => cb(r);
    ipcRenderer.on(IPC.FIND_RESULT, handler);
    return () => ipcRenderer.removeListener(IPC.FIND_RESULT, handler);
  },
  onFindOpen: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.FIND_OPEN, handler);
    return () => ipcRenderer.removeListener(IPC.FIND_OPEN, handler);
  },
  onFindClose: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.FIND_CLOSE, handler);
    return () => ipcRenderer.removeListener(IPC.FIND_CLOSE, handler);
  },

  onOmniboxFocus: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.OMNIBOX_FOCUS, handler);
    return () => ipcRenderer.removeListener(IPC.OMNIBOX_FOCUS, handler);
  },

  togglePinTab: (id: string) => ipcRenderer.invoke(IPC.TAB_PIN_TOGGLE, id),
  showTabMenu:  (id: string) => ipcRenderer.invoke(IPC.TAB_SHOW_MENU, id),
  showNewTabMenu: () => ipcRenderer.invoke(IPC.NEW_TAB_SHOW_MENU) as Promise<void>,
  setChromeTheme: (dark: boolean, incognito: boolean) => ipcRenderer.invoke(IPC.CHROME_THEME_SET, dark, incognito) as Promise<void>,
  getWeather: (city: string) => ipcRenderer.invoke(IPC.WEATHER_GET, city) as Promise<WeatherInfo>,
  getCurrencyRates: () => ipcRenderer.invoke(IPC.CURRENCY_GET) as Promise<CurrencyRatesInfo>,
  getNewtabPhoto: () => ipcRenderer.invoke(IPC.NEWTAB_PHOTO_GET) as Promise<{ ok: boolean; dataUrl?: string }>,
  extractNotebookUrl: (url: string) => ipcRenderer.invoke(IPC.NOTEBOOK_EXTRACT_URL, url) as Promise<{ ok: boolean; title?: string; text?: string }>,
  generateStudio: (kind: string, context: string) => ipcRenderer.invoke(IPC.NOTEBOOK_STUDIO_GEN, kind, context) as Promise<{ ok: boolean; text?: string; error?: string }>,

  enterSplit:      (rightId: string)            => ipcRenderer.invoke(IPC.TAB_ENTER_SPLIT, rightId),
  exitSplit:       (tabId: string)              => ipcRenderer.invoke(IPC.TAB_EXIT_SPLIT, tabId),
  focusSplitPanel: (side: 'left' | 'right')    => ipcRenderer.invoke(IPC.TAB_SPLIT_FOCUS, side),
  setSplitRatio:   (ratio: number)             => ipcRenderer.invoke(IPC.TAB_SPLIT_RATIO, ratio),

  reorderTabs: (section: 'normal' | 'pinned', orderedIds: string[]) =>
    ipcRenderer.invoke(IPC.TAB_REORDER, section, orderedIds),

  moveTabSection: (tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number) =>
    ipcRenderer.invoke(IPC.TAB_MOVE_SECTION, tabId, targetSection, targetIndex),

  // AdBlock
  getAdBlockState:     ()                  => ipcRenderer.invoke(IPC.ADBLOCK_GET_STATE),
  setAdBlockEnabled:   (v: boolean)        => ipcRenderer.invoke(IPC.ADBLOCK_SET_ENABLED, v),
  adBlockAddDomain:    (d: string)         => ipcRenderer.invoke(IPC.ADBLOCK_ADD_DOMAIN, d),
  adBlockRemoveDomain: (d: string)         => ipcRenderer.invoke(IPC.ADBLOCK_REMOVE_DOMAIN, d),
  adBlockReloadTabs:   (d?: string)        => ipcRenderer.invoke(IPC.ADBLOCK_RELOAD_TABS, d),
  onAdBlockStateChanged: (cb: (state: AdBlockState) => void) => {
    const handler = (_e: unknown, state: AdBlockState) => cb(state);
    ipcRenderer.on(IPC.ADBLOCK_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.ADBLOCK_STATE_CHANGED, handler);
  },

  // История посещений
  getHistory:         (limit?: number)              => ipcRenderer.invoke(IPC.HISTORY_GET, limit) as Promise<HistoryEntry[]>,
  searchHistory:      (query: string)               => ipcRenderer.invoke(IPC.HISTORY_SEARCH, query) as Promise<HistoryEntry[]>,
  deleteHistoryEntry: (id: number)                  => ipcRenderer.invoke(IPC.HISTORY_DELETE, id),
  clearHistory:       (period: HistoryClearPeriod)  => ipcRenderer.invoke(IPC.HISTORY_CLEAR, period),
  onHistoryOpen: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.HISTORY_OPEN, handler);
    return () => ipcRenderer.removeListener(IPC.HISTORY_OPEN, handler);
  },
  searchHistorySmart: (query: string) =>
    ipcRenderer.invoke(IPC.HISTORY_SEARCH_SMART, query) as Promise<SmartSearchResponse>,

  // Закладки
  addBookmark: (url: string, title: string) =>
    ipcRenderer.invoke(IPC.BOOKMARK_ADD, url, title) as Promise<BookmarkEntry | null>,
  removeBookmark: (id: number) => ipcRenderer.invoke(IPC.BOOKMARK_REMOVE, id),
  removeBookmarkByUrl: (url: string) => ipcRenderer.invoke(IPC.BOOKMARK_REMOVE_BY_URL, url),
  listBookmarks: () => ipcRenderer.invoke(IPC.BOOKMARK_LIST) as Promise<BookmarkEntry[]>,
  isBookmarked: (url: string) => ipcRenderer.invoke(IPC.BOOKMARK_IS_BOOKMARKED, url) as Promise<boolean>,
  onBookmarksChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.BOOKMARK_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.BOOKMARK_CHANGED, handler);
  },
  listBookmarkImportSources: () =>
    ipcRenderer.invoke(IPC.BOOKMARK_IMPORT_LIST_SOURCES) as Promise<BookmarkImportSource[]>,
  runBookmarkImport: (sourceId: string) =>
    ipcRenderer.invoke(IPC.BOOKMARK_IMPORT_RUN, sourceId) as Promise<BookmarkImportResult | null>,

  // Общий мультитиповый импорт (закладки/история/пароли) — диалог импорта + онбординг.
  listImportSources: () =>
    ipcRenderer.invoke(IPC.IMPORT_LIST_SOURCES) as Promise<ImportSource[]>,
  runImport: (sourceId: string, dataTypes: ImportDataType[]) =>
    ipcRenderer.invoke(IPC.IMPORT_RUN, sourceId, dataTypes) as Promise<ImportRunResult>,
  shouldOfferImport: () =>
    ipcRenderer.invoke(IPC.IMPORT_SHOULD_OFFER) as Promise<boolean>,
  markImportOffered: () =>
    ipcRenderer.invoke(IPC.IMPORT_MARK_OFFERED) as Promise<void>,

  getHistoryContentCoverage: () =>
    ipcRenderer.invoke(IPC.HISTORY_CONTENT_COVERAGE) as Promise<HistoryContentCoverage>,

  // Рискованный бэкфилл полного текста — тихое переоткрытие старых URL (electron/HistoryContentBackfill.ts).
  startHistoryContentBackfill:  () => ipcRenderer.send(IPC.HISTORY_CONTENT_BACKFILL_START),
  cancelHistoryContentBackfill: () => ipcRenderer.send(IPC.HISTORY_CONTENT_BACKFILL_CANCEL),
  getHistoryContentBackfillStatus: () =>
    ipcRenderer.invoke(IPC.HISTORY_CONTENT_BACKFILL_STATUS) as Promise<BackfillProgress>,
  onHistoryContentBackfillProgress: (cb: (p: BackfillProgress) => void) => {
    const handler = (_e: unknown, p: BackfillProgress) => cb(p);
    ipcRenderer.on(IPC.HISTORY_CONTENT_BACKFILL_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.HISTORY_CONTENT_BACKFILL_PROGRESS, handler);
  },

  // Загрузки
  getDownloads:       ()             => ipcRenderer.invoke(IPC.DOWNLOADS_GET_ALL) as Promise<DownloadEntry[]>,
  pauseDownload:      (id: string)   => ipcRenderer.invoke(IPC.DOWNLOAD_PAUSE, id),
  resumeDownload:     (id: string)   => ipcRenderer.invoke(IPC.DOWNLOAD_RESUME, id),
  cancelDownload:     (id: string)   => ipcRenderer.invoke(IPC.DOWNLOAD_CANCEL, id),
  clearDownload:      (id: string)   => ipcRenderer.invoke(IPC.DOWNLOAD_CLEAR, id),
  openDownloadFile:   (id: string)   => ipcRenderer.invoke(IPC.DOWNLOAD_OPEN_FILE, id),
  showDownloadFolder: (id: string)   => ipcRenderer.invoke(IPC.DOWNLOAD_SHOW_FOLDER, id),
  retryDownload:      (id: string)   => ipcRenderer.invoke(IPC.DOWNLOAD_RETRY, id),
  onDownloadsChanged: (cb: (entries: DownloadEntry[]) => void) => {
    const handler = (_e: unknown, entries: DownloadEntry[]) => cb(entries);
    ipcRenderer.on(IPC.DOWNLOADS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.DOWNLOADS_CHANGED, handler);
  },
  onDownloadsOpen: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.DOWNLOADS_OPEN, handler);
    return () => ipcRenderer.removeListener(IPC.DOWNLOADS_OPEN, handler);
  },

  // Разрешения сайтов
  respondPermission: (requestId: string, granted: boolean, remember: boolean) =>
    ipcRenderer.invoke(IPC.PERMISSION_RESPONSE, requestId, granted, remember),
  onPermissionRequest: (cb: (req: PermissionRequest) => void) => {
    const handler = (_e: unknown, req: PermissionRequest) => cb(req);
    ipcRenderer.on(IPC.PERMISSION_REQUEST, handler);
    return () => ipcRenderer.removeListener(IPC.PERMISSION_REQUEST, handler);
  },

  // Атомарный снимок состояния (вкладки + узлы сайдбара в одном сообщении)
  getSyncState: () => ipcRenderer.invoke(IPC.SYNC_GET) as Promise<SyncState>,
  onSyncChanged: (cb: (state: SyncState) => void) => {
    const handler = (_e: unknown, state: SyncState) => cb(state);
    ipcRenderer.on(IPC.SYNC_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.SYNC_CHANGED, handler);
  },

  // Структура сайдбара (дерево узлов)
  getSidebarNodes: () => ipcRenderer.invoke(IPC.SIDEBAR_NODES_GET) as Promise<SidebarNode[]>,
  onSidebarNodesChanged: (cb: (nodes: SidebarNode[]) => void) => {
    const handler = (_e: unknown, nodes: SidebarNode[]) => cb(nodes);
    ipcRenderer.on(IPC.SIDEBAR_NODES_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.SIDEBAR_NODES_CHANGED, handler);
  },

  // Группы вкладок
  createGroup:          (tabId: string)                       => ipcRenderer.invoke(IPC.GROUP_CREATE,           tabId),
  addTabToGroup:        (groupId: string, tabId: string)      => ipcRenderer.invoke(IPC.GROUP_ADD_TAB,          groupId, tabId),
  removeTabFromGroup:   (groupId: string, tabId: string)      => ipcRenderer.invoke(IPC.GROUP_REMOVE_TAB,       groupId, tabId),
  renameGroup:          (groupId: string, label: string)      => ipcRenderer.invoke(IPC.GROUP_RENAME,           groupId, label),
  setGroupColor:        (groupId: string, color: string|null) => ipcRenderer.invoke(IPC.GROUP_COLOR,            groupId, color),
  toggleGroupCollapse:  (groupId: string)                     => ipcRenderer.invoke(IPC.GROUP_TOGGLE_COLLAPSE,  groupId),
  disbandGroup:         (groupId: string)                     => ipcRenderer.invoke(IPC.GROUP_DISBAND,          groupId),
  reorderGroupChildren: (groupId: string, ids: string[])      => ipcRenderer.invoke(IPC.GROUP_REORDER_CHILDREN, groupId, ids),
  showGroupMenu:        (groupId: string)                     => ipcRenderer.invoke(IPC.GROUP_SHOW_MENU,        groupId),
  onGroupRenamePrompt: (cb: (groupId: string) => void) => {
    const handler = (_e: unknown, groupId: string) => cb(groupId);
    ipcRenderer.on(IPC.GROUP_RENAME_PROMPT, handler);
    return () => ipcRenderer.removeListener(IPC.GROUP_RENAME_PROMPT, handler);
  },

  // AI-группировка вкладок (Phase 4)
  organizeApply:    (clusters: OrganizeCluster[]) => ipcRenderer.invoke(IPC.TABS_ORGANIZE_APPLY,    clusters) as Promise<void>,
  organizeRollback: ()                            => ipcRenderer.invoke(IPC.TABS_ORGANIZE_ROLLBACK)            as Promise<void>,
  suggestGroups:    ()                            => ipcRenderer.invoke(IPC.TABS_SUGGEST_GROUPS)     as Promise<OrganizeProposal>,

  // Правая AI-панель (заход 3 — поповер → правый split-view-подобный док)
  toggleAiPanel: () => ipcRenderer.invoke(IPC.AI_PANEL_TOGGLE) as Promise<boolean>,
  getAiPanelWidth: () => ipcRenderer.invoke(IPC.SETTINGS_GET_AI_PANEL_WIDTH) as Promise<number>,
  // ad-hoc (не typed IPC) — тот же принцип, что остальная AI-panel-механика (ai-panel:*):
  // fire-and-forget на каждый тик драга разделителя, как и остальные ai-panel:* каналы.
  resizeAiPanel: (widthPx: number) => ipcRenderer.send('ai-panel:resize', widthPx),
  onAiPanelStateChanged: (cb: (open: boolean) => void) => {
    const handler = (_e: unknown, open: boolean) => cb(open);
    ipcRenderer.on(IPC.AI_PANEL_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.AI_PANEL_STATE_CHANGED, handler);
  },

  // Полностраничный перевод — fire-and-forget, актуальное состояние приходит push'ем.
  togglePageTranslate: () => ipcRenderer.send(IPC.PAGE_TRANSLATE_TOGGLE),
  getPageTranslateState: () => ipcRenderer.invoke(IPC.PAGE_TRANSLATE_GET_STATE) as Promise<PageTranslateState>,
  onPageTranslateStateChanged: (cb: (state: PageTranslateState) => void) => {
    const handler = (_e: unknown, state: PageTranslateState) => cb(state);
    ipcRenderer.on(IPC.PAGE_TRANSLATE_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.PAGE_TRANSLATE_STATE_CHANGED, handler);
  },
  onPageTranslateProgressChanged: (cb: (progress: PageTranslateProgress | null) => void) => {
    const handler = (_e: unknown, progress: PageTranslateProgress | null) => cb(progress);
    ipcRenderer.on(IPC.PAGE_TRANSLATE_PROGRESS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.PAGE_TRANSLATE_PROGRESS_CHANGED, handler);
  },

  // Выбор движка перевода страниц (Settings.tsx, секция AI) — см. TranslationEngineRegistry.ts.
  getTranslationEngine: () => ipcRenderer.invoke(IPC.TRANSLATION_ENGINE_GET) as Promise<TranslationEngineId>,
  setTranslationEngine: (id: TranslationEngineId) => ipcRenderer.invoke(IPC.TRANSLATION_ENGINE_SET, id) as Promise<void>,
  getBergamotStatus: () => ipcRenderer.invoke(IPC.TRANSLATION_ENGINE_GET_BERGAMOT_STATUS) as Promise<BergamotStatus>,
  onBergamotStatusChanged: (cb: (status: BergamotStatus) => void) => {
    const handler = (_e: unknown, status: BergamotStatus) => cb(status);
    ipcRenderer.on(IPC.TRANSLATION_ENGINE_BERGAMOT_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.TRANSLATION_ENGINE_BERGAMOT_STATUS_CHANGED, handler);
  },

  // Дропдаун подсказок омнибокса (нативная вью)
  setSuggestDropdownOpen: (open: boolean) => ipcRenderer.invoke(IPC.SUGGEST_DROPDOWN_TOGGLE, open) as Promise<void>,
  setSuggestDropdownItems: (items: SuggestDropdownItem[]) => ipcRenderer.invoke(IPC.SUGGEST_DROPDOWN_SET_ITEMS, items) as Promise<void>,
  onSuggestDropdownPicked: (cb: (item: SuggestDropdownItem) => void) => {
    const handler = (_e: unknown, item: SuggestDropdownItem) => cb(item);
    ipcRenderer.on(IPC.SUGGEST_DROPDOWN_PICKED, handler);
    return () => ipcRenderer.removeListener(IPC.SUGGEST_DROPDOWN_PICKED, handler);
  },
  setSuggestDropdownHighlight: (idx: number) => ipcRenderer.invoke(IPC.SUGGEST_DROPDOWN_HIGHLIGHT, idx) as Promise<void>,
  onSuggestDropdownContentFocus: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.SUGGEST_DROPDOWN_CONTENT_FOCUS, handler);
    return () => ipcRenderer.removeListener(IPC.SUGGEST_DROPDOWN_CONTENT_FOCUS, handler);
  },

  // Заход 10 — живые suggest-подсказки текущего поисковика.
  fetchSuggestions: (query: string) => ipcRenderer.invoke(IPC.SEARCH_SUGGEST, query) as Promise<string[]>,

  // Настройки
  getSearchEngine: () => ipcRenderer.invoke(IPC.SETTINGS_GET_SEARCH_ENGINE) as Promise<SearchEngineId>,
  setSearchEngine: (id: SearchEngineId) => ipcRenderer.invoke(IPC.SETTINGS_SET_SEARCH_ENGINE, id) as Promise<void>,
  getHubMode: () => ipcRenderer.invoke(IPC.SETTINGS_GET_HUB_MODE) as Promise<HubMode>,
  setHubMode: (mode: HubMode) => ipcRenderer.invoke(IPC.SETTINGS_SET_HUB_MODE, mode) as Promise<void>,
  getModelLoadMode: () => ipcRenderer.invoke(IPC.SETTINGS_GET_MODEL_LOAD_MODE) as Promise<ModelLoadMode>,
  setModelLoadMode: (mode: ModelLoadMode) => ipcRenderer.invoke(IPC.SETTINGS_SET_MODEL_LOAD_MODE, mode) as Promise<void>,

  // AI-чат на Hub (см. electron/HubChatManager.ts) — send fire-and-forget, ответ стримом.
  // grounding — тоггл-глобус (см. Hub.tsx::AiChatView), свой от AI-панели.
  sendHubChatMessage: (tabId: string, text: string, grounding: boolean, sourcesContext?: string) =>
    ipcRenderer.send(IPC.HUB_CHAT_SEND, { tabId, text, grounding, sourcesContext }),
  onHubChatChunk: (cb: (payload: { tabId: string; text: string }) => void) => {
    const handler = (_e: unknown, payload: { tabId: string; text: string }) => cb(payload);
    ipcRenderer.on(IPC.HUB_CHAT_CHUNK, handler);
    return () => ipcRenderer.removeListener(IPC.HUB_CHAT_CHUNK, handler);
  },
  onHubChatResult: (cb: (payload: { tabId: string; sessionId: number; outcome: HubChatOutcome }) => void) => {
    const handler = (_e: unknown, payload: { tabId: string; sessionId: number; outcome: HubChatOutcome }) => cb(payload);
    ipcRenderer.on(IPC.HUB_CHAT_RESULT, handler);
    return () => ipcRenderer.removeListener(IPC.HUB_CHAT_RESULT, handler);
  },
  listHubChatSessions: () => ipcRenderer.invoke(IPC.HUB_CHAT_LIST_SESSIONS) as Promise<HubChatSessionMeta[]>,
  getHubChatSession: (sessionId: number) => ipcRenderer.invoke(IPC.HUB_CHAT_GET_SESSION, sessionId) as Promise<HubChatMessage[]>,
  newHubChatSession: (tabId: string) => ipcRenderer.invoke(IPC.HUB_CHAT_NEW_SESSION, tabId) as Promise<void>,
  resumeHubChatSession: (tabId: string, sessionId: number) =>
    ipcRenderer.invoke(IPC.HUB_CHAT_RESUME_SESSION, tabId, sessionId) as Promise<HubChatMessage[]>,
  deleteHubChatSession: (sessionId: number) => ipcRenderer.invoke(IPC.HUB_CHAT_DELETE_SESSION, sessionId) as Promise<void>,

  // Граф-воркспейс (electron/GraphStore.ts + GraphEngine.ts). saveGraph шлёт только структуру —
  // результаты узлов пишет движок, см. шапку GraphStore.ts.
  listGraphs: () => ipcRenderer.invoke(IPC.GRAPH_LIST) as Promise<GraphMeta[]>,
  createGraph: (title: string) => ipcRenderer.invoke(IPC.GRAPH_CREATE, title) as Promise<GraphMeta | null>,
  getGraph: (graphId: number) => ipcRenderer.invoke(IPC.GRAPH_GET, graphId) as Promise<GraphDoc | null>,
  saveGraph: (graphId: number, structure: GraphStructure) =>
    ipcRenderer.invoke(IPC.GRAPH_SAVE, graphId, structure) as Promise<void>,
  renameGraph: (graphId: number, title: string) =>
    ipcRenderer.invoke(IPC.GRAPH_RENAME, graphId, title) as Promise<void>,
  deleteGraph: (graphId: number) => ipcRenderer.invoke(IPC.GRAPH_DELETE, graphId) as Promise<void>,
  runGraph: (graphId: number, nodeId: string | null) => ipcRenderer.send(IPC.GRAPH_RUN, graphId, nodeId),
  listGraphChat: (graphId: number, nodeId: string) =>
    ipcRenderer.invoke(IPC.GRAPH_CHAT_LIST, graphId, nodeId) as Promise<GraphChatMessage[]>,
  sendGraphChat: (graphId: number, nodeId: string, text: string) =>
    ipcRenderer.send(IPC.GRAPH_CHAT_SEND, graphId, nodeId, text),
  clearGraphChat: (graphId: number, nodeId: string) =>
    ipcRenderer.invoke(IPC.GRAPH_CHAT_CLEAR, graphId, nodeId) as Promise<void>,
  onGraphChatChunk: (cb: (p: { graphId: number; nodeId: string; text: string }) => void) => {
    const handler = (_e: unknown, p: { graphId: number; nodeId: string; text: string }) => cb(p);
    ipcRenderer.on(IPC.GRAPH_CHAT_CHUNK, handler);
    return () => ipcRenderer.removeListener(IPC.GRAPH_CHAT_CHUNK, handler);
  },
  onGraphChatDone: (
    cb: (p: { graphId: number; nodeId: string; ok: boolean; text?: string; error?: string }) => void,
  ) => {
    const handler = (
      _e: unknown, p: { graphId: number; nodeId: string; ok: boolean; text?: string; error?: string },
    ) => cb(p);
    ipcRenderer.on(IPC.GRAPH_CHAT_DONE, handler);
    return () => ipcRenderer.removeListener(IPC.GRAPH_CHAT_DONE, handler);
  },
  pickGraphFile: () => ipcRenderer.invoke(IPC.GRAPH_PICK_FILE) as Promise<string | null>,
  pickGraphImage: () => ipcRenderer.invoke(IPC.GRAPH_PICK_IMAGE) as Promise<string | null>,
  captureWebAppImage: (graphId: number, nodeId: string) =>
    ipcRenderer.invoke(IPC.GRAPH_WEBAPP_CAPTURE_IMAGE, graphId, nodeId) as
      Promise<{ ok: boolean; path?: string; error?: string }>,
  graphImagePreview: (path: string) =>
    ipcRenderer.invoke(IPC.GRAPH_IMAGE_PREVIEW, path) as Promise<string | null>,
  listNodeHistory: (graphId: number, nodeId: string) =>
    ipcRenderer.invoke(IPC.GRAPH_NODE_HISTORY, graphId, nodeId) as Promise<GraphNodeVersion[]>,
  saveGraphOutput: (suggestedName: string, text: string) =>
    ipcRenderer.invoke(IPC.GRAPH_SAVE_OUTPUT, suggestedName, text) as Promise<boolean>,
  listImagePresets: () => ipcRenderer.invoke(IPC.GRAPH_PRESETS_LIST) as Promise<ImagePreset[]>,
  saveImagePreset: (preset: ImagePreset) => ipcRenderer.invoke(IPC.GRAPH_PRESET_SAVE, preset) as Promise<void>,
  deleteImagePreset: (id: string) => ipcRenderer.invoke(IPC.GRAPH_PRESET_DELETE, id) as Promise<void>,
  cancelGraphRun: (graphId: number) => ipcRenderer.invoke(IPC.GRAPH_CANCEL, graphId) as Promise<void>,
  onGraphChanged: (cb: (graphId: number) => void) => {
    const handler = (_e: unknown, graphId: number) => cb(graphId);
    ipcRenderer.on(IPC.GRAPH_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.GRAPH_CHANGED, handler);
  },
  onGraphProgress: (cb: (p: GraphProgress) => void) => {
    const handler = (_e: unknown, p: GraphProgress) => cb(p);
    ipcRenderer.on(IPC.GRAPH_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.GRAPH_PROGRESS, handler);
  },

  // Узел-веб-приложение графа: живой чужой сайт в панели 1:1, обмен через руку человека.
  showGraphWebApp: (graphId: number, nodeId: string, url: string, bounds: ContentBounds) =>
    ipcRenderer.invoke(IPC.GRAPH_WEBAPP_SHOW, graphId, nodeId, url, bounds) as Promise<void>,
  setGraphWebAppBounds: (graphId: number, nodeId: string, bounds: ContentBounds) =>
    ipcRenderer.invoke(IPC.GRAPH_WEBAPP_BOUNDS, graphId, nodeId, bounds) as Promise<void>,
  raiseGraphWebApp: (graphId: number, nodeId: string) =>
    ipcRenderer.invoke(IPC.GRAPH_WEBAPP_RAISE, graphId, nodeId) as Promise<void>,
  closeGraphWebApp: (graphId: number, nodeId: string) =>
    ipcRenderer.invoke(IPC.GRAPH_WEBAPP_CLOSE, graphId, nodeId) as Promise<void>,
  insertGraphWebAppPrompt: (graphId: number, nodeId: string) =>
    ipcRenderer.invoke(IPC.GRAPH_WEBAPP_INSERT, graphId, nodeId) as Promise<boolean>,
  captureGraphWebAppAnswer: (graphId: number, nodeId: string, mode: 'selection' | 'last') =>
    ipcRenderer.invoke(IPC.GRAPH_WEBAPP_CAPTURE, graphId, nodeId, mode) as Promise<string>,

  // Заход D — ключ Gemini (AI-фактчек). Сам ключ никогда не возвращается в renderer.
  getAiKeyStatus: () => ipcRenderer.invoke(IPC.AI_GET_KEY_STATUS) as Promise<boolean>,
  saveAiKey:      (key: string) => ipcRenderer.invoke(IPC.AI_SAVE_KEY, key) as Promise<boolean>,
  deleteAiKey:    () => ipcRenderer.invoke(IPC.AI_DELETE_KEY) as Promise<void>,
  onAiKeyStatusChanged: (cb: (connected: boolean) => void) => {
    const handler = (_e: unknown, connected: boolean) => cb(connected);
    ipcRenderer.on(IPC.AI_KEY_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.AI_KEY_STATUS_CHANGED, handler);
  },

  // Задел под web-grounding (SearXNG). Сам конфиг никогда не возвращается в renderer.
  getSearxngStatus:    () => ipcRenderer.invoke(IPC.SEARXNG_GET_STATUS) as Promise<boolean>,
  saveSearxngConfig:   (config: { endpoint: string; token: string }) =>
    ipcRenderer.invoke(IPC.SEARXNG_SAVE_CONFIG, config) as Promise<boolean>,
  deleteSearxngConfig: () => ipcRenderer.invoke(IPC.SEARXNG_DELETE_CONFIG) as Promise<void>,
  onSearxngStatusChanged: (cb: (configured: boolean) => void) => {
    const handler = (_e: unknown, configured: boolean) => cb(configured);
    ipcRenderer.on(IPC.SEARXNG_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.SEARXNG_STATUS_CHANGED, handler);
  },

  // Реестр AI-скиллов (см. Skill в shared/ipc.ts, electron/SkillsStore.ts) — CRUD для редактора
  // в Settings. id генерит main (SKILLS_ADD-хендлер), renderer его не передаёт.
  listSkills:  () => ipcRenderer.invoke(IPC.SKILLS_LIST) as Promise<Skill[]>,
  addSkill:    (input: { label: string; prompt: string; icon?: string }) =>
    ipcRenderer.invoke(IPC.SKILLS_ADD, input) as Promise<boolean>,
  updateSkill: (id: string, patch: { label?: string; prompt?: string; icon?: string; visible?: boolean }) =>
    ipcRenderer.invoke(IPC.SKILLS_UPDATE, id, patch) as Promise<boolean>,
  removeSkill: (id: string) => ipcRenderer.invoke(IPC.SKILLS_REMOVE, id) as Promise<boolean>,
  onSkillsChanged: (cb: (skills: Skill[]) => void) => {
    const handler = (_e: unknown, skills: Skill[]) => cb(skills);
    ipcRenderer.on(IPC.SKILLS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.SKILLS_CHANGED, handler);
  },

  // VPN, шаг 1 (см. electron/VpnSubscription.ts). Ссылка подписки и credential серверов
  // никогда не возвращаются в renderer — см. VpnStatus/VpnServerMeta в shared/ipc.ts.
  getVpnStatus:           () => ipcRenderer.invoke(IPC.VPN_GET_STATUS) as Promise<VpnStatus>,
  setVpnSubscription:     (url: string) => ipcRenderer.invoke(IPC.VPN_SET_SUBSCRIPTION, url) as Promise<VpnSubscriptionResult>,
  refreshVpnSubscription: () => ipcRenderer.invoke(IPC.VPN_REFRESH_SUBSCRIPTION) as Promise<VpnSubscriptionResult>,
  deleteVpnSubscription:  () => ipcRenderer.invoke(IPC.VPN_DELETE_SUBSCRIPTION) as Promise<void>,
  listVpnServers:         () => ipcRenderer.invoke(IPC.VPN_LIST_SERVERS) as Promise<VpnServerMeta[]>,
  onVpnStatusChanged: (cb: (status: VpnStatus) => void) => {
    const handler = (_e: unknown, status: VpnStatus) => cb(status);
    ipcRenderer.on(IPC.VPN_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.VPN_STATUS_CHANGED, handler);
  },
  // VPN, шаг 2 — только процесс + локальный SOCKS-порт (см. electron/VpnProcess.ts).
  // session.setProxy ещё не подключён — connect не переключает трафик вкладок.
  vpnConnect:    (serverId: string) => ipcRenderer.invoke(IPC.VPN_CONNECT, serverId) as Promise<{ ok: boolean; error?: string }>,
  vpnDisconnect: () => ipcRenderer.invoke(IPC.VPN_DISCONNECT) as Promise<void>,
  getVpnConnectionState: () => ipcRenderer.invoke(IPC.VPN_GET_CONNECTION_STATE) as Promise<VpnConnectionState>,
  onVpnConnectionStateChanged: (cb: (state: VpnConnectionState) => void) => {
    const handler = (_e: unknown, state: VpnConnectionState) => cb(state);
    ipcRenderer.on(IPC.VPN_CONNECTION_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.VPN_CONNECTION_STATE_CHANGED, handler);
  },

  // Менеджер паролей, шаг 1 (см. electron/PasswordManager.ts).
  listPasswords:     ()                                        => ipcRenderer.invoke(IPC.PASSWORDS_LIST) as Promise<PasswordMeta[]>,
  revealPassword:    (id: number)                               => ipcRenderer.invoke(IPC.PASSWORDS_REVEAL, id) as Promise<string | null>,
  copyPasswordField: (id: number, field: PasswordCopyField)     => ipcRenderer.invoke(IPC.PASSWORDS_COPY, id, field) as Promise<boolean>,
  getFavicon:        (host: string)                             => ipcRenderer.invoke(IPC.FAVICON_GET, host) as Promise<string | null>,
  getPasswordAuthEnabled: ()                                     => ipcRenderer.invoke(IPC.PASSWORDS_AUTH_GET) as Promise<boolean>,
  setPasswordAuthEnabled: (enabled: boolean)                     => ipcRenderer.invoke(IPC.PASSWORDS_AUTH_SET, enabled) as Promise<boolean>,

  // Автозаполнение — адреса и карты. Полный номер карты — только revealCardNumber (под Hello).
  listAddresses:    ()                        => ipcRenderer.invoke(IPC.AUTOFILL_ADDRESS_LIST) as Promise<AddressProfile[]>,
  addAddress:       (input: AddressInput)     => ipcRenderer.invoke(IPC.AUTOFILL_ADDRESS_ADD, input) as Promise<boolean>,
  updateAddress:    (input: AddressUpdate)    => ipcRenderer.invoke(IPC.AUTOFILL_ADDRESS_UPDATE, input) as Promise<boolean>,
  deleteAddress:    (id: number)              => ipcRenderer.invoke(IPC.AUTOFILL_ADDRESS_DELETE, id) as Promise<boolean>,
  listCards:        ()                        => ipcRenderer.invoke(IPC.AUTOFILL_CARD_LIST) as Promise<CardMeta[]>,
  addCard:          (input: CardInput)        => ipcRenderer.invoke(IPC.AUTOFILL_CARD_ADD, input) as Promise<boolean>,
  updateCard:       (input: CardUpdate)       => ipcRenderer.invoke(IPC.AUTOFILL_CARD_UPDATE, input) as Promise<boolean>,
  deleteCard:       (id: number)              => ipcRenderer.invoke(IPC.AUTOFILL_CARD_DELETE, id) as Promise<boolean>,
  revealCardNumber: (id: number)              => ipcRenderer.invoke(IPC.AUTOFILL_CARD_REVEAL, id) as Promise<string | null>,
  onAutofillChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.AUTOFILL_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.AUTOFILL_CHANGED, handler);
  },
  addPassword:       (input: PasswordAddInput)                  => ipcRenderer.invoke(IPC.PASSWORDS_ADD, input) as Promise<boolean>,
  updatePassword:    (input: PasswordUpdateInput)                => ipcRenderer.invoke(IPC.PASSWORDS_UPDATE, input) as Promise<boolean>,
  deletePassword:    (id: number)                               => ipcRenderer.invoke(IPC.PASSWORDS_DELETE, id) as Promise<void>,
  generatePassword:  (opts: PasswordGenerateOptions)            => ipcRenderer.invoke(IPC.PASSWORDS_GENERATE, opts) as Promise<string>,
  exportPasswords:   (passphrase: string)                       => ipcRenderer.invoke(IPC.PASSWORDS_EXPORT, passphrase) as Promise<boolean>,
  importPasswords:   (passphrase: string)                       => ipcRenderer.invoke(IPC.PASSWORDS_IMPORT, passphrase) as Promise<number>,
  onPasswordsChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.PASSWORDS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.PASSWORDS_CHANGED, handler);
  },

  // Менеджер паролей, шаг 2 — индикатор-«ключ» + поповер.
  onPasswordIndicatorChanged: (cb: (state: PasswordIndicatorState | null) => void) => {
    const handler = (_e: unknown, state: PasswordIndicatorState | null) => cb(state);
    ipcRenderer.on(IPC.PASSWORDS_INDICATOR_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.PASSWORDS_INDICATOR_CHANGED, handler);
  },
  savePendingPassword:    () => ipcRenderer.invoke(IPC.PASSWORDS_INDICATOR_SAVE) as Promise<boolean>,
  updatePendingPassword:  () => ipcRenderer.invoke(IPC.PASSWORDS_INDICATOR_UPDATE) as Promise<boolean>,
  fillSavedPassword:      (id: number) => ipcRenderer.invoke(IPC.PASSWORDS_INDICATOR_FILL, id) as Promise<boolean>,
  dismissPendingPassword: () => ipcRenderer.invoke(IPC.PASSWORDS_INDICATOR_DISMISS) as Promise<void>,
  generatePendingPassword: () => ipcRenderer.invoke(IPC.PASSWORDS_INDICATOR_GENERATE) as Promise<boolean>,
  setPasswordPopoverAnchorBounds: (b: ContentBounds) => ipcRenderer.invoke(IPC.PASSWORD_POPOVER_SET_BOUNDS, b) as Promise<void>,
  showPasswordPopover:       (state: PasswordIndicatorState) => ipcRenderer.invoke(IPC.PASSWORD_POPOVER_SHOW, state) as Promise<void>,
  closePasswordPopover:      () => ipcRenderer.invoke(IPC.PASSWORD_POPOVER_CLOSE) as Promise<void>,
  onPasswordPopoverClosed: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.PASSWORD_POPOVER_CLOSED, handler);
    return () => ipcRenderer.removeListener(IPC.PASSWORD_POPOVER_CLOSED, handler);
  },

  // Поповер VPN-пилюли (см. shared/ipc.ts::IPC.VPN_POPOVER_*).
  setVpnPopoverAnchorBounds: (b: ContentBounds) => ipcRenderer.invoke(IPC.VPN_POPOVER_SET_BOUNDS, b) as Promise<void>,
  showVpnPopover:            () => ipcRenderer.invoke(IPC.VPN_POPOVER_SHOW) as Promise<void>,
  closeVpnPopover:           () => ipcRenderer.invoke(IPC.VPN_POPOVER_CLOSE) as Promise<void>,
  onVpnPopoverClosed: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.VPN_POPOVER_CLOSED, handler);
    return () => ipcRenderer.removeListener(IPC.VPN_POPOVER_CLOSED, handler);
  },
  setVpnPopoverActiveUrl: (url: string) => ipcRenderer.invoke(IPC.VPN_POPOVER_SET_ACTIVE_URL, url) as Promise<void>,

  // Детект железа (см. electron/HardwareInfo.ts) — задел, потребителей пока нет.
  getHardwareSnapshot: () => ipcRenderer.invoke(IPC.HARDWARE_GET_SNAPSHOT) as Promise<HardwareSnapshot>,
  refreshHardwareSnapshot: () => ipcRenderer.invoke(IPC.HARDWARE_REFRESH_SNAPSHOT) as Promise<HardwareSnapshot>,

  // Загрузчик GGUF-моделей (см. electron/ModelDownloader.ts) — задел, потребителей пока нет.
  startModelDownload: (spec: ModelDownloadSpec) => ipcRenderer.send(IPC.MODEL_DOWNLOAD_START, spec),
  cancelModelDownload: () => ipcRenderer.send(IPC.MODEL_DOWNLOAD_CANCEL),
  getModelDownloadProgress: () => ipcRenderer.invoke(IPC.MODEL_DOWNLOAD_STATUS) as Promise<DownloadProgress>,
  onModelDownloadProgress: (cb: (p: DownloadProgress) => void) => {
    const handler = (_e: unknown, p: DownloadProgress) => cb(p);
    ipcRenderer.on(IPC.MODEL_DOWNLOAD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.MODEL_DOWNLOAD_PROGRESS, handler);
  },

  // Возврат OS-фокуса чрому (см. IPC.CHROME_FOCUS).
  focusChrome: () => ipcRenderer.send(IPC.CHROME_FOCUS),

  // Бэнги омнибокса (см. electron/BangStore.ts).
  listBangs: () => ipcRenderer.invoke(IPC.BANGS_LIST) as Promise<BangsSnapshot>,
  upsertBang: (bang: BangDefWire) => ipcRenderer.invoke(IPC.BANGS_UPSERT, bang) as Promise<string | null>,
  removeBang: (key: string) => ipcRenderer.invoke(IPC.BANGS_REMOVE, key) as Promise<void>,
  deriveBangsFromTabs: () => ipcRenderer.invoke(IPC.BANGS_DERIVE_TABS) as Promise<DerivedBangCandidate[]>,
  importDuckDuckGoBangs: () => ipcRenderer.invoke(IPC.BANGS_IMPORT_DDG) as Promise<ImportBangsResult>,
  clearImportedBangs: () => ipcRenderer.invoke(IPC.BANGS_CLEAR_IMPORTED) as Promise<void>,

  getSearchChips: () => ipcRenderer.invoke(IPC.SEARCH_CHIPS_GET) as Promise<SearchChipsConfig>,
  setSearchChips: (cfg: SearchChipsConfig) => ipcRenderer.invoke(IPC.SEARCH_CHIPS_SET, cfg) as Promise<void>,
  searchSearchChipCandidates: (query: string) => ipcRenderer.invoke(IPC.SEARCH_CHIPS_SEARCH, query) as Promise<SearchChipCandidate[]>,
  resolveSearchChipCandidates: (ids: string[]) => ipcRenderer.invoke(IPC.SEARCH_CHIPS_RESOLVE, ids) as Promise<SearchChipCandidate[]>,

  // Автообновление (см. electron/UpdateManager.ts).
  checkForUpdate: () => ipcRenderer.send(IPC.UPDATE_CHECK),
  downloadUpdate: () => ipcRenderer.send(IPC.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.send(IPC.UPDATE_INSTALL),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.UPDATE_STATUS) as Promise<UpdateStatus>,
  onUpdateStatusChanged: (cb: (s: UpdateStatus) => void) => {
    const handler = (_e: unknown, s: UpdateStatus) => cb(s);
    ipcRenderer.on(IPC.UPDATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.UPDATE_CHANGED, handler);
  },

  // Курируемый каталог моделей (см. electron/ModelCatalog.ts) — задел, потребителей пока нет.
  getModelCatalog: () => ipcRenderer.invoke(IPC.MODEL_CATALOG_GET) as Promise<CatalogEntry[]>,

  // Явная выгрузка модели из VRAM (см. electron/TranslationService.ts::unloadModel) — задел,
  // потребителей пока нет.
  unloadModel: () => ipcRenderer.invoke(IPC.MODEL_UNLOAD) as Promise<void>,

  // Удаление модели с диска (см. electron/ModelRegistry.ts::deleteModel) — задел, потребителей
  // пока нет. Необратимо.
  deleteModel: (id: string) => ipcRenderer.invoke(IPC.MODEL_DELETE, id) as Promise<DeleteModelResult>,

  // Список установленных моделей (см. electron/ModelRegistry.ts::list) — задел, потребителей пока нет.
  getInstalledModels: () => ipcRenderer.invoke(IPC.MODEL_INSTALLED_LIST) as Promise<InstalledModel[]>,

  // Дефолтная модель (см. electron/ModelRegistry.ts::getDefault/setDefault) — задел, потребителей
  // пока нет. Смена дефолта не выгружает уже загруженную модель — см. SetDefaultModelResult в shared/ipc.ts.
  getDefaultModelId: () => ipcRenderer.invoke(IPC.MODEL_DEFAULT_GET) as Promise<string | null>,
  setDefaultModel: (id: string) => ipcRenderer.invoke(IPC.MODEL_DEFAULT_SET, id) as Promise<SetDefaultModelResult>,

  // Модель, сейчас загруженная в VRAM (см. electron/TranslationService.ts::getLoadedModelId) —
  // задел, потребителей пока нет.
  getLoadedModelId: () => ipcRenderer.invoke(IPC.MODEL_LOADED_GET) as Promise<string | null>,
};

contextBridge.exposeInMainWorld('oblako', api);
