import { useEffect, useRef, useState } from 'react';
import { X, Shield, ShieldOff, Wifi, Cpu, Palette, Plus, Trash2, RotateCcw, KeyRound, Check, Lock, Eye, EyeOff, Copy, Pencil, RefreshCw, Download, Upload, Search, type LucideIcon } from 'lucide-react';
import type { AdBlockState, BackfillProgress, HistoryContentCoverage, VpnStatus, VpnServerMeta, VpnConnectionState, PasswordMeta, PasswordCopyField, TranslationEngineId, BergamotStatus, Skill } from '../../shared/ipc';
import { islandPlate } from '../styles/island';
import { stripEmoji } from '../../shared/text';
import Toggle from './Toggle';
import ModelsSection from './ModelsSection';

interface SettingsProps {
  onClose: () => void;
  // Начальный раздел (напр. кнопка "+" в AI-панели открывает сразу на 'ai') — приходит из
  // TabState.section (shared/ipc.ts), который типизирован просто string (main-процесс не знает
  // SectionId), поэтому валидируем через isSectionId ниже, а не доверяем типу проп напрямую.
  defaultSection?: string;
}

// Секции левого меню — «Блокировка» и «AI» рабочие, VPN/Интерфейс — placeholder для будущих
// этапов. soon — единственный флаг, гоняющий и активность, и клик, и стиль (см. рендер-цикл
// ниже) — точечно снят только у 'ai', остальные пункты и их поведение не тронуты.
type NavItem = { id: string; label: string; Icon: LucideIcon; soon?: boolean };
const NAV_ITEMS: NavItem[] = [
  { id: 'adblock',    label: 'Блокировка', Icon: Shield },
  { id: 'vpn',        label: 'VPN',         Icon: Wifi },
  { id: 'ai',         label: 'AI',          Icon: Cpu },
  { id: 'passwords',  label: 'Пароли',      Icon: Lock },
  { id: 'appearance', label: 'Интерфейс',   Icon: Palette, soon: true },
];
type SectionId = 'adblock' | 'vpn' | 'ai' | 'passwords' | 'appearance';

function isSectionId(v: unknown): v is SectionId {
  return v === 'adblock' || v === 'vpn' || v === 'ai' || v === 'passwords' || v === 'appearance';
}

