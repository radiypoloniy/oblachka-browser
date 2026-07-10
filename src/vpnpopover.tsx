import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { VpnServerMeta, VpnConnectionState } from '../shared/ipc';
import VpnIndicatorPopover from './components/VpnIndicatorPopover';
import './styles/global.css';

declare global {
  interface Window {
    vpnPopover: {
      listVpnServers: () => Promise<VpnServerMeta[]>;
      getVpnConnectionState: () => Promise<VpnConnectionState>;
      vpnConnect: (serverId: string) => Promise<{ ok: boolean; error?: string }>;
      vpnDisconnect: () => Promise<void>;
      onVpnConnectionStateChanged: (cb: (state: VpnConnectionState) => void) => () => void;
      close: () => void;
      reportHeight: (px: number) => void;
      onShow: (cb: () => void) => () => void;
    };
  }
}

// Держать в синхроне с SHADOW_MARGIN в electron/VpnPopoverManager.ts.
const SHADOW_MARGIN = 16;

function VpnPopoverApp() {
  const [servers, setServers] = useState<VpnServerMeta[]>([]);
  const [connState, setConnState] = useState<VpnConnectionState | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // При каждом показе (клик по пилюле) — свежий список серверов + статус, а не то, что было
  // при последнем открытии (подписка/сервер могли смениться в Настройках, пока поповер был закрыт).
  useEffect(() => {
    return window.vpnPopover.onShow(() => {
      void window.vpnPopover.listVpnServers().then(setServers);
      void window.vpnPopover.getVpnConnectionState().then(setConnState);
    });
  }, []);

  // Живые апдейты, пока поповер открыт — подключение к серверу занимает ~1-2с (starting → running),
  // без этого пользователь не увидел бы прогресс, только конечный результат при следующем открытии.
  useEffect(() => window.vpnPopover.onVpnConnectionStateChanged(setConnState), []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.vpnPopover.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [servers, connState]);

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef}>
        <VpnIndicatorPopover
          servers={servers}
          connState={connState}
          onConnect={async (id) => { await window.vpnPopover.vpnConnect(id); }}
          onDisconnect={async () => { await window.vpnPopover.vpnDisconnect(); }}
        />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VpnPopoverApp />
  </React.StrictMode>,
);
