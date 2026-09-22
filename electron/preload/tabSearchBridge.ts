// FTS текста вкладок и Ctrl+F с находки омнибокса — вынесено, чтобы preload.ts не рос.
import { ipcRenderer } from 'electron';
import { IPC } from '../../shared/ipc';
import type { SmartTabHit } from '../../shared/ipc';

export const tabSearchBridge = {
  searchTabsContent: (query: string) => ipcRenderer.invoke(IPC.TABS_SEARCH_CONTENT, query) as Promise<SmartTabHit[]>,
  revealFind: (query: string, windowId?: number) => ipcRenderer.invoke(IPC.FIND_REVEAL, query, windowId) as Promise<void>,
};
