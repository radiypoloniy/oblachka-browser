import { ipcRenderer } from 'electron';
import { IPC } from '../../shared/ipc';
import type { CompareApi, CompareState } from '../../shared/tabCompare';

export const compareBridge: CompareApi = {
  tabCompareState: () => ipcRenderer.invoke(IPC.COMPARE_STATE),
  onTabCompareState: cb => {
    const handler = (_e: unknown, state: CompareState) => cb(state);
    ipcRenderer.on(IPC.COMPARE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.COMPARE_CHANGED, handler);
  },
  setTabCompareEnabled: enabled => ipcRenderer.invoke(IPC.COMPARE_ENABLED, enabled),
  showTabCompareOffer: anchor => ipcRenderer.invoke(IPC.COMPARE_OFFER_SHOW, anchor),
  closeTabCompareOffer: () => ipcRenderer.invoke(IPC.COMPARE_OFFER_CLOSE),
  startTabCompare: (ids, connectionId) => ipcRenderer.invoke(IPC.COMPARE_START, ids, connectionId),
  refreshTabCompare: () => ipcRenderer.invoke(IPC.COMPARE_REFRESH),
  tabCompareSource: (id, factId) => ipcRenderer.invoke(IPC.COMPARE_SOURCE, id, factId),
  tabCompareArchive: (query, offset) => ipcRenderer.invoke(IPC.COMPARE_ARCHIVE, query, offset),
  onTabCompareArchiveChanged: cb => {
    const handler = () => cb();
    ipcRenderer.on(IPC.COMPARE_ARCHIVE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.COMPARE_ARCHIVE_CHANGED, handler);
  },
  openTabCompareArchive: id => ipcRenderer.invoke(IPC.COMPARE_ARCHIVE_OPEN, id),
  removeTabCompareArchive: id => ipcRenderer.invoke(IPC.COMPARE_ARCHIVE_REMOVE, id),
};
