// Минимальный preload для поповера разрешений (src/permissionpopover.tsx). Ответ пользователя
// идёт по боевому каналу PERMISSION_RESPONSE — сама труба разрешений не менялась, переехала
// только вью, в которой рисуется вопрос. Показ и замер высоты — свой маленький канал
// (permission-popover:*), не часть контракта основного хрома, как у findbar/translate-popover.
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { PermissionRequest } from '../shared/ipc'
import { installOverlayBackdrop } from './overlayBackdropPreload';

// Размытая подложка под карточкой — снимок страницы под ней (см. electron/overlayBackdrop.ts).
installOverlayBackdrop();

contextBridge.exposeInMainWorld('permissionPopover', {
  respond: (requestId: string, granted: boolean, remember: boolean) =>
    ipcRenderer.invoke(IPC.PERMISSION_RESPONSE, requestId, granted, remember),
  reportHeight: (px: number) => ipcRenderer.send('permission-popover:height', px),

  // null — очередь опустела; вью просто ничего не рисует (её вот-вот открепят).
  onRequest: (cb: (req: PermissionRequest | null) => void) => {
    const handler = (_e: unknown, req: PermissionRequest | null) => cb(req)
    ipcRenderer.on('permission-popover:request', handler)
    return () => ipcRenderer.removeListener('permission-popover:request', handler)
  },
})
