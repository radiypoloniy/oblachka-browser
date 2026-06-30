import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { OblakoApi, SyncState, TabState, ContentBounds, TitleBarOpts, FindResult, AdBlockState, HistoryEntry, HistoryClearPeriod, DownloadEntry, PermissionRequest, SidebarNode, OrganizeCluster } from '../shared/ipc';

const api: OblakoApi = {
  getAllTabs: () => ipcRenderer.invoke(IPC.TABS_GET_ALL),
  createTab: (url?: string) => ipcRenderer.invoke(IPC.TAB_CREATE, url),
  closeTab: (id: string) => ipcRenderer.invoke(IPC.TAB_CLOSE, id),
  activateTab: (id: string) => ipcRenderer.invoke(IPC.TAB_ACTIVATE, id),
  navigate: (id: string, input: string) => ipcRenderer.invoke(IPC.TAB_NAVIGATE, id, input),
  goBack: (id: string) => ipcRenderer.invoke(IPC.TAB_GO_BACK, id),
  goForward: (id: string) => ipcRenderer.invoke(IPC.TAB_GO_FORWARD, id),
  reload: (id: string) => ipcRenderer.invoke(IPC.TAB_RELOAD, id),
  setContentBounds: (b: ContentBounds) => ipcRenderer.invoke(IPC.CONTENT_SET_BOUNDS, b),
  setTitleBarOverlay: (opts: TitleBarOpts) => ipcRenderer.invoke(IPC.WINDOW_SET_OVERLAY, opts),
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

  // ВРЕМЕННО: калибровка порога (удалить после фиксации DEFAULT_SIMILARITY_THRESHOLD)
  getOrganizeThreshold: () => ipcRenderer.invoke(IPC.ORGANIZE_THRESHOLD) as Promise<number | null>,

  // ВРЕМЕННО: флаги --bench / --verify-gpu (удалить после замера + верификации WebGPU)
  getEmbeddingFlags: () => ipcRenderer.invoke(IPC.EMBEDDING_FLAGS) as Promise<{ bench: boolean; verifyGpu: boolean }>,
};

contextBridge.exposeInMainWorld('oblako', api);
