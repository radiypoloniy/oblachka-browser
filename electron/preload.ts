import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { OblakoApi, SyncState, TabState, ContentBounds, TitleBarOpts, FindResult, AdBlockState, HistoryEntry, HistoryClearPeriod, DownloadEntry, PermissionRequest, SidebarNode, OrganizeCluster, SuggestDropdownItem, EmbedRequestPayload, EmbedResponsePayload, BackfillProgress, HistoryContentCoverage, SemanticSearchResult, VpnStatus, VpnServerMeta, VpnSubscriptionResult, VpnConnectionState, PasswordMeta, PasswordAddInput, PasswordUpdateInput, PasswordCopyField, PasswordGenerateOptions, PasswordIndicatorState, HubMode, HubChatMessage, HubChatSessionMeta, HubChatOutcome, PageTranslateState, PageTranslateProgress } from '../shared/ipc';
import type { SearchEngineId } from '../shared/searchEngines';

// В preload (sandbox: false) process.env доступен — читаем флаг напрямую, без IPC.
const EMBED_PRELOAD = process.env.OBLAKO_PRELOAD_EMBED !== '0';

const api: OblakoApi = {
  getAllTabs: () => ipcRenderer.invoke(IPC.TABS_GET_ALL),
  createTab: (url?: string) => ipcRenderer.invoke(IPC.TAB_CREATE, url),
  createSpecialTab: (kind: 'history' | 'settings') => ipcRenderer.invoke(IPC.TAB_CREATE_SPECIAL, kind),
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

  enterSplit:      (rightId: string)            => ipcRenderer.invoke(IPC.TAB_ENTER_SPLIT, rightId),
  exitSplit:       ()                           => ipcRenderer.invoke(IPC.TAB_EXIT_SPLIT),
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
  searchHistorySemantic: (query: string) =>
    ipcRenderer.invoke(IPC.HISTORY_SEARCH_SEMANTIC, query) as Promise<SemanticSearchResult[]>,
  searchHistorySmart: (query: string) =>
    ipcRenderer.invoke(IPC.HISTORY_SEARCH_SMART, query) as Promise<SemanticSearchResult[]>,

  // Заход G — общий канал эмбеддингов (см. shared/ipc.ts::EmbedRequestPayload).
  onEmbedRequest: (cb: (req: EmbedRequestPayload) => void) => {
    const handler = (_e: unknown, req: EmbedRequestPayload) => cb(req);
    ipcRenderer.on(IPC.EMBED_REQUEST, handler);
    return () => ipcRenderer.removeListener(IPC.EMBED_REQUEST, handler);
  },
  sendEmbedResponse: (res: EmbedResponsePayload) => ipcRenderer.send(IPC.EMBED_RESPONSE, res),

  // Заход G, блок 5 — разовый бэкфилл истории.
  startHistoryBackfill:  () => ipcRenderer.send(IPC.HISTORY_BACKFILL_START),
  cancelHistoryBackfill: () => ipcRenderer.send(IPC.HISTORY_BACKFILL_CANCEL),
  getHistoryBackfillStatus: () => ipcRenderer.invoke(IPC.HISTORY_BACKFILL_STATUS) as Promise<BackfillProgress>,
  onHistoryBackfillProgress: (cb: (p: BackfillProgress) => void) => {
    const handler = (_e: unknown, p: BackfillProgress) => cb(p);
    ipcRenderer.on(IPC.HISTORY_BACKFILL_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.HISTORY_BACKFILL_PROGRESS, handler);
  },
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

  // Правая AI-панель
  toggleAiPanel: () => ipcRenderer.invoke(IPC.AI_PANEL_TOGGLE) as Promise<boolean>,

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

  // AI-чат на Hub (см. electron/HubChatManager.ts) — send fire-and-forget, ответ стримом.
  sendHubChatMessage: (tabId: string, text: string) => ipcRenderer.send(IPC.HUB_CHAT_SEND, { tabId, text }),
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

  // Заход D — ключ Gemini (AI-фактчек). Сам ключ никогда не возвращается в renderer.
  getAiKeyStatus: () => ipcRenderer.invoke(IPC.AI_GET_KEY_STATUS) as Promise<boolean>,
  saveAiKey:      (key: string) => ipcRenderer.invoke(IPC.AI_SAVE_KEY, key) as Promise<boolean>,
  deleteAiKey:    () => ipcRenderer.invoke(IPC.AI_DELETE_KEY) as Promise<void>,
  onAiKeyStatusChanged: (cb: (connected: boolean) => void) => {
    const handler = (_e: unknown, connected: boolean) => cb(connected);
    ipcRenderer.on(IPC.AI_KEY_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.AI_KEY_STATUS_CHANGED, handler);
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

  embedPreload: EMBED_PRELOAD,
};

contextBridge.exposeInMainWorld('oblako', api);

// ВРЕМЕННЫЙ debug-мост для диагностики залипания дропдауна — console.log рендерера не долетает
// до main stdout (кириллица там же кракозябры), а факты нужны именно оттуда. Отдельный от api,
// чтобы не трогать контракт OblakoApi/shared/ipc.ts ради одноразовой диагностики. Удалить вместе
// с временными вызовами в Toolbar.tsx после диагностики.
contextBridge.exposeInMainWorld('ddlog', {
  log: (msg: string) => ipcRenderer.send('dd-log', msg),
});
