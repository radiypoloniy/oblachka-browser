import { useEffect, useRef, useState } from 'react';
import { X, Shield, ShieldOff, Wifi, Cpu, Palette, Plus, Trash2, RotateCcw, KeyRound, Check, type LucideIcon } from 'lucide-react';
import type { AdBlockState } from '../../shared/ipc';

interface SettingsProps {
  onClose: () => void;
}

// Секции левого меню — «Блокировка» и «AI» рабочие, VPN/Интерфейс — placeholder для будущих
// этапов. soon — единственный флаг, гоняющий и активность, и клик, и стиль (см. рендер-цикл
// ниже) — точечно снят только у 'ai', остальные пункты и их поведение не тронуты.
type NavItem = { id: string; label: string; Icon: LucideIcon; soon?: boolean };
const NAV_ITEMS: NavItem[] = [
  { id: 'adblock',    label: 'Блокировка', Icon: Shield },
  { id: 'vpn',        label: 'VPN',         Icon: Wifi,    soon: true },
  { id: 'ai',         label: 'AI',          Icon: Cpu },
  { id: 'appearance', label: 'Интерфейс',   Icon: Palette, soon: true },
];
type SectionId = 'adblock' | 'vpn' | 'ai' | 'appearance';

export default function Settings({ onClose }: SettingsProps) {
  const [section, setSection] = useState<SectionId>('adblock');
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
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--app-bg)', overflow: 'hidden',
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
        <nav style={{
          width: 200, flex: 'none', borderRight: '1px solid var(--divider-strong)',
          padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {NAV_ITEMS.map(({ id, label, Icon, soon }) => {
            const active = section === id && !soon;
            return (
              <button
                key={id}
                disabled={!!soon}
                onClick={() => { if (!soon) setSection(id as SectionId); }}
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
                {label}
                {soon && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)', fontWeight: 400 }}>
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
          {section === 'ai' && <AiSection />}
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
          borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
          boxShadow: 'var(--shadow-card)', fontSize: 'var(--fs-sm)',
        }}>
          <RotateCcw size={15} style={{ color: 'var(--accent)', flex: 'none' }} />
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
        borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
        boxShadow: 'var(--shadow-card)',
      }}>
        {state.enabled
          ? <Shield size={22} style={{ color: 'var(--accent)', flex: 'none' }} />
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
                <span style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-body)', fontFamily: 'monospace' }}>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
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
        borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
        boxShadow: 'var(--shadow-card)',
      }}>
        {connected
          ? <Check size={22} style={{ color: 'var(--system)', flex: 'none' }} />
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
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
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
    </div>
  );
}

// ── Простой CSS-тумблер ────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        position: 'relative', width: 44, height: 24, borderRadius: 12,
        border: 'none', cursor: 'default', flex: 'none', padding: 0,
        background: checked ? 'var(--accent)' : 'var(--neutral-300)',
        transition: 'background var(--dur-fast) var(--ease-standard)',
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left var(--dur-fast) var(--ease-standard)',
        boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </button>
  );
}

// ── Стили кнопок ──────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none',
  background: 'var(--accent)', color: '#fff',
  fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default', flex: 'none',
};
const btnGhost: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--divider-strong)', background: 'transparent',
  color: 'var(--text-body)', fontSize: 'var(--fs-sm)', cursor: 'default', flex: 'none',
};
