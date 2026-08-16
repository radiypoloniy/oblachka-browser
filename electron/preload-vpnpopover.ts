import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { VpnServerMeta, VpnConnectionState, AdBlockState } from '../shared/ipc';

contextBridge.exposeInMainWorld('vpnPopover', {
  listVpnServers:        () => ipcRenderer.invoke(IPC.VPN_LIST_SERVERS) as Promise<VpnServerMeta[]>,
  getVpnConnectionState: () => ipcRenderer.invoke(IPC.VPN_GET_CONNECTION_STATE) as Promise<VpnConnectionState>,
  vpnConnect:    (serverId: string) => ipcRenderer.invoke(IPC.VPN_CONNECT, serverId) as Promise<{ ok: boolean; error?: string }>,
  vpnDisconnect: () => ipcRenderer.invoke(IPC.VPN_DISCONNECT) as Promise<void>,
  onVpnConnectionStateChanged: (cb: (state: VpnConnectionState) => void) => {
    const handler = (_e: unknown, state: VpnConnectionState) => cb(state);
    ipcRenderer.on(IPC.VPN_CONNECTION_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.VPN_CONNECTION_STATE_CHANGED, handler);
  },
  // Заход «Защита» (шаг 3) — адблок-секция того же поповера. Реюзаем те же каналы, что и боевой
  // window.oblako/Settings.tsx (ipcMain.handle не привязан к конкретному preload'у), плюс два
  // геттера с шагов 1-2 (getBlockedCountForDomain/isWhitelisted), у которых потребителя раньше
  // не было вообще. Живого push'а на ADBLOCK_STATE_CHANGED сюда нет (main шлёт его только в
  // chromeView) — enabled/whitelist-статус перезапрашиваем сами после каждой мутации.
  getAdBlockState:     () => ipcRenderer.invoke(IPC.ADBLOCK_GET_STATE) as Promise<AdBlockState>,
  adBlockSetEnabled:   (v: boolean) => ipcRenderer.invoke(IPC.ADBLOCK_SET_ENABLED, v) as Promise<void>,
  adBlockAddDomain:    (domain: string) => ipcRenderer.invoke(IPC.ADBLOCK_ADD_DOMAIN, domain) as Promise<void>,
  adBlockRemoveDomain: (domain: string) => ipcRenderer.invoke(IPC.ADBLOCK_REMOVE_DOMAIN, domain) as Promise<void>,
  adBlockReloadTabs:   (domain?: string) => ipcRenderer.invoke(IPC.ADBLOCK_RELOAD_TABS, domain) as Promise<void>,
  isDomainWhitelisted: (domain: string) => ipcRenderer.invoke(IPC.ADBLOCK_IS_WHITELISTED, domain) as Promise<boolean>,
  getSiteBlockCount:   (domain: string) => ipcRenderer.invoke(IPC.ADBLOCK_GET_SITE_BLOCK_COUNT, domain) as Promise<number>,
  close:        () => ipcRenderer.send(IPC.VPN_POPOVER_CLOSE),
  reportHeight: (px: number) => ipcRenderer.send('vpn-popover:height', px),
  onShow: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(IPC.VPN_POPOVER_SHOW, handler);
    return () => ipcRenderer.removeListener(IPC.VPN_POPOVER_SHOW, handler);
  },
  // Домен активной вкладки — приходит и при открытии (Toolbar шлёт его непосредственно перед
  // showVpnPopover), и при навигации в ТОЙ ЖЕ вкладке, пока поповер остаётся открытым (смена
  // самой вкладки поповер закрывает, см. Toolbar.tsx::useEffect по tab?.id).
  onActiveUrlChanged: (cb: (url: string) => void) => {
    const handler = (_e: unknown, url: string) => cb(url);
    ipcRenderer.on('vpn-popover:active-url', handler);
    return () => ipcRenderer.removeListener('vpn-popover:active-url', handler);
  },
});
