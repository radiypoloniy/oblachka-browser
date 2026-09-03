// Мост renderer ↔ main для автообновления (см. electron/UpdateManager.ts).
//
// ⚠️ Вынесено из preload.ts по тому же правилу, что и preload/aiBridge.ts: дверь между
// интерфейсом и main за порогом храповика, и новая работа в ней оплачивается выносом связной
// части, а не поднятием базы. Автообновление — как раз такая часть: пять методов и один пуш.
//
// ⚠️ Команды идут через send, статус — через invoke, изменения — пушем. Разделение не
// косметическое: ни загрузка, ни установка НИКОГДА не начинаются сами, оба требуют нажатия.
import { ipcRenderer } from 'electron';
import { IPC } from '../../shared/ipc';
import type { UpdateStatus } from '../../shared/ipc';

export const updatesBridge = {
  checkForUpdate: () => ipcRenderer.send(IPC.UPDATE_CHECK),
  downloadUpdate: () => ipcRenderer.send(IPC.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.send(IPC.UPDATE_INSTALL),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.UPDATE_STATUS) as Promise<UpdateStatus>,
  onUpdateStatusChanged: (cb: (s: UpdateStatus) => void) => {
    const handler = (_e: unknown, s: UpdateStatus) => cb(s);
    ipcRenderer.on(IPC.UPDATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.UPDATE_CHANGED, handler);
  },
};
