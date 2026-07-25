import { useEffect, useRef, useState } from 'react';
import { X, Shield, Wifi, Cpu, Palette, Lock, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import type { AdBlockState } from '../../shared/ipc';
import { islandPlate } from '../styles/island';
import AdBlockSection from './settings/AdBlockSection';
import VpnSection from './settings/VpnSection';
import AiSection from './settings/AiSection';
import PasswordsSection from './settings/PasswordsSection';
import GeneralSection from './settings/GeneralSection';

interface SettingsProps {
  onClose: () => void;
  // Открыть диалог импорта данных из другого браузера — модалка живёт в App.tsx (поверх всего
  // chrome), Settings только прокидывает команду в раздел «Браузер» (см. ImportDialog.tsx).
  onOpenImport: () => void;
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
  { id: 'general',    label: 'Браузер',    Icon: SlidersHorizontal },
  { id: 'adblock',    label: 'Блокировка', Icon: Shield },
  { id: 'vpn',        label: 'VPN',         Icon: Wifi },
  { id: 'ai',         label: 'AI',          Icon: Cpu },
  { id: 'passwords',  label: 'Пароли',      Icon: Lock },
  { id: 'appearance', label: 'Интерфейс',   Icon: Palette, soon: true },
];
type SectionId = 'general' | 'adblock' | 'vpn' | 'ai' | 'passwords' | 'appearance';

function isSectionId(v: unknown): v is SectionId {
  return v === 'general' || v === 'adblock' || v === 'vpn' || v === 'ai' || v === 'passwords' || v === 'appearance';
}

export default function Settings({ onClose, defaultSection, onOpenImport }: SettingsProps) {
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
          {section === 'general' && <GeneralSection onOpenImport={onOpenImport} />}
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
