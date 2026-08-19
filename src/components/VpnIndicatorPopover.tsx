import { useState } from 'react';
import { Check, Shield, Loader2 } from 'lucide-react';
import type { VpnServerMeta, VpnConnectionState } from '../../shared/ipc';
import { stripEmoji } from '../../shared/text';
import { detectCountry } from '../../shared/countries';
import CountryFlag from './CountryFlag';
import { islandPlate } from '../styles/island';
import { PopoverRow, QuietButton } from './popoverKit';

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
  const connectedCountry = detectCountry(connState?.serverRemark ?? '');

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
        <Shield size={16} style={{ color: isRunning ? 'var(--dot-vpn)' : 'var(--text-faint)', flex: 'none' }}
          fill={isRunning ? 'var(--dot-vpn)' : 'none'} />
        {isRunning && connectedCountry && (
          <CountryFlag code={connectedCountry.code} title={connectedCountry.name} width={18} />
        )}
        <div style={{
          fontSize: 'var(--fs-sm)', color: 'var(--text-strong)', fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
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
        <QuietButton onClick={() => void handleDisconnect()} disabled={disconnecting}>
          {disconnecting ? 'Отключение…' : 'Отключить'}
        </QuietButton>
      )}

      {servers.length === 0 ? (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          Подписка не добавлена — настройте её в Настройках → VPN.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
          {servers.map((s) => {
            const active = connState?.serverId === s.id && (isRunning || isStarting);
            const country = detectCountry(s.remark);
            // Имя без эмодзи может схлопнуться в пустоту («🇳🇱» и ничего больше) — тогда
            // подписью работает страна, а адрес остаётся последним рубежом.
            const label = stripEmoji(s.remark) || country?.name || s.address;
            return (
              <PopoverRow
                key={s.id}
                icon={country ? <CountryFlag code={country.code} title={country.name} /> : undefined}
                title={label}
                selected={active}
                disabled={busyId !== null || isStarting}
                onClick={() => void handleConnect(s.id)}
                trailing={busyId === s.id
                  ? <Loader2 size={14} style={{ color: 'var(--accent)', animation: 'oblako-spin 1s linear infinite' }} />
                  : active
                    ? <Check size={14} style={{ color: 'var(--success-500)' }} />
                    : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// Чистый Ghost (см. референс дизайн-системы, Oblako Design System.htm: Ghost = border-style: none
// во всех состояниях, только заливка фона меняется) — раньше здесь была постоянная рамка
// var(--divider-strong) и НИКАКОГО hover, кнопки выглядели «мёртвыми». border убран, hover —
// тот же паттерн inline onMouseEnter/onMouseLeave → var(--surface-hover), что уже используется
// в Toolbar.tsx/Settings.tsx/History.tsx/Sidebar.tsx (не изобретаем новый).
// ⚠️ Своя пара кнопок отсюда убрана: она была третьей копией одной и той же пары (пароли,
// автозаполнение, VPN), и все три разъехались по полям. Общая живёт в popoverKit.
