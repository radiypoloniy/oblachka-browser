import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { DownloadEntry } from '../shared/ipc';

// Мост поповера загрузок. Действия — те же ipcMain.handle, что у боевого window.oblako
// (обработчик не привязан к конкретному preload'у), поэтому дублировать логику в main не нужно.
contextBridge.exposeInMainWorld('downloadsPopover', {
  getDownloads:       () => ipcRenderer.invoke(IPC.DOWNLOADS_GET_ALL) as Promise<DownloadEntry[]>,
  pauseDownload:      (id: string) => ipcRenderer.invoke(IPC.DOWNLOAD_PAUSE, id) as Promise<void>,
  resumeDownload:     (id: string) => ipcRenderer.invoke(IPC.DOWNLOAD_RESUME, id) as Promise<void>,
  cancelDownload:     (id: string) => ipcRenderer.invoke(IPC.DOWNLOAD_CANCEL, id) as Promise<void>,
  openDownloadFile:   (id: string) => ipcRenderer.invoke(IPC.DOWNLOAD_OPEN_FILE, id) as Promise<void>,
  showDownloadFolder: (id: string) => ipcRenderer.invoke(IPC.DOWNLOAD_SHOW_FOLDER, id) as Promise<void>,
  retryDownload:      (id: string) => ipcRenderer.invoke(IPC.DOWNLOAD_RETRY, id) as Promise<void>,
  // Живой прогресс, пока поповер открыт (см. DownloadsPopoverManager.ts::broadcastDownloads).
  onDownloadsChanged: (cb: (entries: DownloadEntry[]) => void) => {
    const handler = (_e: unknown, entries: DownloadEntry[]) => cb(entries);
    ipcRenderer.on(IPC.DOWNLOADS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.DOWNLOADS_CHANGED, handler);
  },
  openAll:      () => ipcRenderer.send(IPC.DOWNLOADS_POPOVER_OPEN_ALL),
  close:        () => ipcRenderer.send('downloads-popover:close'),
  reportHeight: (px: number) => ipcRenderer.send('downloads-popover:height', px),
  onShow: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('downloads-popover:show', handler);
    return () => ipcRenderer.removeListener('downloads-popover:show', handler);
  },
});
