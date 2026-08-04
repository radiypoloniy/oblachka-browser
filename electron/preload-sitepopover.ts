import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { PermissionRecord, PermKey, SemanticSearchResult } from '../shared/ipc';

// Мост поповера сведений о сайте. ⚠️ Ни одного нового обработчика в main: всё, что здесь нужно,
// уже посчитано другими частями браузера и открыто теми же боевыми каналами — разрешения из
// PermissionManager, счётчик заблокированного из AdBlockManager, связанные страницы из
// RelatedHistory. Поповер только собирает это в одном месте.
contextBridge.exposeInMainWorld('sitePopover', {
  // Какая страница открыта сейчас — берём у менеджера вкладок окна-отправителя, а не из аргумента:
  // renderer поповера мог открыться раньше, чем доехала навигация.
  getActiveTab: () => ipcRenderer.invoke(IPC.SITE_POPOVER_ACTIVE_TAB) as Promise<{ url: string; title: string } | null>,

  getPermissions: () => ipcRenderer.invoke(IPC.PERMISSION_LIST) as Promise<PermissionRecord[]>,
  revokePermission: (origin: string, key: PermKey) => ipcRenderer.invoke(IPC.PERMISSION_REVOKE, origin, key) as Promise<void>,

  getBlockedCount: (domain: string) => ipcRenderer.invoke(IPC.ADBLOCK_GET_SITE_BLOCK_COUNT, domain) as Promise<number>,
  isAdblockAllowed: (domain: string) => ipcRenderer.invoke(IPC.ADBLOCK_IS_WHITELISTED, domain) as Promise<boolean>,

  // «Вы это уже читали» — тот же канал, что раньше звал омнибокс (см. RelatedHistory.ts).
  getRelatedPages: () => ipcRenderer.invoke(IPC.HISTORY_RELATED) as Promise<SemanticSearchResult[]>,
  openUrl: (url: string) => ipcRenderer.invoke(IPC.TAB_CREATE, url) as Promise<string>,

  close: () => ipcRenderer.send('site-popover:close'),
  reportHeight: (px: number) => ipcRenderer.send('site-popover:height', px),
  onShow: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('site-popover:show', handler);
    return () => ipcRenderer.removeListener('site-popover:show', handler);
  },
});
