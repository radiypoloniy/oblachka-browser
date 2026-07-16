import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { VpnServerMeta, VpnConnectionState, AdBlockState } from '../shared/ipc';
import { normalizeDomain } from '../shared/domain';
import VpnIndicatorPopover from './components/VpnIndicatorPopover';
import AdBlockSitePanel from './components/AdBlockSitePanel';
import './styles/global.css';

declare global {
  interface Window {
    vpnPopover: {
      listVpnServers: () => Promise<VpnServerMeta[]>;
      getVpnConnectionState: () => Promise<VpnConnectionState>;
      vpnConnect: (serverId: string) => Promise<{ ok: boolean; error?: string }>;
      vpnDisconnect: () => Promise<void>;
      onVpnConnectionStateChanged: (cb: (state: VpnConnectionState) => void) => () => void;
      getAdBlockState: () => Promise<AdBlockState>;
      adBlockSetEnabled: (v: boolean) => Promise<void>;
      adBlockAddDomain: (domain: string) => Promise<void>;
      adBlockRemoveDomain: (domain: string) => Promise<void>;
      adBlockReloadTabs: (domain?: string) => Promise<void>;
      isDomainWhitelisted: (domain: string) => Promise<boolean>;
      getSiteBlockCount: (domain: string) => Promise<number>;
      close: () => void;
      reportHeight: (px: number) => void;
      onShow: (cb: () => void) => () => void;
      onActiveUrlChanged: (cb: (url: string) => void) => () => void;
    };
  }
}

// Держать в синхроне с SHADOW_MARGIN в electron/VpnPopoverManager.ts.
const SHADOW_MARGIN = 16;

function VpnPopoverApp() {
  const [servers, setServers] = useState<VpnServerMeta[]>([]);
  const [connState, setConnState] = useState<VpnConnectionState | null>(null);
  const [adBlockState, setAdBlockState] = useState<AdBlockState | null>(null);
  const [activeUrl, setActiveUrl] = useState('');
  const [whitelisted, setWhitelisted] = useState(false);
  const [siteBlockCount, setSiteBlockCount] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  // При каждом показе (клик по пилюле) — свежий список серверов + статус, а не то, что было
  // при последнем открытии (подписка/сервер могли смениться в Настройках, пока поповер был закрыт).
  useEffect(() => {
    return window.vpnPopover.onShow(() => {
      void window.vpnPopover.listVpnServers().then(setServers);
      void window.vpnPopover.getVpnConnectionState().then(setConnState);
      void window.vpnPopover.getAdBlockState().then(setAdBlockState);
    });
  }, []);

  // Живые апдейты, пока поповер открыт — подключение к серверу занимает ~1-2с (starting → running),
  // без этого пользователь не увидел бы прогресс, только конечный результат при следующем открытии.
  useEffect(() => window.vpnPopover.onVpnConnectionStateChanged(setConnState), []);

  // Домен активной вкладки: приходит и при открытии (Toolbar шлёт его непосредственно перед
  // showVpnPopover), и при навигации в ТОЙ ЖЕ вкладке, пока поповер остаётся открытым — сама
  // смена вкладки поповер закрывает целиком (см. Toolbar.tsx::useEffect по tab?.id), так что
  // «сменить домен без переоткрытия поповера» здесь означает именно навигацию внутри вкладки.
  useEffect(() => window.vpnPopover.onActiveUrlChanged(setActiveUrl), []);

  const domain = normalizeDomain(activeUrl);

  // Per-site статус (whitelist + счётчик) пересчитываем при каждой смене домена — покрывает и
  // первый показ (activeUrl приходит после начального рендера), и навигацию внутри вкладки.
  useEffect(() => {
    if (!domain) { setWhitelisted(false); setSiteBlockCount(0); return; }
    void window.vpnPopover.isDomainWhitelisted(domain).then(setWhitelisted);
    void window.vpnPopover.getSiteBlockCount(domain).then(setSiteBlockCount);
  }, [domain]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.vpnPopover.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [servers, connState, adBlockState, domain, whitelisted]);

  // Нет живого push'а ADBLOCK_STATE_CHANGED в эту вью (main шлёт его только в chromeView, см.
  // preload-vpnpopover.ts) — после своей же мутации просто перезапрашиваем состояние явно.
  async function handleToggleEnabled() {
    if (!adBlockState) return;
    await window.vpnPopover.adBlockSetEnabled(!adBlockState.enabled);
    void window.vpnPopover.getAdBlockState().then(setAdBlockState);
  }

  async function handleToggleSite() {
    if (!domain) return;
    if (whitelisted) await window.vpnPopover.adBlockRemoveDomain(domain);
    else await window.vpnPopover.adBlockAddDomain(domain);
    setWhitelisted(!whitelisted);
    // Whitelist влияет на будущие запросы страницы, а не задним числом — без перезагрузки
    // пользователь не увидит эффект тумблера на уже открытой странице.
    void window.vpnPopover.adBlockReloadTabs(domain);
  }

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <VpnIndicatorPopover
          servers={servers}
          connState={connState}
          onConnect={async (id) => { await window.vpnPopover.vpnConnect(id); }}
          onDisconnect={async () => { await window.vpnPopover.vpnDisconnect(); }}
        />
        {adBlockState && (
          <AdBlockSitePanel
            enabled={adBlockState.enabled}
            domain={domain}
            whitelisted={whitelisted}
            blockedCount={siteBlockCount}
            onToggleEnabled={() => { void handleToggleEnabled(); }}
            onToggleSite={() => { void handleToggleSite(); }}
          />
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VpnPopoverApp />
  </React.StrictMode>,
);
