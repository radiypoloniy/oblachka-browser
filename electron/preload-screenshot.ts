import { contextBridge, ipcRenderer } from 'electron';

// Мост карточки снимка (см. ScreenshotManager.ts). Каналы здесь свои, не из shared/ipc.ts:
// разговор идёт только между main и этой вью, боевого window.oblako он не касается — тот же
// приём, что у 'findbar:close' и 'downloads-popover:height'.
contextBridge.exposeInMainWorld('screenshotOverlay', {
  // main → вью: сырой PNG снятой страницы (data-URL). Оформление рисует сама вью.
  onShot: (cb: (dataUrl: string) => void) => {
    const handler = (_e: unknown, dataUrl: string) => cb(dataUrl);
    ipcRenderer.on('screenshot:shot', handler);
    return () => ipcRenderer.removeListener('screenshot:shot', handler);
  },
  // main → вью: человек нажал Ctrl+S на странице (хоткей ловит TabManager, а не эта вью).
  onSaveRequest: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('screenshot:save-now', handler);
    return () => ipcRenderer.removeListener('screenshot:save-now', handler);
  },
  save: (dataUrl: string) => ipcRenderer.invoke('screenshot:save', dataUrl) as Promise<string | null>,
  copy: (dataUrl: string) => ipcRenderer.send('screenshot:copy', dataUrl),
  reveal: (file: string) => ipcRenderer.send('screenshot:reveal', file),
  close: () => ipcRenderer.send('screenshot:close'),
  reportHeight: (px: number) => ipcRenderer.send('screenshot:height', px),
});
