import { ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { OblakoApi, HistoryEntry, SmartSearchResponse, HistorySearchProgress } from '../shared/ipc';

export function createHistoryApi(): Pick<OblakoApi, 'getHistory' | 'getHistoryPage' | 'searchHistory' | 'deleteHistoryEntry' | 'clearHistory' | 'onHistoryOpen' | 'searchHistorySmart' | 'cancelHistorySearch' | 'onHistorySearchProgress'> {
  return {
    getHistory: limit => ipcRenderer.invoke(IPC.HISTORY_GET, limit) as Promise<HistoryEntry[]>,
    getHistoryPage: request => ipcRenderer.invoke(IPC.HISTORY_PAGE, request),
    searchHistory: query => ipcRenderer.invoke(IPC.HISTORY_SEARCH, query) as Promise<HistoryEntry[]>,
    deleteHistoryEntry: id => ipcRenderer.invoke(IPC.HISTORY_DELETE, id),
    clearHistory: period => ipcRenderer.invoke(IPC.HISTORY_CLEAR, period),
    onHistoryOpen: cb => {
      const handler = () => cb();
      ipcRenderer.on(IPC.HISTORY_OPEN, handler);
      return () => ipcRenderer.removeListener(IPC.HISTORY_OPEN, handler);
    },
    searchHistorySmart: (query, requestId, filters) => ipcRenderer.invoke(IPC.HISTORY_SEARCH_SMART, query, requestId, filters) as Promise<SmartSearchResponse>,
    cancelHistorySearch: requestId => ipcRenderer.send(IPC.HISTORY_SEARCH_CANCEL, requestId),
    onHistorySearchProgress: cb => {
      const handler = (_e: Electron.IpcRendererEvent, progress: HistorySearchProgress) => cb(progress);
      ipcRenderer.on(IPC.HISTORY_SEARCH_PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC.HISTORY_SEARCH_PROGRESS, handler);
    },
  };
}
