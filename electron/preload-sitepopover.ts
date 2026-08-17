import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { PermissionRecord, PermKey, PageChangesResult, VpnServerMeta, VpnConnectionState, AdBlockState } from '../shared/ipc';

// Мост поповера «Защита» — того, что открывается по щиту в адресной строке. ⚠️ Ни одного нового
// обработчика в main: всё, что здесь нужно, уже посчитано другими частями браузера и открыто теми
// же боевыми каналами — разрешения из PermissionManager, счётчик заблокированного и белый список
// из AdBlockManager, серверы и состояние из VpnManager. Поповер только собирает это в одном месте.
//
// ⚠️ Сюда переехало содержимое бывшего поповера VPN-пилюли (preload-vpnpopover.ts, удалён вместе с
// VpnPopoverManager). Причина не в экономии файлов: пилюля «Защита» и замок отвечали на один и тот
// же вопрос — «что защищает меня прямо сейчас», — и разводить его по двум кнопкам в одной полосе
// было нечем оправдать.
contextBridge.exposeInMainWorld('sitePopover', {
  // Какая страница открыта сейчас — берём у менеджера вкладок окна-отправителя, а не из аргумента:
  // renderer поповера мог открыться раньше, чем доехала навигация.
  getActiveTab: () => ipcRenderer.invoke(IPC.SITE_POPOVER_ACTIVE_TAB) as Promise<{ url: string; title: string } | null>,

  getPermissions: () => ipcRenderer.invoke(IPC.PERMISSION_LIST) as Promise<PermissionRecord[]>,
  revokePermission: (origin: string, key: PermKey) => ipcRenderer.invoke(IPC.PERMISSION_REVOKE, origin, key) as Promise<void>,

  getBlockedCount: (domain: string) => ipcRenderer.invoke(IPC.ADBLOCK_GET_SITE_BLOCK_COUNT, domain) as Promise<number>,
  isAdblockAllowed: (domain: string) => ipcRenderer.invoke(IPC.ADBLOCK_IS_WHITELISTED, domain) as Promise<boolean>,

  // ── VPN ──────────────────────────────────────────────────────────────────────
  listVpnServers:        () => ipcRenderer.invoke(IPC.VPN_LIST_SERVERS) as Promise<VpnServerMeta[]>,
  getVpnConnectionState: () => ipcRenderer.invoke(IPC.VPN_GET_CONNECTION_STATE) as Promise<VpnConnectionState>,
  vpnConnect:    (serverId: string) => ipcRenderer.invoke(IPC.VPN_CONNECT, serverId) as Promise<{ ok: boolean; error?: string }>,
  vpnDisconnect: () => ipcRenderer.invoke(IPC.VPN_DISCONNECT) as Promise<void>,
  // Подключение занимает 1-2 секунды (starting → running). Без живого обновления человек увидел бы
  // только конечный результат, да и то при следующем открытии.
  onVpnConnectionStateChanged: (cb: (state: VpnConnectionState) => void) => {
    const handler = (_e: unknown, state: VpnConnectionState) => cb(state);
    ipcRenderer.on(IPC.VPN_CONNECTION_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.VPN_CONNECTION_STATE_CHANGED, handler);
  },

  // ── Адблок: те же каналы, что у настроек (ipcMain.handle не привязан к preload'у) ──
  // ⚠️ Живого push'а ADBLOCK_STATE_CHANGED сюда нет — main шлёт его только в слой хрома. Поэтому
  // после каждой своей мутации состояние перезапрашивается явно.
  getAdBlockState:     () => ipcRenderer.invoke(IPC.ADBLOCK_GET_STATE) as Promise<AdBlockState>,
  adBlockSetEnabled:   (v: boolean) => ipcRenderer.invoke(IPC.ADBLOCK_SET_ENABLED, v) as Promise<void>,
  adBlockAddDomain:    (domain: string) => ipcRenderer.invoke(IPC.ADBLOCK_ADD_DOMAIN, domain) as Promise<void>,
  adBlockRemoveDomain: (domain: string) => ipcRenderer.invoke(IPC.ADBLOCK_REMOVE_DOMAIN, domain) as Promise<void>,
  adBlockReloadTabs:   (domain?: string) => ipcRenderer.invoke(IPC.ADBLOCK_RELOAD_TABS, domain) as Promise<void>,

  getPageChanges: () => ipcRenderer.invoke(IPC.PAGE_CHANGES_GET) as Promise<PageChangesResult>,
  openUrl: (url: string) => ipcRenderer.invoke(IPC.TAB_CREATE, url) as Promise<string>,

  close: () => ipcRenderer.send('site-popover:close'),
  reportHeight: (px: number) => ipcRenderer.send('site-popover:height', px),
  onShow: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('site-popover:show', handler);
    return () => ipcRenderer.removeListener('site-popover:show', handler);
  },
});
