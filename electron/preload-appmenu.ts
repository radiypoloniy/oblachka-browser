import { contextBridge, ipcRenderer } from 'electron';
import type { AppMenuItem } from '../shared/ipc';

// Мост меню приложения. ⚠️ Наружу уходят только ПОДПИСИ и идентификаторы: сами действия живут в
// main (см. AppMenuManager.showAppMenu), а сюда приезжает то, что нужно нарисовать.
contextBridge.exposeInMainWorld('appMenu', {
  onShow: (cb: (items: AppMenuItem[]) => void) => {
    const handler = (_e: unknown, items: AppMenuItem[]) => cb(items);
    ipcRenderer.on('app-menu:show', handler);
    return () => ipcRenderer.removeListener('app-menu:show', handler);
  },
  pick: (id: string) => ipcRenderer.send('app-menu:pick', id),
  close: () => ipcRenderer.send('app-menu:close'),
  reportSize: (size: { width: number; height: number }) => ipcRenderer.send('app-menu:size', size),
});
