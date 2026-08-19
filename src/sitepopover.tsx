import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Lock, ShieldOff, Camera, Mic, MapPin, Bell, Maximize, Clipboard, RotateCcw, History, ExternalLink } from 'lucide-react';
import type { PermissionRecord, PermKey, PageChangesResult, VpnServerMeta, VpnConnectionState, AdBlockState } from '../shared/ipc';
// ⚠️ Поверхность оверлея (непрозрачная), а не островная плита: карточка живёт в своей вью над
// страницей, где backdrop-filter не работает вовсе, и полупрозрачность означала бы
// просвечивающий текст сайта. Разбор — у --overlay-plate в styles/tokens/colors.css.
import { overlayPlate } from './styles/island';
import { normalizeDomain } from '../shared/domain';
import VpnIndicatorPopover from './components/VpnIndicatorPopover';
import AdBlockSitePanel from './components/AdBlockSitePanel';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';

declare global {
  interface Window {
    sitePopover: {
      getActiveTab: () => Promise<{ url: string; title: string } | null>;
      getPermissions: () => Promise<PermissionRecord[]>;
      revokePermission: (origin: string, key: PermKey) => Promise<void>;
      getBlockedCount: (domain: string) => Promise<number>;
      isAdblockAllowed: (domain: string) => Promise<boolean>;
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
      getPageChanges: () => Promise<PageChangesResult>;
      openUrl: (url: string) => Promise<string>;
      close: () => void;
      reportHeight: (px: number) => void;
      onShow: (cb: () => void) => () => void;
    };
  }
}


const CARD_WIDTH = 340;

// Те же подписи и значки, что в разделе настроек «Разрешения» — словарь один на два места,
// иначе одно и то же разрешение называлось бы по-разному в поповере и в настройках.
const PERM_LABEL: Record<PermKey, string> = {
  'camera': 'Камера',
  'microphone': 'Микрофон',
  'camera+microphone': 'Камера и микрофон',
  'external-app': 'Открытие приложений',
  'geolocation': 'Местоположение',
  'notifications': 'Уведомления',
  'fullscreen': 'Полный экран',
  'clipboard-read': 'Чтение буфера обмена',
  'clipboard-sanitized-write': 'Запись в буфер обмена',
};
const PERM_ICON: Record<PermKey, typeof Camera> = {
  'camera': Camera,
  'microphone': Mic,
  'camera+microphone': Camera,
  'external-app': ExternalLink,
  'geolocation': MapPin,
  'notifications': Bell,
  'fullscreen': Maximize,
  'clipboard-read': Clipboard,
  'clipboard-sanitized-write': Clipboard,
};

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function originOf(url: string): string {
  try { return new URL(url).origin; } catch { return ''; }
}

