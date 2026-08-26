import { useEffect, useState } from 'react';
import type { VpnConnectionState } from '../../shared/ipc';

// VPN, шаг 3 — реальное состояние вместо мока (было: локальный boolean, всегда true при старте,
// «Финляндия» захардкожена в Toolbar.tsx). Индикатор, который не отражает, действительно ли
// сейчас блокируется/маршрутизируется трафик, — прямая противоположность тому, что должен
// давать fail-closed (см. electron/main.ts::applyVpnProxy). null — статус ещё не загружен.
//
// Читает его щит в адресной строке (toolbar/ShieldButton.tsx и карточка сайта под ним),
// а не отдельная пилюля: VpnPill из тулбара убрана, ссылка на неё в старом комментарии протухла.
export function useVpnConnection(): VpnConnectionState | null {
  const [vpnConn, setVpnConn] = useState<VpnConnectionState | null>(null);

  useEffect(() => {
    void window.oblako.getVpnConnectionState().then(setVpnConn);
    const unsub = window.oblako.onVpnConnectionStateChanged(setVpnConn);
    return () => unsub();
  }, []);

  return vpnConn;
}
