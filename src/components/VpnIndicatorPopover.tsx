import { useState } from 'react';
import type React from 'react';
import { Check, Shield, Loader2 } from 'lucide-react';
import type { VpnServerMeta, VpnConnectionState } from '../../shared/ipc';
import { stripEmoji } from '../../shared/text';
import { islandPlate } from '../styles/island';

// VPN-пилюля, шаг 4 — карточка поповера. Тот же слой, что PasswordIndicatorPopover.tsx
// (отдельная WebContentsView поверх страницы, см. VpnPopoverManager.ts), но без state сверху —
// список серверов и статус подключения приходят сюда уже готовыми пропсами от vpnpopover.tsx
// (тот сам их запрашивает и переподписывается на push, см. preload-vpnpopover.ts).
interface Props {
  servers: VpnServerMeta[];
  connState: VpnConnectionState | null;
  onConnect: (id: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export default function VpnIndicatorPopover({ servers, connState, onConnect, onDisconnect }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const isStarting = connState?.state === 'starting';
  const isRunning = connState?.state === 'running';
  const isError = connState?.state === 'error';

  async function handleConnect(id: string) {
    setBusyId(id);
    try {
      await onConnect(id);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await onDisconnect();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div style={{
      width: 300,
      ...islandPlate,
      borderRadius: 'var(--radius-card)', padding: 16,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Shield size={16} style={{ color: isRunning ? 'var(--dot-vpn)' : 'var(--text-faint)' }}
          fill={isRunning ? 'var(--dot-vpn)' : 'none'} />
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)', fontWeight: 600 }}>
          {isRunning ? `Подключено · ${stripEmoji(connState!.serverRemark ?? '')}`
            : isStarting ? 'Подключение…'
            : isError ? 'Ошибка подключения'
            : 'VPN выключен'}
        </div>
      </div>

      {isError && connState?.error && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger-500)' }}>
          {connState.error}
        </div>
      )}

      {(isRunning || isError) && (
        <button onClick={() => void handleDisconnect()} disabled={disconnecting} style={btnGhost}>
          {disconnecting ? 'Отключение…' : 'Отключить'}
        </button>
      )}

      {servers.length === 0 ? (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          Подписка не добавлена — настройте её в Настройках → VPN.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
          {servers.map((s) => {
            const active = connState?.serverId === s.id && (isRunning || isStarting);
            return (
              <button
                key={s.id}
                disabled={busyId !== null || isStarting}
                onClick={() => void handleConnect(s.id)}
                style={{ ...btnGhost, textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center' }}
              >
                {busyId === s.id
                  ? <Loader2 size={14} style={{ color: 'var(--accent)', flex: 'none', animation: 'oblako-spin 1s linear infinite' }} />
                  : active
                    ? <Check size={14} style={{ color: 'var(--accent)', flex: 'none' }} />
                    : <span style={{ width: 14, flex: 'none' }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {stripEmoji(s.remark) || s.address}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const btnGhost: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--divider-strong)', background: 'transparent',
  color: 'var(--text-body)', fontSize: 'var(--fs-sm)', cursor: 'default', flex: 'none',
};