function SitePopoverApp() {
  const [url, setUrl] = useState('');
  const [perms, setPerms] = useState<PermissionRecord[]>([]);
  const [blocked, setBlocked] = useState<number | null>(null);
  const [adblockOff, setAdblockOff] = useState(false);
  // «Что изменилось с прошлого раза» (AI-IDEAS.md №7). null — ещё считаем.
  const [changes, setChanges] = useState<PageChangesResult | null>(null);
  // ── Защита: VPN и адблок. Переехали сюда из поповера пилюли «Защита» (удалён). ──
  const [servers, setServers] = useState<VpnServerMeta[]>([]);
  const [connState, setConnState] = useState<VpnConnectionState | null>(null);
  const [adBlockState, setAdBlockState] = useState<AdBlockState | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // ⚠️ Всё перечитывается НА КАЖДЫЙ ПОКАЗ: вью между открытиями живёт, а сведения относятся к
  // конкретной странице — за это время человек десять раз сменил вкладку. Список серверов тоже:
  // подписку и сервер могли сменить в настройках, пока поповер был закрыт.
  const reload = useCallback(async () => {
    void window.sitePopover.listVpnServers().then(setServers);
    void window.sitePopover.getVpnConnectionState().then(setConnState);
    void window.sitePopover.getAdBlockState().then(setAdBlockState);
    const tab = await window.sitePopover.getActiveTab();
    const tabUrl = tab?.url ?? '';
    setUrl(tabUrl);
    const host = hostOf(tabUrl);
    // ⚠️ Нет сайта (новая вкладка, инкогнито, настройки) — это НЕ повод не открываться: раздел
    // «Защита» глобальный и нужен как раз оттуда, VPN чаще всего включают на новой вкладке.
    // Гасим только то, что про сайт.
    if (!host) { setPerms([]); setBlocked(null); setAdblockOff(false); setChanges(null); return; }
    void window.sitePopover.getPermissions().then(setPerms);
    void window.sitePopover.getBlockedCount(host).then(setBlocked);
    void window.sitePopover.isAdblockAllowed(host).then(setAdblockOff);
    void window.sitePopover.getPageChanges().then(setChanges).catch(() => setChanges({ changed: false }));
  }, []);

  // Живое состояние VPN, пока карточка открыта: подключение идёт 1-2 секунды.
  useEffect(() => window.sitePopover.onVpnConnectionStateChanged(setConnState), []);

  useEffect(() => window.sitePopover.onShow(() => { void reload(); }), [reload]);
  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.sitePopover.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const host = hostOf(url);
  const origin = originOf(url);
  const secure = url.startsWith('https://');
  const sitePerms = perms.filter((p) => p.origin === origin);
  const domain = normalizeDomain(url);

  // Адблок общий выключатель. Push'а ADBLOCK_STATE_CHANGED в эту вью нет (main шлёт его только в
  // слой хрома), поэтому после своей же мутации состояние перезапрашиваем явно.
  async function toggleAdBlockEnabled() {
    if (!adBlockState) return;
    await window.sitePopover.adBlockSetEnabled(!adBlockState.enabled);
    void window.sitePopover.getAdBlockState().then(setAdBlockState);
  }

  // Исключение для домена. ⚠️ Белый список действует на БУДУЩИЕ запросы, а не задним числом —
  // без перезагрузки человек не увидит эффекта тумблера на уже открытой странице.
  async function toggleAdBlockSite() {
    if (!domain) return;
    if (adblockOff) await window.sitePopover.adBlockRemoveDomain(domain);
    else await window.sitePopover.adBlockAddDomain(domain);
    setAdblockOff(!adblockOff);
    void window.sitePopover.adBlockReloadTabs(domain);
  }

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={{
        width: CARD_WIDTH, ...overlayPlate,
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-sans)',
      }}>
        {/* ── Соединение ── */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 'var(--radius-sm)', flex: 'none',
            background: secure ? 'color-mix(in srgb, var(--dot-local) 14%, transparent)' : 'color-mix(in srgb, var(--danger-500) 14%, transparent)',
            color: secure ? 'var(--dot-local)' : 'var(--danger-500)',
          }}>
            {secure ? <Lock size={16} /> : <ShieldOff size={16} />}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {host || 'Страница браузера'}
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
              {!host ? 'Внутренняя страница Oblako'
                : secure ? 'Соединение защищено — данные шифруются'
                : 'Соединение не защищено: данные идут открытым текстом'}
            </div>
          </div>
        </div>

        {/* ── Защита: VPN и адблок ──
            ⚠️ Раздел ГЛОБАЛЬНЫЙ и показывается всегда, в том числе на новой вкладке и в
            инкогнито, где сайта нет вовсе. Иначе до VPN оттуда было бы не добраться — а включают
            его чаще всего именно с новой вкладки, перед тем как куда-то пойти.
            Разделы намеренно подписаны по-разному («Защита» / «Этот сайт» ниже): VPN и общий
            выключатель адблока действуют на весь браузер, а разрешения и исключение — на один
            домен. Без явной границы это читалось бы как «я меняю настройку для этого сайта». */}
        <Section title="Защита">
          <div style={{ padding: '2px 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <VpnIndicatorPopover
              servers={servers}
              connState={connState}
              onConnect={async (id) => { await window.sitePopover.vpnConnect(id); }}
              onDisconnect={async () => { await window.sitePopover.vpnDisconnect(); }}
            />
            {adBlockState && (
              <AdBlockSitePanel
                enabled={adBlockState.enabled}
                domain={domain}
                whitelisted={adblockOff}
                // ⚠️ Счётчик — за текущий сеанс браузера, так его и считает AdBlockManager.
                blockedCount={blocked ?? 0}
                onToggleEnabled={() => { void toggleAdBlockEnabled(); }}
                onToggleSite={() => { void toggleAdBlockSite(); }}
              />
            )}
          </div>
        </Section>

        {/* ── Разрешения ── */}
        {host && sitePerms.length > 0 && (
          <Section title="Разрешения">
            {sitePerms.map((p) => {
              const Icon = PERM_ICON[p.permission];
              return (
                <div key={p.permission} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px' }}>
                  <Icon size={15} style={{ color: 'var(--text-muted)', flex: 'none' }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
                    {PERM_LABEL[p.permission]}
                  </span>
                  <span style={{
                    fontSize: 'var(--fs-xs)', fontWeight: 600,
                    color: p.decision === 'granted' ? 'var(--dot-local)' : 'var(--danger-500)',
                  }}>
                    {p.decision === 'granted' ? 'разрешено' : 'запрещено'}
                  </span>
                  {/* «Забыть» ≠ «запретить»: забытый сайт спросит снова. Та же тройка состояний,
                      что в разделе настроек — здесь оставлен только сброс, остальное там. */}
                  <button
                    title="Забыть решение — сайт спросит снова"
                    onClick={() => { void window.sitePopover.revokePermission(p.origin, p.permission).then(reload); }}
                    style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 3, display: 'inline-flex', color: 'var(--text-faint)', flex: 'none' }}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              );
            })}
          </Section>
        )}

        {/* ── Что изменилось с прошлого раза ──
            ⚠️ Показываем ТОЛЬКО когда изменение действительно нашлось: молчание здесь — обычное
            состояние, и «ничего не изменилось» отдельной строкой было бы шумом на каждой странице.
            Фраза от модели необязательна: на холодной модели остаются сам факт и первый кусок,
            и они уже полезны. */}
        {changes?.changed && (
          <Section title="Изменилось с прошлого раза">
            <div style={{ padding: '4px 16px 8px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <History size={15} style={{ color: 'var(--text-muted)', flex: 'none', marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
                  {changes.summary ?? 'Страница изменилась'}
                </div>
                {/* Без фразы показываем первый кусок дословно — он со страницы, значит не выдуман. */}
                {!changes.summary && changes.pieces?.[0] && (
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
                    {changes.pieces[0].after || changes.pieces[0].before}
                  </div>
                )}
              </div>
            </div>
          </Section>
        )}

        {/* ⚠️ «Вы это уже читали» отсюда УБРАНО: та же подсказка есть в панели омнибокса, и держать
            её в двух местах незачем. Но в шапке SitePopoverManager.ts записано, ЗАЧЕМ её сюда
            когда-то переносили: в выпадашке она конкурировала за очередь к модели со смысловым
            поиском вкладок ровно в момент, когда человек начинал печатать. Конфликт этим удалением
            не решён — просто копия осталась там, где он и был. */}
      </div>
    </div>
  );
}

// Блок с разделителем сверху — тот же приём, что в карточках настроек.
function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--divider)', padding: '10px 0' }}>
      {title && (
        <div style={{
          fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
          textTransform: 'uppercase', color: 'var(--text-faint)', padding: '0 16px 6px',
        }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SitePopoverApp />
  </React.StrictMode>,
);
