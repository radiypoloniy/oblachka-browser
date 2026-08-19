import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { PasswordIndicatorState } from '../shared/ipc';
import { installOverlayBackdrop } from './overlayBackdropPreload';

// Размытая подложка под карточкой — снимок страницы под ней (см. electron/overlayBackdrop.ts).
installOverlayBackdrop();

contextBridge.exposeInMainWorld('passwordPopover', {
  savePendingPassword:    () => ipcRenderer.invoke(IPC.PASSWORDS_INDICATOR_SAVE) as Promise<boolean>,
  updatePendingPassword:  () => ipcRenderer.invoke(IPC.PASSWORDS_INDICATOR_UPDATE) as Promise<boolean>,
  fillSavedPassword:      (id: number) => ipcRenderer.invoke(IPC.PASSWORDS_INDICATOR_FILL, id) as Promise<boolean>,
  dismissPendingPassword: () => ipcRenderer.invoke(IPC.PASSWORDS_INDICATOR_DISMISS) as Promise<void>,
  generatePendingPassword: () => ipcRenderer.invoke(IPC.PASSWORDS_INDICATOR_GENERATE) as Promise<boolean>,
  close:                  () => ipcRenderer.send(IPC.PASSWORD_POPOVER_CLOSE),
  reportHeight:           (px: number) => ipcRenderer.send('password-popover:height', px),
  onShow: (cb: (state: PasswordIndicatorState) => void) => {
    const handler = (_e: unknown, state: PasswordIndicatorState) => cb(state);
    ipcRenderer.on(IPC.PASSWORD_POPOVER_SHOW, handler);
    return () => ipcRenderer.removeListener(IPC.PASSWORD_POPOVER_SHOW, handler);
  },
});