export default function Settings({ onClose, defaultSection }: SettingsProps) {
  const [section, setSection] = useState<SectionId>(isSectionId(defaultSection) ? defaultSection : 'adblock');
  const [state, setState] = useState<AdBlockState | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [inputError, setInputError] = useState('');
  // 'all' → перезагрузить все; string → перезагрузить только этот домен; null → нет pending
  const [pendingReload, setPendingReload] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Подписываемся на push-обновления из main (счётчик, whitelist, enabled)
  useEffect(() => {
    let mounted = true;
    window.oblako.getAdBlockState().then((s) => { if (mounted) setState(s); });
    const unsub = window.oblako.onAdBlockStateChanged((s) => { if (mounted) setState(s); });
    return () => { mounted = false; unsub(); };
  }, []);

  function handleToggle() {
    if (!state) return;
    void window.oblako.setAdBlockEnabled(!state.enabled);
    setPendingReload('all');
  }

  function handleAddDomain() {
    const raw = domainInput.trim();
    if (!raw) return;
    // Базовая проверка на что-то похожее на домен
    const cleaned = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]!;
    if (!cleaned || !cleaned.includes('.')) {
      setInputError('Введите домен, например: reddit.com');
      return;
    }
    setInputError('');
    void window.oblako.adBlockAddDomain(raw);
    setDomainInput('');
    setPendingReload(cleaned.toLowerCase());
    inputRef.current?.focus();
  }

  function handleRemoveDomain(domain: string) {
    void window.oblako.adBlockRemoveDomain(domain);
    setPendingReload(domain);
  }

  function handleReload() {
    if (pendingReload === null) return;
    void window.oblako.adBlockReloadTabs(pendingReload === 'all' ? undefined : pendingReload);
    setPendingReload(null);
  }

  return (
    <div className="settings-root" style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      overflow: 'hidden',
      // Тот же "остров", что у сайдбара (Sidebar.tsx::asideBase) — см. подробный комментарий
      // в History.tsx (тот же приём). Отступ по периметру не здесь — уже даёт contentRef margin
      // в App.tsx.
      ...islandPlate,
      borderRadius: 'var(--radius-island)',
      boxShadow: 'var(--shadow-island)',
      background: 'var(--surface-solid)',
    }}>
      {/* Шапка */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '18px 24px',
        borderBottom: '1px solid var(--divider-strong)', flex: 'none',
      }}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-strong)', flex: 1 }}>
          Настройки
        </span>
        <button
          onClick={onClose}
          style={{
            border: 'none', background: 'transparent', cursor: 'default', padding: 6,
            borderRadius: 'var(--radius-sm)', color: 'var(--text-faint)', display: 'inline-flex',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><X size={18} /></button>
      </div>

      {/* Тело: левое меню + контент */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Левая навигация */}
        <nav className="settings-nav" style={{
          width: 200, flex: 'none', borderRight: '1px solid var(--divider-strong)',
          padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {NAV_ITEMS.map(({ id, label, Icon, soon }) => {
            const active = section === id && !soon;
            return (
              <button
                key={id}
                className="settings-nav-item"
                disabled={!!soon}
                onClick={() => { if (!soon) setSection(id as SectionId); }}
                title={label}
                aria-label={label}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: 'none',
                  background: active ? 'var(--surface)' : 'transparent',
                  boxShadow: active ? 'var(--shadow-card)' : 'none',
                  color: soon ? 'var(--text-faint)' : active ? 'var(--text-strong)' : 'var(--text-body)',
                  cursor: soon ? 'default' : 'default',
                  fontWeight: active ? 600 : 400,
                  fontSize: 'var(--fs-sm)',
                  textAlign: 'left', width: '100%',
                  opacity: soon ? 0.45 : 1,
                }}
                onMouseEnter={(e) => { if (!active && !soon) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { if (!active && !soon) e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon size={15} />
                <span className="settings-nav-label">{label}</span>
                {soon && (
                  <span className="settings-nav-badge" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)', fontWeight: 400 }}>
                    скоро
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Контент выбранной секции */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
          {section === 'adblock' && (
            <AdBlockSection
              state={state}
              domainInput={domainInput}
              inputError={inputError}
              pendingReload={pendingReload}
              inputRef={inputRef}
              onToggle={handleToggle}
              onDomainChange={(v) => { setDomainInput(v); setInputError(''); }}
              onAddDomain={handleAddDomain}
              onRemoveDomain={handleRemoveDomain}
              onReload={handleReload}
              onDismissReload={() => setPendingReload(null)}
            />
          )}
          {section === 'vpn' && <VpnSection />}
          {section === 'ai' && <AiSection />}
          {section === 'passwords' && <PasswordsSection />}
        </div>
      </div>
    </div>
  );
}

// ── Секция «Блокировка рекламы» ───────────────────────────────────────────────

interface AdBlockSectionProps {
  state: AdBlockState | null;
  domainInput: string;
  inputError: string;
  pendingReload: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onToggle: () => void;
  onDomainChange: (v: string) => void;
  onAddDomain: () => void;
  onRemoveDomain: (domain: string) => void;
  onReload: () => void;
  onDismissReload: () => void;
}

function AdBlockSection({
  state, domainInput, inputError, pendingReload, inputRef,
  onToggle, onDomainChange, onAddDomain, onRemoveDomain, onReload, onDismissReload,
}: AdBlockSectionProps) {
  if (!state) {
    return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>
          Блокировка рекламы и трекеров
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Фильтрует рекламу и трекеры через EasyList / EasyPrivacy.
          Работает на уровне сетевых запросов — быстрее расширений браузера.
        </p>
      </div>

      {/* Уведомление о перезагрузке */}
      {pendingReload !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          ...islandPlate,
          borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-sm)',
        }}>
          <RotateCcw size={15} style={{ color: 'var(--warning-500)', flex: 'none' }} />
          <span style={{ flex: 1, color: 'var(--text-body)' }}>
            {pendingReload === 'all'
              ? 'Обновить открытые вкладки, чтобы применить изменения?'
              : `Обновить вкладки ${pendingReload}?`}
          </span>
          <button onClick={onReload} style={btnPrimary}>Обновить</button>
          <button onClick={onDismissReload} style={btnGhost}>Позже</button>
        </div>
      )}

      {/* Тумблер */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
        ...islandPlate,
        borderRadius: 'var(--radius-sm)',
      }}>
        {state.enabled
          ? <Shield size={22} style={{ color: 'var(--text-body)', flex: 'none' }} />
          : <ShieldOff size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
            {state.enabled ? 'Блокировка включена' : 'Блокировка выключена'}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
            Заблокировано за сессию: {state.sessionBlockCount.toLocaleString('ru')}
          </div>
        </div>
        <Toggle checked={state.enabled} onChange={onToggle} />
      </div>

      {/* Исключения */}
      <div>
        <div style={{
          fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
          textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8,
        }}>
          Исключения
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          На этих сайтах реклама блокироваться не будет.
          Домен покрывает и все поддомены (например, www.example.com).
        </p>

        {/* Список исключений */}
        {state.whitelist.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            {state.whitelist.map((domain) => (
              <div key={domain} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
              }}>
                <span style={{
                  flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-body)', fontFamily: 'monospace',
                  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {domain}
                </span>
                <button
                  onClick={() => onRemoveDomain(domain)}
                  title="Убрать из исключений"
                  style={{
                    border: 'none', background: 'transparent', cursor: 'default', padding: 4,
                    borderRadius: 4, display: 'inline-flex', color: 'var(--text-faint)', flex: 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; e.currentTarget.style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent'; }}
                ><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}

        {/* Добавить домен */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flexBasis: 200 }}>
            <input
              ref={inputRef}
              type="text"
              value={domainInput}
              placeholder="example.com"
              onChange={(e) => onDomainChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onAddDomain(); }}
              style={{
                padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                border: inputError ? '1.5px solid var(--error, #e05)' : '1.5px solid var(--divider-strong)',
                background: 'var(--surface)', color: 'var(--text-strong)',
                fontSize: 'var(--fs-sm)', outline: 'none',
                width: '100%', minWidth: 0, boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = inputError ? 'var(--error, #e05)' : 'var(--divider-strong)')}
            />
            {inputError && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #e05)' }}>{inputError}</span>
            )}
          </div>
          <button onClick={onAddDomain} style={{ ...btnPrimary, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Plus size={14} /> Добавить
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Секция «AI» — ключ Gemini для фактчека ────────────────────────────────────
// Шаг 2 захода D: UI + IPC-проводка. Хранение ключа на этом шаге — только в памяти main-процесса
// (см. AiKeyStore.ts) — persist через safeStorage добавляется отдельным коммитом (шаг 3), поэтому
// «подключено» здесь не переживёт перезапуск браузера ДО того коммита — это ожидаемо на этом шаге.
// VPN, шаг 2 — подписка/список серверов (шаг 1) + подключение процесса Xray (шаг 2). Ссылка
// подписки и credential каждого сервера никогда не покидают main — сюда приходит только
// редактированный список (VpnServerMeta) и статусы (VpnStatus/VpnConnectionState), тот же
// приём, что у PasswordMeta/AiKeyStore. ⚠️ "Подключиться" пока НЕ переключает трафик вкладок
// (session.setProxy — шаг 3, ещё не реализован) — только поднимает локальный процесс Xray.
function VpnSection() {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [servers, setServers] = useState<VpnServerMeta[]>([]);
  const [conn, setConn] = useState<VpnConnectionState | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const loadServers = () => { void window.oblako.listVpnServers().then(setServers); };

  useEffect(() => {
    let mounted = true;
    window.oblako.getVpnStatus().then((s) => { if (mounted) setStatus(s); });
    window.oblako.getVpnConnectionState().then((c) => { if (mounted) setConn(c); });
    loadServers();
    const unsubStatus = window.oblako.onVpnStatusChanged((s) => {
      if (!mounted) return;
      setStatus(s);
      loadServers();
    });
    const unsubConn = window.oblako.onVpnConnectionStateChanged((c) => { if (mounted) setConn(c); });
    return () => { mounted = false; unsubStatus(); unsubConn(); };
  }, []);

  async function handleConnect(serverId: string) {
    setConnectingId(serverId);
    await window.oblako.vpnConnect(serverId);
    setConnectingId(null);
  }

  async function handleDisconnect() {
    await window.oblako.vpnDisconnect();
  }

  async function handleSave() {
    const url = urlInput.trim();
    if (!url) { setError('Введите ссылку подписки'); return; }
    setSaving(true); setError(''); setInfo('');
    const res = await window.oblako.setVpnSubscription(url);
    setSaving(false);
    if (res.ok) {
      setUrlInput('');
      setInfo(`Загружено серверов: ${res.count}${res.skipped ? `, не распознано: ${res.skipped}` : ''}`);
    } else {
      setError(res.error ?? 'Не удалось сохранить');
    }
  }

  async function handleRefresh() {
    setRefreshing(true); setError(''); setInfo('');
    const res = await window.oblako.refreshVpnSubscription();
    setRefreshing(false);
    if (res.ok) setInfo(`Обновлено. Серверов: ${res.count}${res.skipped ? `, не распознано: ${res.skipped}` : ''}`);
    else setError(res.error ?? 'Не удалось обновить');
  }

  async function handleDelete() {
    await window.oblako.deleteVpnSubscription();
    setUrlInput(''); setError(''); setInfo('');
  }

  if (status === null) {
    return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>
          VPN
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Вставьте ссылку подписки от вашего VPN-сервиса (vless/trojan) — так же, как в Happ или
          Hiddify. Ссылка и серверы хранятся зашифрованными на этом устройстве, никуда, кроме
          вашего провайдера, не отправляются. Подключение пока экспериментальное: поднимает
          локальный туннель, но ещё не переключает на него трафик вкладок — это следующий шаг.
        </p>
      </div>

      {/* Статус */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
        ...islandPlate,
        borderRadius: 'var(--radius-sm)',
      }}>
        {status.hasSubscription
          ? <Check size={22} style={{ color: 'var(--success-500)', flex: 'none' }} />
          : <Wifi size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
            {status.hasSubscription ? `Подписка сохранена — серверов: ${status.serverCount}` : 'Подписка не добавлена'}
          </div>
          {status.fetchedAt && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
              Обновлено: {new Date(status.fetchedAt).toLocaleString('ru-RU')}
            </div>
          )}
        </div>
        {status.hasSubscription && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}
            >
              <RefreshCw size={14} /> {refreshing ? 'Обновление…' : 'Обновить'}
            </button>
            <button onClick={() => void handleDelete()} style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}>
              <Trash2 size={14} /> Удалить
            </button>
          </div>
        )}
      </div>

      {/* Ввод ссылки — доступен всегда (не только при первом добавлении): пользователь может
          захотеть сменить провайдера, новая ссылка просто перезапишет текущую подписку. */}
      <div>
        <div style={{
          fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
          textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8,
        }}>
          Ссылка подписки
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flexBasis: 200 }}>
            <input
              type="text"
              value={urlInput}
              placeholder="https://…/sub"
              onChange={(e) => { setUrlInput(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
              style={{
                padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                border: error ? '1.5px solid var(--error, #e05)' : '1.5px solid var(--divider-strong)',
                background: 'var(--surface)', color: 'var(--text-strong)',
                fontSize: 'var(--fs-sm)', outline: 'none', fontFamily: 'monospace',
                width: '100%', minWidth: 0, boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = error ? 'var(--error, #e05)' : 'var(--divider-strong)')}
            />
            {error && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #e05)' }}>{error}</span>}
            {!error && info && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{info}</span>}
          </div>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !urlInput.trim()}
            style={{ ...btnPrimary, alignSelf: 'flex-start', opacity: saving || !urlInput.trim() ? 0.6 : 1 }}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>

      {/* Список серверов — только чтение, без credential (см. VpnServerMeta). */}
      {servers.length > 0 && (
        <div>
          <div style={{
            fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
            textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8,
          }}>
            Серверы ({servers.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {servers.map((s) => {
              const isTarget = conn?.serverId === s.id;
              const isRunning = isTarget && conn?.state === 'running';
              const isStarting = (isTarget && conn?.state === 'starting') || connectingId === s.id;
              const isError = isTarget && conn?.state === 'error';
              return (
                <div key={s.id}>
                  <div
                    style={{
                      ...islandPlate, borderRadius: 'var(--radius-sm)', padding: '9px 14px',
                      display: 'flex', alignItems: 'center', gap: 10,
                      boxShadow: isRunning ? '0 0 0 1.5px var(--success-500) inset' : undefined,
                    }}
                  >
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
                      color: 'var(--text-faint)', flex: 'none', width: 44,
                    }}>
                      {s.protocol}
                    </span>
                    <span style={{
                      flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {stripEmoji(s.remark) || s.address}
                    </span>
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', fontFamily: 'monospace', flex: 'none' }}>
                      {s.address}:{s.port}
                    </span>
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flex: 'none' }}>
                      {s.transport}/{s.security}
                    </span>
                    {isRunning ? (
                      <button onClick={() => void handleDisconnect()} style={{ ...btnGhost, flex: 'none', padding: '5px 10px' }}>
                        Отключить
                      </button>
                    ) : isError ? (
                      // ⚠️ «Отключить» видна и здесь, не только при isRunning — иначе после
                      // неудачной попытки нет способа выйти из состояния error через UI вообще
                      // (см. живой аудит: kill switch блокирует ВЕСЬ трафик до переподключения,
                      // а без этой кнопки переподключиться — единственный доступный выход).
                      <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                        <button
                          onClick={() => void handleConnect(s.id)}
                          disabled={isStarting}
                          style={{ ...btnGhost, padding: '5px 10px', opacity: isStarting ? 0.6 : 1 }}
                        >
                          {isStarting ? 'Подключение…' : 'Повторить'}
                        </button>
                        <button onClick={() => void handleDisconnect()} style={{ ...btnGhost, padding: '5px 10px' }}>
                          Отключить
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => void handleConnect(s.id)}
                        disabled={isStarting}
                        style={{ ...btnGhost, flex: 'none', padding: '5px 10px', opacity: isStarting ? 0.6 : 1 }}
                      >
                        {isStarting ? 'Подключение…' : 'Подключить'}
                      </button>
                    )}
                  </div>
                  {isError && conn?.error && (
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #e05)', padding: '3px 14px 0' }}>
                      {conn.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AiSection() {
  const [connected, setConnected] = useState<boolean | null>(null); // null = ещё грузим статус
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let mounted = true;
    window.oblako.getAiKeyStatus().then((v) => { if (mounted) setConnected(v); });
    const unsub = window.oblako.onAiKeyStatusChanged((v) => { if (mounted) setConnected(v); });
    return () => { mounted = false; unsub(); };
  }, []);

  async function handleSave() {
    const key = keyInput.trim();
    if (!key) { setSaveError('Введите ключ'); return; }
    setSaving(true);
    setSaveError('');
    const ok = await window.oblako.saveAiKey(key);
    setSaving(false);
    if (ok) setKeyInput(''); else setSaveError('Не удалось сохранить ключ');
  }

  async function handleDelete() {
    await window.oblako.deleteAiKey();
  }

  if (connected === null) {
    return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>
          AI — фактчек
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Ключ Gemini нужен для фактчека в AI-панели — проверки утверждений страницы по реальным
          источникам в интернете. Хранится зашифрованным, не в виде обычного текста.
        </p>
      </div>

      {/* Статус */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
        ...islandPlate,
        borderRadius: 'var(--radius-sm)',
      }}>
        {connected
          ? <Check size={22} style={{ color: 'var(--success-500)', flex: 'none' }} />
          : <KeyRound size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
            {connected ? 'Подключено' : 'Не подключено'}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
            {connected
              ? 'Ключ Gemini сохранён — кнопка фактчека доступна в AI-панели.'
              : 'Добавьте ключ, чтобы включить фактчек в AI-панели.'}
          </div>
        </div>
        {connected && (
          <button onClick={() => void handleDelete()} style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Trash2 size={14} /> Удалить
          </button>
        )}
      </div>

      {/* Ввод ключа — только пока не подключено; чтобы сменить ключ, сначала «Удалить». */}
      {!connected && (
        <div>
          <div style={{
            fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
            textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8,
          }}>
            Gemini API-ключ
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flexBasis: 200 }}>
              <input
                type="password"
                value={keyInput}
                placeholder="AIza…"
                onChange={(e) => { setKeyInput(e.target.value); setSaveError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
                style={{
                  padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                  border: saveError ? '1.5px solid var(--error, #e05)' : '1.5px solid var(--divider-strong)',
                  background: 'var(--surface)', color: 'var(--text-strong)',
                  fontSize: 'var(--fs-sm)', outline: 'none', fontFamily: 'monospace',
                  width: '100%', minWidth: 0, boxSizing: 'border-box',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = saveError ? 'var(--error, #e05)' : 'var(--divider-strong)')}
              />
              {saveError && (
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #e05)' }}>{saveError}</span>
              )}
            </div>
            <button
              onClick={() => void handleSave()}
              disabled={saving || !keyInput.trim()}
              style={{ ...btnPrimary, alignSelf: 'flex-start', opacity: saving || !keyInput.trim() ? 0.6 : 1 }}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </div>
      )}

      <ModelsSection />
      <SearxngSection />
      <TranslationEngineSection />
      <HistoryBackfillSection />
      <SkillsSection />
    </div>
  );
}

// ── SearXNG (задел под web-grounding в AI-панели) — тот же паттерн формы, что AiSection выше,
// два поля вместо одного (endpoint + токен, оба через один saveSearxngConfig). Токен опционален —
// не у каждого self-hosted SearXNG есть auth (см. SearxngKeyStore.ts::saveConfig).
function SearxngSection() {
  const [configured, setConfigured] = useState<boolean | null>(null); // null = ещё грузим статус
  const [endpointInput, setEndpointInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let mounted = true;
    window.oblako.getSearxngStatus().then((v) => { if (mounted) setConfigured(v); });
    const unsub = window.oblako.onSearxngStatusChanged((v) => { if (mounted) setConfigured(v); });
    return () => { mounted = false; unsub(); };
  }, []);

  async function handleSave() {
    const endpoint = endpointInput.trim();
    if (!endpoint) { setSaveError('Введите адрес сервера'); return; }
    setSaving(true);
    setSaveError('');
    const ok = await window.oblako.saveSearxngConfig({ endpoint, token: tokenInput.trim() });
    setSaving(false);
    if (ok) { setEndpointInput(''); setTokenInput(''); } else setSaveError('Не удалось сохранить конфиг');
  }

  async function handleDelete() {
    await window.oblako.deleteSearxngConfig();
  }

  if (configured === null) {
    return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>
          SearXNG — веб-поиск для AI
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Свой поисковый сервер для web-grounding в AI-панели. Адрес и токен хранятся зашифрованными,
          не в виде обычного текста.
        </p>
      </div>

      {/* Статус */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
        ...islandPlate,
        borderRadius: 'var(--radius-sm)',
      }}>
        {configured
          ? <Check size={22} style={{ color: 'var(--success-500)', flex: 'none' }} />
          : <Search size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
            {configured ? 'Настроено' : 'Не настроено'}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
            {configured
              ? 'SearXNG подключён — веб-поиск доступен в AI-панели.'
              : 'Добавьте адрес сервера, чтобы включить веб-поиск в AI-панели.'}
          </div>
        </div>
        {configured && (
          <button onClick={() => void handleDelete()} style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Trash2 size={14} /> Удалить
          </button>
        )}
      </div>

      {/* Ввод — только пока не настроено; чтобы сменить, сначала «Удалить» (тот же приём, что у Gemini). */}
      {!configured && (
        <div>
          <div style={{
            fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
            textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8,
          }}>
            Адрес сервера и токен
          </div>
          {/* Формат поля токена — «логин:пароль» (HTTP Basic), не API-ключ/Bearer: self-hosted
              SearXNG почти всегда закрывают auth_basic на уровне reverse-proxy, не на своём уровне
              (см. SearxngSearch.ts::searxngSearch). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="text"
              value={endpointInput}
              placeholder="https://searx.example.com"
              onChange={(e) => { setEndpointInput(e.target.value); setSaveError(''); }}
              style={{
                padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                border: saveError ? '1.5px solid var(--error, #e05)' : '1.5px solid var(--divider-strong)',
                background: 'var(--surface)', color: 'var(--text-strong)',
                fontSize: 'var(--fs-sm)', outline: 'none', fontFamily: 'monospace',
                width: '100%', minWidth: 0, boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = saveError ? 'var(--error, #e05)' : 'var(--divider-strong)')}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="password"
                value={tokenInput}
                placeholder="Логин:Пароль (опционально)"
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
                style={{
                  flex: 1, flexBasis: 200, padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                  border: '1.5px solid var(--divider-strong)',
                  background: 'var(--surface)', color: 'var(--text-strong)',
                  fontSize: 'var(--fs-sm)', outline: 'none', fontFamily: 'monospace',
                  minWidth: 0, boxSizing: 'border-box',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
              />
              <button
                onClick={() => void handleSave()}
                disabled={saving || !endpointInput.trim()}
                style={{ ...btnPrimary, alignSelf: 'flex-start', opacity: saving || !endpointInput.trim() ? 0.6 : 1 }}
              >
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
            {saveError && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #e05)' }}>{saveError}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Движок полностраничного перевода (Qwen / Bergamot) ────────────────────────
// Bergamot греется в фоне на старте main.ts независимо от того, что сейчас выбрано (см.
// main.ts::warmupBergamot) — статус может прийти push'ем ДО монтирования этой секции ИЛИ уже
// быть готовым к моменту get (та же пара get+onChanged, что у PageTranslateState — гонка старта).
function TranslationEngineSection() {
  const [engine, setEngineState] = useState<TranslationEngineId | null>(null);
  const [bergamotStatus, setBergamotStatus] = useState<BergamotStatus | null>(null);
  // Разовая проверка на монтировании — есть ли хоть одна установленная модель для AI-перевода
  // (Qwen-обёртка работает на дефолтной модели реестра, см. ModelsSection.tsx). Без модели выбор
  // этого движка даёт молчаливый отказ при переводе — бейдж должен предупредить заранее.
  const [hasInstalledModel, setHasInstalledModel] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    window.oblako.getTranslationEngine().then((v) => { if (mounted) setEngineState(v); });
    window.oblako.getBergamotStatus().then((v) => { if (mounted) setBergamotStatus(v); });
    const unsub = window.oblako.onBergamotStatusChanged((v) => { if (mounted) setBergamotStatus(v); });
    window.oblako.getInstalledModels().then((list) => { if (mounted) setHasInstalledModel(list.length > 0); });
    return () => { mounted = false; unsub(); };
  }, []);

  function select(id: TranslationEngineId) {
    setEngineState(id); // оптимистично — setTranslationEngine не бросает и не гоняет туда-обратно
    void window.oblako.setTranslationEngine(id);
  }

  const bergamotDisabled = bergamotStatus !== 'ready';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      paddingTop: 20, marginTop: 4, borderTop: '1px solid var(--divider)',
    }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          Движок перевода страниц
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          Кнопка «Перевести страницу» в тулбаре может работать на одном из двух локальных движков.
          Оба считают полностью на устройстве, ничего не уходит в сеть.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <EngineOption
          active={engine === 'qwen'}
          onClick={() => select('qwen')}
          title="AI-перевод (медленно, выше качество)"
          subtitle="Qwen — универсальная модель, переводит любой язык, медленнее на CPU/GPU."
          badge={
            hasInstalledModel === null
              ? undefined
              : hasInstalledModel
                ? { text: 'готов', color: 'var(--success-500)' }
                : { text: 'нет модели', color: 'var(--warning-500)' }
          }
        />
        <EngineOption
          active={engine === 'bergamot'}
          disabled={bergamotDisabled}
          onClick={() => { if (!bergamotDisabled) select('bergamot'); }}
          title="Bergamot (быстрее, легче)"
          subtitle={
            bergamotStatus === 'loading' || bergamotStatus === null
              ? 'Проверяю модель перевода…'
              : bergamotStatus === 'unavailable'
                ? 'Модель перевода не загружена — см. README (Bergamot).'
                : 'Специализированная модель для CPU — en/ru и ещё несколько языков.'
          }
          badge={
            bergamotStatus === 'unavailable'
              ? { text: 'недоступен', color: 'var(--text-faint)' }
              : bergamotStatus === 'ready'
                ? { text: 'готов', color: 'var(--success-500)' }
                : undefined
          }
        />
      </div>
    </div>
  );
}

interface EngineOptionProps {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  badge?: { text: string; color: string };
  // Второй независимый бейдж (напр. «в памяти» рядом с «активна» у моделей, ModelsSection.tsx) —
  // не форкаем компонент ради второй метки, см. CLAUDE.md про переиспользование готовых компонентов.
  badge2?: { text: string; color: string };
}

export function EngineOption({ active, disabled, onClick, title, subtitle, badge, badge2 }: EngineOptionProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        ...islandPlate, borderRadius: 'var(--radius-sm)', textAlign: 'left',
        border: 'none', cursor: disabled ? 'default' : 'default',
        boxShadow: active ? '0 0 0 1.5px var(--accent) inset' : undefined,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {active
        ? <Check size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
        : <span style={{ width: 18, flex: 'none' }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          {title}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
          {subtitle}
        </div>
      </div>
      {(badge || badge2) && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: 'none' }}>
          {badge && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
              color: badge.color,
            }}>
              {badge.text}
            </span>
          )}
          {badge2 && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
              color: badge2.color,
            }}>
              {badge2.text}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// ── Индекс полнотекстового поиска по истории ───────────────────────────────────
// Индексация текста идёт сама при обычном посещении/повторном визите — здесь только счётчик
// охвата и (ниже) отдельная секция ручного бэкфилла старых страниц. Разовый эмбеддинг-бэкфилл
// (кнопка «Индексировать историю» по заголовку+домену) убран вместе с эмбеддингами — счётчик
// ниже всегда считает страницы с реально сохранённым текстом, эмбеддинги в этом счёте
// никогда не участвовали.
function HistoryBackfillSection() {
  const [coverage, setCoverage] = useState<HistoryContentCoverage | null>(null);

  const loadCoverage = () => { void window.oblako.getHistoryContentCoverage().then(setCoverage); };

  useEffect(() => {
    loadCoverage();
  }, []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      paddingTop: 20, marginTop: 4, borderTop: '1px solid var(--divider)',
    }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          Индексация истории для поиска
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          Полный текст страницы для умного поиска появляется сам при обычном посещении/повторном
          визите — счётчик ниже показывает, сколько страниц уже имеют полный текст. Всё считается
          локально на устройстве.
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)' }}>
          {coverage
            ? `Полный текст: ${coverage.withContent} из ${coverage.total} страниц`
            : 'Полный текст: считаю…'}
        </span>
        <button
          onClick={loadCoverage}
          title="Обновить счётчик"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 2,
            color: 'var(--text-muted)', display: 'flex', borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <HistoryContentBackfillSection onDone={loadCoverage} />
    </div>
  );
}

// ── Рискованный бэкфилл полного текста: тихое переоткрытие старых URL (electron/
// HistoryContentBackfill.ts) ─────────────────────────────────────────────────────────────────
// Отдельная секция, не совмещена с лёгким бэкфиллом выше — это принципиально другой по
// стоимости и риску процесс (реальные загрузки страниц, не только текстовый embed-вызов).
// onDone — обновить счётчик охвата в родительской секции после завершения/остановки.
function HistoryContentBackfillSection({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState<BackfillProgress | null>(null);

  useEffect(() => {
    let mounted = true;
    window.oblako.getHistoryContentBackfillStatus().then((p) => { if (mounted) setProgress(p); });
    const unsub = window.oblako.onHistoryContentBackfillProgress((p) => {
      if (!mounted) return;
      setProgress(p);
      if (!p.running) onDone();
    });
    return () => { mounted = false; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = progress?.running ?? false;
  const processed = progress?.processed ?? 0;
  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      paddingTop: 20, marginTop: 4, borderTop: '1px solid var(--divider)',
    }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          Полная индексация истории (эксперимент)
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--danger-500)' }}>
          Тихо переоткрывает старые страницы из истории в фоне (невидимо для вас), чтобы забрать
          их текст для умного поиска. Это значит реальные сетевые запросы к этим сайтам — часть
          страниц может показать капчу, разлогинить или уже не существовать (такие просто
          пропускаются). Может занять долго на большой истории. Можно остановить в любой момент.
        </p>
      </div>

      {running ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)' }}>
            Обработано {processed} из {total}…
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-hover)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`, background: 'var(--accent)',
              transition: 'width 0.2s ease-out',
            }} />
          </div>
          <button
            onClick={() => window.oblako.cancelHistoryContentBackfill()}
            style={{ ...btnGhost, alignSelf: 'flex-start' }}
          >
            Остановить
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => window.oblako.startHistoryContentBackfill()} style={btnGhost}>
            Проиндексировать полный текст
          </button>
          {progress && total > 0 && !running && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
              {progress.cancelled ? `Остановлено: ${processed} из ${total}` : `Готово: ${processed} из ${total}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Секция «Скиллы» — CRUD-редактор prompt-кнопок AI-панели (см. electron/SkillsStore.ts,
// мост в window.oblako.{list,add,update,remove}Skill/onSkillsChanged уже проложен отдельным
// коммитом). Один источник правды — push из main: после add/update/remove локальный skills НЕ
// правится вручную, список перерисуется сам через onSkillsChanged (тот же снапшот уходит и в
// AI-панель её собственным ai-panel:skills-list, независимо от этого моста).
function SkillsSection() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [promptInput, setPromptInput] = useState('');
  const [iconInput, setIconInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let mounted = true;
    window.oblako.listSkills().then((list) => { if (mounted) setSkills(list); });
    const unsub = window.oblako.onSkillsChanged((list) => { if (mounted) setSkills(list); });
    return () => { mounted = false; unsub(); };
  }, []);

  function openAddForm() {
    setEditingId(null);
    setLabelInput(''); setPromptInput(''); setIconInput('');
    setFormError(''); setFormOpen(true);
  }

  function openEditForm(skill: Skill) {
    setEditingId(skill.id);
    setLabelInput(skill.label); setPromptInput(skill.prompt); setIconInput(skill.icon ?? '');
    setFormError(''); setFormOpen(true);
  }

  async function handleSave() {
    const label = labelInput.trim();
    const prompt = promptInput.trim();
    // Кнопка и так disabled на пустых полях (canSave ниже) — эта проверка страхует от гонки
    // (напр. Enter до ре-рендера disabled), не дублирует UI-гейт зря.
    if (!label || !prompt) return;
    // Пустой icon → undefined, не '' — валидатор стора принимает оба, но не плодим пустые
    // строки в данных (см. SkillsStore.ts::isValidSkill).
    const icon = iconInput.trim() || undefined;
    setSaving(true);
    setFormError('');
    const ok = editingId === null
      ? await window.oblako.addSkill({ label, prompt, icon })
      : await window.oblako.updateSkill(editingId, { label, prompt, icon });
    setSaving(false);
    if (ok) setFormOpen(false); else setFormError('Не удалось сохранить');
  }

  async function handleDelete(id: string) {
    const ok = await window.oblako.removeSkill(id);
    if (ok) setFormOpen(false);
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      paddingTop: 20, marginTop: 4, borderTop: '1px solid var(--divider)',
    }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          Скиллы
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          Кнопки-сценарии над полем ввода в AI-панели (Объяснить, Сделать саммари и ваши свои) —
          каждая отправляет свой промпт про текущую страницу.
        </p>
      </div>

      {!formOpen && (
        <button onClick={openAddForm} style={{ ...btnPrimary, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Plus size={14} /> Новый скилл
        </button>
      )}

      {formOpen && (
        <SkillForm
          key={editingId ?? 'new'}
          iconInput={iconInput} onIconChange={setIconInput}
          labelInput={labelInput} onLabelChange={setLabelInput}
          promptInput={promptInput} onPromptChange={setPromptInput}
          formError={formError} saving={saving}
          canSave={labelInput.trim().length > 0 && promptInput.trim().length > 0}
          onSave={() => void handleSave()}
          onCancel={() => setFormOpen(false)}
          showDelete={editingId !== null && !skills.find((s) => s.id === editingId)?.builtin}
          onDelete={() => { if (editingId !== null) void handleDelete(editingId); }}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {skills.map((skill) => (
          <SkillRow
            key={skill.id}
            skill={skill}
            onToggleVisible={() => void window.oblako.updateSkill(skill.id, { visible: !skill.visible })}
            onEdit={() => openEditForm(skill)}
          />
        ))}
      </div>
    </div>
  );
}

interface SkillRowProps {
  skill: Skill;
  onToggleVisible: () => void;
  onEdit: () => void;
}

function SkillRow({ skill, onToggleVisible, onEdit }: SkillRowProps) {
  const preview = skill.prompt.length > 80 ? `${skill.prompt.slice(0, 80)}…` : skill.prompt;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
    }}>
      {skill.icon && (
        <div style={{ flex: 'none', fontSize: 'var(--fs-md)', lineHeight: 1 }}>{skill.icon}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {skill.label}
        </div>
        <div style={{
          fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {preview}
        </div>
      </div>
      {/* Видимость на панели — независима от builtin, доступна для ЛЮБОГО скилла (это и есть
          способ спрятать встроенный, не удаляя — remove() для builtin всё равно вернёт false). */}
      <div title={skill.visible ? 'Показывается в AI-панели' : 'Скрыта из AI-панели'} style={{ flex: 'none' }}>
        <Toggle checked={skill.visible} onChange={onToggleVisible} />
      </div>
      <IconBtn title="Редактировать" onClick={onEdit}><Pencil size={14} /></IconBtn>
    </div>
  );
}

interface SkillFormProps {
  iconInput: string; onIconChange: (v: string) => void;
  labelInput: string; onLabelChange: (v: string) => void;
  promptInput: string; onPromptChange: (v: string) => void;
  formError: string; saving: boolean; canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
  showDelete: boolean;
  onDelete: () => void;
}

function SkillForm({
  iconInput, onIconChange, labelInput, onLabelChange, promptInput, onPromptChange,
  formError, saving, canSave, onSave, onCancel, showDelete, onDelete,
}: SkillFormProps) {
  // Подтверждение живёт локально в форме (не в SkillsSection) — компонент ремонтится при смене
  // editingId (см. key={editingId} у вызывающего), так что confirm сам сбрасывается.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputStyle: React.CSSProperties = {
    padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--divider-strong)',
    background: 'var(--surface)', color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', outline: 'none',
    width: '100%', minWidth: 0, boxSizing: 'border-box',
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', marginBottom: 10,
      ...islandPlate, borderRadius: 'var(--radius-sm)',
    }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {/* Без maxLength=1 — составной эмодзи (семья, флаг, ZWJ-последовательность) занимает
            несколько кодовых точек, обрезка по length искалечила бы его. Юзер вставляет из
            системного эмодзи-пикера ОС, это не текстовый ввод произвольной длины. */}
        <input
          type="text" placeholder="🙂" value={iconInput} maxLength={8}
          onChange={(e) => onIconChange(e.target.value)}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
          style={{ ...inputStyle, width: 56, flex: 'none', textAlign: 'center' }}
        />
        <input
          type="text" placeholder="Название кнопки" value={labelInput}
          onChange={(e) => onLabelChange(e.target.value)}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
          style={{ ...inputStyle, flex: 1, flexBasis: 200 }}
        />
      </div>
      <textarea
        placeholder="Промпт — что отправить модели про текущую страницу" value={promptInput} rows={3}
        onChange={(e) => onPromptChange(e.target.value)}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />

      {formError && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #e05)' }}>{formError}</span>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={onSave} disabled={saving || !canSave} style={{ ...btnPrimary, opacity: saving || !canSave ? 0.6 : 1 }}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        {showDelete && (
          confirmDelete ? (
            <>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>Удалить скилл?</span>
              <button onClick={onDelete} style={{ ...btnGhost, color: 'var(--error, #e05)' }}>Да</button>
              <button onClick={() => setConfirmDelete(false)} style={btnGhost}>Нет</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={{ ...btnGhost, color: 'var(--error, #e05)' }}>
              Удалить
            </button>
          )
        )}
        <button onClick={onCancel} style={btnGhost}>Отмена</button>
      </div>
    </div>
  );
}

// ── Секция «Пароли» — сейф на этом устройстве (менеджер паролей, шаг 1) ───────
// Только хранилище/CRUD/генератор/экспорт-импорт на этом шаге — автозаполнение в веб-формы
// (шаг 2) и внешние коннекторы (Bitwarden и т.п.) сюда не входят, ниже только disabled-заглушка
// подраздела под них. Пароль пересекает IPC только по явному действию (reveal/copy/generate) —
// listPasswords секретов не возвращает (см. shared/ipc.ts::OblakoApi).
function PasswordsSection() {
  const [entries, setEntries] = useState<PasswordMeta[] | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [genLength, setGenLength] = useState(16);
  const [genLower, setGenLower] = useState(true);
  const [genUpper, setGenUpper] = useState(true);
  const [genDigits, setGenDigits] = useState(true);
  const [genSymbols, setGenSymbols] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importPassphrase, setImportPassphrase] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  function refresh() {
    window.oblako.listPasswords().then(setEntries);
  }

  useEffect(() => {
    let mounted = true;
    window.oblako.listPasswords().then((list) => { if (mounted) setEntries(list); });
    const unsub = window.oblako.onPasswordsChanged(() => {
      window.oblako.listPasswords().then((list) => { if (mounted) setEntries(list); });
    });
    return () => { mounted = false; unsub(); };
  }, []);

  function openAddForm() {
    setEditingId(null);
    setUrlInput(''); setUsernameInput(''); setPasswordInput(''); setNotesInput('');
    setFormError(''); setGeneratorOpen(false); setFormOpen(true);
  }

  function openEditForm(entry: PasswordMeta) {
    setEditingId(entry.id);
    setUrlInput(entry.url); setUsernameInput(entry.username);
    // Пароль не подгружаем автоматически при открытии формы — не тянем secret без явного
    // reveal-действия пользователя. Пустое поле здесь значит «не менять».
    setPasswordInput(''); setNotesInput('');
    setFormError(''); setGeneratorOpen(false); setFormOpen(true);
  }

  async function handleSave() {
    const rawUrl = urlInput.trim();
    const username = usernameInput.trim();
    if (!rawUrl) { setFormError('Введите адрес сайта'); return; }
    if (editingId === null && !passwordInput) { setFormError('Введите пароль'); return; }

    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let title = rawUrl;
    try { title = new URL(normalizedUrl).hostname; } catch { /* оставляем исходную строку */ }

    setSaving(true);
    setFormError('');
    const ok = editingId === null
      ? await window.oblako.addPassword({
          url: normalizedUrl, username, password: passwordInput, title,
          notes: notesInput.trim() || undefined,
        })
      : await window.oblako.updatePassword({
          id: editingId, url: normalizedUrl, username, title,
          password: passwordInput || undefined,
          notes: notesInput.trim() || undefined,
        });
    setSaving(false);
    if (ok) { setFormOpen(false); refresh(); } else { setFormError('Не удалось сохранить'); }
  }

  async function handleDelete(id: number) {
    await window.oblako.deletePassword(id);
    setRevealed((r) => { if (!(id in r)) return r; const next = { ...r }; delete next[id]; return next; });
  }

  async function handleReveal(id: number) {
    if (id in revealed) {
      setRevealed((r) => { const next = { ...r }; delete next[id]; return next; });
      return;
    }
    const value = await window.oblako.revealPassword(id);
    if (value !== null) setRevealed((r) => ({ ...r, [id]: value }));
  }

  async function handleCopy(id: number, field: PasswordCopyField) {
    const ok = await window.oblako.copyPasswordField(id, field);
    if (!ok) return;
    const key = `${id}:${field}`;
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  }

  async function handleGenerate() {
    const value = await window.oblako.generatePassword({
      length: genLength, lower: genLower, upper: genUpper, digits: genDigits, symbols: genSymbols,
    });
    setPasswordInput(value);
  }

  async function handleExport() {
    if (!exportPassphrase.trim()) { setExportMsg('Введите парольную фразу'); return; }
    setExportBusy(true); setExportMsg('');
    const ok = await window.oblako.exportPasswords(exportPassphrase);
    setExportBusy(false);
    setExportMsg(ok ? 'Экспортировано.' : 'Отменено или не удалось сохранить.');
    if (ok) setExportPassphrase('');
  }

  async function handleImport() {
    if (!importPassphrase.trim()) { setImportMsg('Введите парольную фразу'); return; }
    setImportBusy(true); setImportMsg('');
    const count = await window.oblako.importPasswords(importPassphrase);
    setImportBusy(false);
    setImportMsg(count > 0
      ? `Импортировано записей: ${count}.`
      : 'Не удалось импортировать — неверная фраза, файл не выбран или повреждён.');
    if (count > 0) { setImportPassphrase(''); refresh(); }
  }

  if (entries === null) {
    return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>
          Пароли
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Зашифрованный сейф на этом устройстве — записи защищены ключом, привязанным к вашей
          учётной записи Windows. Автозаполнение в веб-формы появится отдельным шагом.
        </p>
      </div>

      {/* Список сохранённых записей */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
            textTransform: 'uppercase', color: 'var(--text-faint)', flex: 1,
            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            Сохранённые пароли
          </div>
          {!formOpen && (
            <button onClick={openAddForm} style={{ ...btnPrimary, display: 'flex', gap: 6, alignItems: 'center' }}>
              <Plus size={14} /> Добавить
            </button>
          )}
        </div>

        {formOpen && (
          <PasswordForm
            editing={editingId !== null}
            urlInput={urlInput} onUrlChange={setUrlInput}
            usernameInput={usernameInput} onUsernameChange={setUsernameInput}
            passwordInput={passwordInput} onPasswordChange={setPasswordInput}
            notesInput={notesInput} onNotesChange={setNotesInput}
            formError={formError} saving={saving}
            generatorOpen={generatorOpen} onToggleGenerator={() => setGeneratorOpen((v) => !v)}
            genLength={genLength} onGenLength={setGenLength}
            genLower={genLower} onGenLower={setGenLower}
            genUpper={genUpper} onGenUpper={setGenUpper}
            genDigits={genDigits} onGenDigits={setGenDigits}
            genSymbols={genSymbols} onGenSymbols={setGenSymbols}
            onGenerate={() => void handleGenerate()}
            onSave={() => void handleSave()}
            onCancel={() => setFormOpen(false)}
          />
        )}

        {entries.length === 0 && !formOpen && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', padding: '8px 4px' }}>
            Записей пока нет.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map((entry) => (
            <PasswordRow
              key={entry.id}
              entry={entry}
              revealedValue={revealed[entry.id]}
              copiedKey={copiedKey}
              onToggleReveal={() => void handleReveal(entry.id)}
              onCopy={(field) => void handleCopy(entry.id, field)}
              onEdit={() => openEditForm(entry)}
              onDelete={() => void handleDelete(entry.id)}
            />
          ))}
        </div>
      </div>

      {/* Экспорт / импорт */}
      <div style={{ paddingTop: 20, borderTop: '1px solid var(--divider)' }}>
        <div style={{
          fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
          textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8,
        }}>
          Экспорт и импорт
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Ключ сейфа привязан к этому Windows-профилю и не переживёт переустановку — сохраните
          зашифрованную копию отдельной парольной фразой, чтобы не потерять пароли.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button
            onClick={() => { setExportOpen((v) => !v); setImportOpen(false); setExportMsg(''); }}
            style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}
          ><Download size={14} /> Экспорт</button>
          <button
            onClick={() => { setImportOpen((v) => !v); setExportOpen(false); setImportMsg(''); }}
            style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}
          ><Upload size={14} /> Импорт</button>
        </div>

        {exportOpen && (
          <PassphrasePrompt
            label="Парольная фраза для экспорта"
            value={exportPassphrase} onChange={setExportPassphrase}
            busy={exportBusy} msg={exportMsg}
            actionLabel="Сохранить файл"
            onConfirm={() => void handleExport()}
          />
        )}
        {importOpen && (
          <PassphrasePrompt
            label="Парольная фраза для импорта"
            value={importPassphrase} onChange={setImportPassphrase}
            busy={importBusy} msg={importMsg}
            actionLabel="Выбрать файл"
            onConfirm={() => void handleImport()}
          />
        )}
      </div>

      {/* Внешние коннекторы — плейсхолдер, коннекторов пока нет */}
      <div style={{
        paddingTop: 20, borderTop: '1px solid var(--divider)', opacity: 0.45,
      }}>
        <div style={{
          fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
          textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8,
        }}>
          Подключить внешний менеджер
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          ...islandPlate, borderRadius: 'var(--radius-sm)',
        }}>
          <Lock size={18} style={{ color: 'var(--text-faint)', flex: 'none' }} />
          <span style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
            Bitwarden и другие менеджеры
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600 }}>скоро</span>
        </div>
      </div>
    </div>
  );
}

// ── Строка одной записи (список секции «Пароли») ──────────────────────────────

interface PasswordRowProps {
  entry: PasswordMeta;
  revealedValue: string | undefined;
  copiedKey: string | null;
  onToggleReveal: () => void;
  onCopy: (field: PasswordCopyField) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function PasswordRow({ entry, revealedValue, copiedKey, onToggleReveal, onCopy, onEdit, onDelete }: PasswordRowProps) {
  const revealed = revealedValue !== undefined;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.title || entry.origin}
        </div>
        <div style={{
          fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace',
        }}>
          {entry.username || '—'}{revealed ? `  ·  ${revealedValue}` : ''}
        </div>
      </div>
      <IconBtn title="Копировать логин" active={copiedKey === `${entry.id}:username`} onClick={() => onCopy('username')}>
        {copiedKey === `${entry.id}:username` ? <Check size={14} /> : <Copy size={14} />}
      </IconBtn>
      <IconBtn title="Копировать пароль" active={copiedKey === `${entry.id}:password`} onClick={() => onCopy('password')}>
        {copiedKey === `${entry.id}:password` ? <Check size={14} /> : <Copy size={14} />}
      </IconBtn>
      <IconBtn title={revealed ? 'Скрыть пароль' : 'Показать пароль'} onClick={onToggleReveal}>
        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
      </IconBtn>
      <IconBtn title="Изменить" onClick={onEdit}><Pencil size={14} /></IconBtn>
      <IconBtn title="Удалить" onClick={onDelete}><Trash2 size={14} /></IconBtn>
    </div>
  );
}

function IconBtn({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        border: 'none', background: 'transparent', cursor: 'default', padding: 6,
        borderRadius: 6, display: 'inline-flex', flex: 'none',
        color: active ? 'var(--success-500)' : 'var(--text-faint)',
      }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = 'var(--text-body)'; e.currentTarget.style.background = 'var(--surface-hover)'; } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent'; } }}
    >{children}</button>
  );
}

// ── Форма добавления/редактирования записи ─────────────────────────────────────

interface PasswordFormProps {
  editing: boolean;
  urlInput: string; onUrlChange: (v: string) => void;
  usernameInput: string; onUsernameChange: (v: string) => void;
  passwordInput: string; onPasswordChange: (v: string) => void;
  notesInput: string; onNotesChange: (v: string) => void;
  formError: string; saving: boolean;
  generatorOpen: boolean; onToggleGenerator: () => void;
  genLength: number; onGenLength: (v: number) => void;
  genLower: boolean; onGenLower: (v: boolean) => void;
  genUpper: boolean; onGenUpper: (v: boolean) => void;
  genDigits: boolean; onGenDigits: (v: boolean) => void;
  genSymbols: boolean; onGenSymbols: (v: boolean) => void;
  onGenerate: () => void;
  onSave: () => void;
  onCancel: () => void;
}

function PasswordForm({
  editing, urlInput, onUrlChange, usernameInput, onUsernameChange, passwordInput, onPasswordChange,
  notesInput, onNotesChange, formError, saving, generatorOpen, onToggleGenerator,
  genLength, onGenLength, genLower, onGenLower, genUpper, onGenUpper, genDigits, onGenDigits,
  genSymbols, onGenSymbols, onGenerate, onSave, onCancel,
}: PasswordFormProps) {
  const inputStyle: React.CSSProperties = {
    padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--divider-strong)',
    background: 'var(--surface)', color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', outline: 'none',
    width: '100%', minWidth: 0, boxSizing: 'border-box',
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', marginBottom: 10,
      ...islandPlate, borderRadius: 'var(--radius-sm)',
    }}>
      <input
        type="text" placeholder="example.com" value={urlInput}
        onChange={(e) => onUrlChange(e.target.value)}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
        style={inputStyle}
      />
      <input
        type="text" placeholder="Логин / e-mail" value={usernameInput}
        onChange={(e) => onUsernameChange(e.target.value)}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text" placeholder={editing ? 'Новый пароль (не менять — оставить пустым)' : 'Пароль'}
          value={passwordInput} onChange={(e) => onPasswordChange(e.target.value)}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
          style={{ ...inputStyle, fontFamily: 'monospace', flex: 1, flexBasis: 200 }}
        />
        <button
          title="Генератор паролей" onClick={onToggleGenerator}
          style={{ ...btnGhost, flex: 'none', display: 'flex', alignItems: 'center' }}
        ><RefreshCw size={14} /></button>
      </div>

      {generatorOpen && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px',
          borderRadius: 'var(--radius-sm)', background: 'var(--surface-hover)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flex: 'none' }}>Длина: {genLength}</span>
            <input
              type="range" min={8} max={64} value={genLength}
              onChange={(e) => onGenLength(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <GenToggle label="a-z" checked={genLower} onChange={() => onGenLower(!genLower)} />
            <GenToggle label="A-Z" checked={genUpper} onChange={() => onGenUpper(!genUpper)} />
            <GenToggle label="0-9" checked={genDigits} onChange={() => onGenDigits(!genDigits)} />
            <GenToggle label="!@#" checked={genSymbols} onChange={() => onGenSymbols(!genSymbols)} />
          </div>
          <button onClick={onGenerate} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>Сгенерировать</button>
        </div>
      )}

      <textarea
        placeholder="Заметки (необязательно)" value={notesInput} rows={2}
        onChange={(e) => onNotesChange(e.target.value)}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />

      {formError && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #e05)' }}>{formError}</span>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button onClick={onCancel} style={btnGhost}>Отмена</button>
      </div>
    </div>
  );
}

function GenToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default' }}>
      <Toggle checked={checked} onChange={onChange} />
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)', fontFamily: 'monospace' }}>{label}</span>
    </label>
  );
}

