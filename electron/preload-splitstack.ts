import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { SplitStackMenuData } from '../shared/ipc';
import { exposeUiLanguage } from './preload/uiLanguage';

contextBridge.exposeInMainWorld('splitStack', {
  get: () => ipcRenderer.invoke(IPC.SPLIT_STACK_DATA) as Promise<SplitStackMenuData | null>,
  select: (id: string) => ipcRenderer.invoke(IPC.SPLIT_STACK_SELECT, id) as Promise<void>,
  forget: (id: string) => ipcRenderer.invoke(IPC.SPLIT_STACK_FORGET, id) as Promise<void>,
  close: () => ipcRenderer.send(IPC.SPLIT_STACK_CLOSE),
  onData: (cb: (data: SplitStackMenuData) => void) => {
    const handler = (_e: unknown, data: SplitStackMenuData) => cb(data);
    ipcRenderer.on(IPC.SPLIT_STACK_DATA, handler);
    return () => ipcRenderer.removeListener(IPC.SPLIT_STACK_DATA, handler);
  },
});
exposeUiLanguage();
