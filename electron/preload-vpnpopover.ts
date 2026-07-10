import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { VpnServerMeta, VpnConnectionState } from '../shared/ipc';

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
  close:        () => ipcRenderer.send('vpn-popover:close'),
  reportHeight: (px: number) => ipcRenderer.send('vpn-popover:height', px),
  onShow: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('vpn-popover:show', handler);
    return () => ipcRenderer.removeListener('vpn-popover:show', handler);
  },
});