// ── Инлайн-запрос парольной фразы (экспорт/импорт) ─────────────────────────────

function PassphrasePrompt({
  label, value, onChange, busy, msg, actionLabel, onConfirm,
}: {
  label: string; value: string; onChange: (v: string) => void; busy: boolean; msg: string;
  actionLabel: string; onConfirm: () => void;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', marginBottom: 8,
      ...islandPlate, borderRadius: 'var(--radius-sm)',
    }}>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{label}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="password" value={value} onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); }}
          style={{
            flex: 1, flexBasis: 200, minWidth: 0, boxSizing: 'border-box',
            padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            border: '1.5px solid var(--divider-strong)', background: 'var(--surface)',
            color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', outline: 'none',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
        />
        <button onClick={onConfirm} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1, flex: 'none' }}>
          {busy ? '…' : actionLabel}
        </button>
      </div>
      {msg && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{msg}</span>}
    </div>
  );
}

// ── Стили кнопок ──────────────────────────────────────────────────────────────

export const btnPrimary: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none',
  background: 'var(--accent)', color: '#fff',
  fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default', flex: 'none',
  whiteSpace: 'nowrap',
};
export const btnGhost: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--divider-strong)', background: 'transparent',
  color: 'var(--text-body)', fontSize: 'var(--fs-sm)', cursor: 'default', flex: 'none',
};
