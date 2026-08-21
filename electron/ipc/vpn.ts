// VPN: подписка, список серверов, процесс Xray, состояние соединения
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { IPC } from '../../shared/ipc';
import type { VpnConnectionState } from '../../shared/ipc';
import * as vpnKeyStore from '../VpnKeyStore';
import { toServerMeta } from '../VpnParser';
import { broadcastVpnState } from '../SitePopoverManager';
import * as vpnProcess from '../VpnProcess';
import * as vpnSubscription from '../VpnSubscription';
import { broadcastToChrome } from '../WindowRegistry';
import { ipcMain } from 'electron';
import type { IpcDeps } from './deps';

export function registerVpnIpc(d: IpcDeps): void {
  const { applyVpnProxy } = d;

  const vpnStatus = () => ({
    hasSubscription: vpnKeyStore.hasSubscription(),
    serverCount: vpnKeyStore.getServerCount(),
    fetchedAt: vpnKeyStore.getFetchedAt(),
  });
  ipcMain.handle(IPC.VPN_GET_STATUS, () => vpnStatus());
  ipcMain.handle(IPC.VPN_SET_SUBSCRIPTION, (_e, url: string) => vpnSubscription.setSubscription(url));
  ipcMain.handle(IPC.VPN_REFRESH_SUBSCRIPTION, () => vpnSubscription.refresh());
  ipcMain.handle(IPC.VPN_DELETE_SUBSCRIPTION, () => vpnKeyStore.deleteSubscription());
  ipcMain.handle(IPC.VPN_LIST_SERVERS, () => vpnKeyStore.getServers().map(toServerMeta));
  vpnKeyStore.onChanged(() => {
    broadcastToChrome(IPC.VPN_STATUS_CHANGED, vpnStatus());
  });

  // Трафик вкладок переключает applyVpnProxy в main (session.setProxy). Здесь — процесс
  // Xray и снимок для UI. vpnConnectionTarget не сбрасывается при неудачном connect —
  // иначе состояние 'error' потеряло бы "какой именно сервер не подключился".
  let vpnConnectionTarget: { id: string; remark: string } | null = null;
  // Захватывается из onStateChange(state, error) ниже — VpnProcess.getState() отдаёт только
  // строку состояния, само сообщение раньше нигде не сохранялось (баг, пойман живым тестом:
  // kill switch блокировал трафик правильно, но UI не мог показать пользователю, ПОЧЕМУ).
  let lastVpnError: string | undefined;
  const vpnConnectionState = (): VpnConnectionState => ({
    state: vpnProcess.getState(),
    serverId: vpnConnectionTarget?.id ?? null,
    serverRemark: vpnConnectionTarget?.remark ?? null,
    error: lastVpnError,
  });
  ipcMain.handle(IPC.VPN_CONNECT, async (_e, serverId: string) => {
    const server = vpnKeyStore.getServers().find((s) => s.id === serverId);
    if (!server) return { ok: false, error: 'Сервер не найден — обновите подписку' };
    vpnConnectionTarget = { id: server.id, remark: server.remark };
    const res = await vpnProcess.start(server);
    await applyVpnProxy();
    return res;
  });
  ipcMain.handle(IPC.VPN_DISCONNECT, async () => {
    // ⚠️ ВСЕГДА сбрасывает target/error — см. VpnProcess.ts::stop() про живой баг, который эта
    // симметрия раньше маскировала (kill switch блокировал трафик навсегда без выхода).
    // Disconnect — гарантированный путь назад к рабочему состоянию, а не «почти сброс».
    await vpnProcess.stop();
    vpnConnectionTarget = null;
    lastVpnError = undefined;
    await applyVpnProxy();
  });
  ipcMain.handle(IPC.VPN_GET_CONNECTION_STATE, () => vpnConnectionState());
  // Правило «включай VPN» (см. RuleEngine.ts). Возвращает true, только если ВКЛЮЧИЛИ прямо
  // сейчас — по этому признаку движок решает, перезагружать ли страницу.
  // ⚠️ Сервер человек в фразе не называл, поэтому берём тот, к которому уже подключались в этом
  // сеансе, а иначе первый из подписки. Молчаливый отказ при пустой подписке — правильный исход:
  // правило не должно открывать диалоги поверх страницы, на которую человек только что зашёл.
  d.setEnsureVpnOnForRules(async () => {
    // 'running' — рабочее состояние Xray; 'starting' тоже не повод запускать второй раз.
    const state = vpnProcess.getState();
    if (state === 'running' || state === 'starting') return false;
    const servers = vpnKeyStore.getServers();
    const server = servers.find((s) => s.id === vpnConnectionTarget?.id) ?? servers[0];
    if (!server) {
      console.warn('[rules] VPN не включить — подписки нет');
      return false;
    }
    vpnConnectionTarget = { id: server.id, remark: server.remark };
    const res = await vpnProcess.start(server);
    await applyVpnProxy();
    if (!res.ok) console.warn('[rules] VPN не включился:', res.error);
    return !!res.ok;
  });
  vpnProcess.onStateChange((_state, error) => {
    lastVpnError = error;
    // UI «защита включена / kill switch» только после фактического setProxy — иначе карточка
    // соврала бы на то самое окно, ради которого kill switch и написан (аудит 11.08, находка 2).
    void applyVpnProxy().then(
      () => {
        const connState = vpnConnectionState();
        broadcastToChrome(IPC.VPN_CONNECTION_STATE_CHANGED, connState);
        broadcastVpnState(connState);
      },
      (err: unknown) => {
        console.error('[vpn] applyVpnProxy не применил правила:', err);
        const connState = vpnConnectionState();
        broadcastToChrome(IPC.VPN_CONNECTION_STATE_CHANGED, connState);
        broadcastVpnState(connState);
      },
    );
  });
  void applyVpnProxy(); // детерминированная база на старте — 'stopped' → direct, а не implicit-дефолт Electron

  // Менеджер паролей, шаг 1 (см. electron/PasswordManager.ts). Пароль пересекает IPC только
}
