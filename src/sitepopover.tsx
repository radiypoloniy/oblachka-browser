import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Lock, ShieldOff, ShieldCheck, Camera, Mic, MapPin, Bell, Maximize, Clipboard, BookOpen, RotateCcw, History } from 'lucide-react';
import type { PermissionRecord, PermKey, SemanticSearchResult, PageChangesResult } from '../shared/ipc';
import { islandPlate } from './styles/island';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';

declare global {
  interface Window {
    sitePopover: {
      getActiveTab: () => Promise<{ url: string; title: string } | null>;
      getPermissions: () => Promise<PermissionRecord[]>;
      revokePermission: (origin: string, key: PermKey) => Promise<void>;
      getBlockedCount: (domain: string) => Promise<number>;
      isAdblockAllowed: (domain: string) => Promise<boolean>;
      getRelatedPages: () => Promise<SemanticSearchResult[]>;
      getPageChanges: () => Promise<PageChangesResult>;
      openUrl: (url: string) => Promise<string>;
      close: () => void;
      reportHeight: (px: number) => void;
      onShow: (cb: () => void) => () => void;
    };
  }
}

// Держать в синхроне с SHADOW_MARGIN в electron/SitePopoverManager.ts.
const SHADOW_MARGIN = 16;
const CARD_WIDTH = 340;

// Те же подписи и значки, что в разделе настроек «Разрешения» — словарь один на два места,
// иначе одно и то же разрешение называлось бы по-разному в поповере и в настройках.
const PERM_LABEL: Record<PermKey, string> = {
  'camera': 'Камера',
  'microphone': 'Микрофон',
  'camera+microphone': 'Камера и микрофон',
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
  const [related, setRelated] = useState<SemanticSearchResult[] | null>(null);
  // «Что изменилось с прошлого раза» (AI-IDEAS.md №7). null — ещё считаем.
  const [changes, setChanges] = useState<PageChangesResult | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // ⚠️ Всё перечитывается НА КАЖДЫЙ ПОКАЗ: вью между открытиями живёт, а сведения относятся к
  // конкретной странице — за это время человек десять раз сменил вкладку.
  const reload = useCallback(async () => {
    setRelated(null);
    const tab = await window.sitePopover.getActiveTab();
    const tabUrl = tab?.url ?? '';
    setUrl(tabUrl);
    const host = hostOf(tabUrl);
    if (!host) { setPerms([]); setBlocked(null); return; }
    void window.sitePopover.getPermissions().then(setPerms);
    void window.sitePopover.getBlockedCount(host).then(setBlocked);
    void window.sitePopover.isAdblockAllowed(host).then(setAdblockOff);
    // Связанное из своей истории — единственное здесь, что считает модель. Приезжает отдельно и
    // позже остального: ждать её, не показывая карточку, нельзя (см. RelatedHistory.ts).
    void window.sitePopover.getRelatedPages().then(setRelated).catch(() => setRelated([]));
    void window.sitePopover.getPageChanges().then(setChanges).catch(() => setChanges({ changed: false }));
  }, []);

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

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={{
        width: CARD_WIDTH, ...islandPlate,
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

        {/* ── Блокировка ── */}
        {host && (
          <Section>
            <Row
              icon={<ShieldCheck size={15} style={{ color: adblockOff ? 'var(--text-faint)' : 'var(--dot-local)' }} />}
              title={adblockOff ? 'Реклама здесь не блокируется' : 'Заблокировано на этом сайте'}
              // ⚠️ Счётчик — за текущий сеанс браузера, так его и считает AdBlockManager.
              // Подписываем честно, иначе «0» после перезапуска читается как «не работает».
              subtitle={adblockOff ? 'Сайт добавлен в исключения' : `${blocked ?? 0} запросов за сеанс`}
            />
          </Section>
        )}

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

        {/* ── Вы это уже читали ── */}
        {related !== null && related.length > 0 && (
          <Section title="Вы это уже читали">
            {related.map((r) => (
              <button
                key={r.url}
                onClick={() => { void window.sitePopover.openUrl(r.url); window.sitePopover.close(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px',
                  border: 'none', background: 'transparent', cursor: 'default', textAlign: 'left', width: '100%',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <BookOpen size={15} style={{ color: 'var(--text-muted)', flex: 'none' }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.title || r.url}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hostOf(r.url)}
                  </span>
                </span>
              </button>
            ))}
          </Section>
        )}
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

function Row({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 16px' }}>
      <span style={{ display: 'inline-flex', flex: 'none' }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{subtitle}</span>
      </span>
    </div>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SitePopoverApp />
  </React.StrictMode>,
);
