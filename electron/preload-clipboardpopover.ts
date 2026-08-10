import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { ClipboardEntry } from '../shared/ipc';

// Мост поповера буфера. Как и у остальных оверлеев — свой preload, боевой window.oblako сюда не
// пробрасывается: вью изолированная и ей нужно ровно пять вызовов.
contextBridge.exposeInMainWorld('clipboardPopover', {
  list:    () => ipcRenderer.invoke(IPC.CLIPBOARD_LIST) as Promise<ClipboardEntry[]>,
  // Положить запись в системный буфер обмена — это и есть «взять из истории».
  put:     (id: number) => ipcRenderer.invoke(IPC.CLIPBOARD_PUT, id) as Promise<void>,
  remove:  (id: number) => ipcRenderer.invoke(IPC.CLIPBOARD_REMOVE, id) as Promise<void>,
  clear:   () => ipcRenderer.invoke(IPC.CLIPBOARD_CLEAR) as Promise<void>,
  getEnabled: () => ipcRenderer.invoke(IPC.CLIPBOARD_ENABLED_GET) as Promise<boolean>,
  setEnabled: (on: boolean) => ipcRenderer.invoke(IPC.CLIPBOARD_ENABLED_SET, on) as Promise<void>,
  close:   () => ipcRenderer.send('clipboard-popover:close'),
  reportHeight: (px: number) => ipcRenderer.send('clipboard-popover:height', px),
  onShow: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('clipboard-popover:show', handler);
    return () => ipcRenderer.removeListener('clipboard-popover:show', handler);
  },
});
