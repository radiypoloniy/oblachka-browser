import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { OblakoApi, TabState, ContentBounds, TitleBarOpts, FindResult } from '../shared/ipc';

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
};

contextBridge.exposeInMainWorld('oblako', api);
