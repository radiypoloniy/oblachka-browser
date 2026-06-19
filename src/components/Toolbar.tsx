import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, Lock, Search, Shield, Sparkles, Moon, Copy, Check } from 'lucide-react';
import type { TabState } from '../../shared/ipc';

interface ToolbarProps {
  tab: TabState | undefined;
  vpnOn: boolean;
  dark: boolean;
  onToggleVpn: () => void;
  onToggleDark: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSubmit: (input: string) => void;
}

export default function Toolbar({
  tab, vpnOn, dark, onToggleVpn, onToggleDark, onBack, onForward, onReload, onSubmit,
}: ToolbarProps) {
  const isHub = tab?.isHub ?? true;
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Пока пользователь не редактирует — поле отражает реальный URL вкладки.
  useEffect(() => {
    if (!editing) setValue(isHub ? '' : (tab?.url ?? ''));
  }, [tab?.url, isHub, editing]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    inputRef.current?.blur();
    setEditing(false);
  };

  const copyUrl = async () => {
    if (!tab?.url) return;
    try {
      await navigator.clipboard.writeText(tab.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* noop */ }
  };

  return (
    <div className="drag" style={{
      display: 'flex', alignItems: 'center', gap: 10, height: 56, flex: 'none', padding: '0 16px',
    }}>
      <div className="no-drag" style={{ display: 'flex', gap: 2 }}>
        <button title="Назад" disabled={!tab?.canGoBack} onClick={onBack}
          style={navBtn(!tab?.canGoBack)}><ArrowLeft size={18} /></button>
        <button title="Вперёд" disabled={!tab?.canGoForward} onClick={onForward}
          style={navBtn(!tab?.canGoForward)}><ArrowRight size={18} /></button>
        <button title="Обновить" disabled={isHub} onClick={onReload}
          style={navBtn(isHub)}><RefreshCw size={17} /></button>
      </div>

      <div className="no-drag" style={{ flex: 1, maxWidth: 620, margin: '0 auto', position: 'relative' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, height: 38,
          padding: '0 12px', borderRadius: 'var(--radius-pill)',
          background: 'var(--surface-sunken)',
          boxShadow: 'inset 0 0 0 1px var(--divider)',
        }}>
          <span style={{ color: 'var(--text-faint)', display: 'inline-flex' }}>
            {isHub ? <Search size={15} /> : <Lock size={14} />}
          </span>
          <input
            ref={inputRef}
            value={value}
            placeholder="Введите запрос или адрес"
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') { inputRef.current?.blur(); setEditing(false); }
            }}
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
              fontFamily: isHub ? 'var(--font-sans)' : 'var(--font-mono)',
            }}
          />
          {!isHub && tab?.url && (
            <button title="Копировать адрес" onClick={copyUrl}
              style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 3, display: 'inline-flex', color: copied ? 'var(--dot-local)' : 'var(--text-faint)' }}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
        </div>
      </div>

      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onToggleVpn} title="VPN" style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px',
          borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'default',
          background: vpnOn ? 'var(--surface)' : 'var(--surface-sunken)',
          boxShadow: vpnOn ? 'var(--shadow-card)' : 'none',
          fontSize: 'var(--fs-sm)', fontWeight: 500,
          color: vpnOn ? 'var(--text-strong)' : 'var(--text-muted)',
        }}>
          <Shield size={15} style={{ color: vpnOn ? 'var(--dot-vpn)' : 'var(--text-faint)' }} />
          {vpnOn ? 'VPN · Финляндия' : 'VPN выкл.'}
          {vpnOn && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dot-vpn)' }} />}
        </button>
        <button title="AI-хаб" style={{ ...navBtn(false), background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          <Sparkles size={18} />
        </button>
        <button title="Тема" onClick={onToggleDark}
          style={{ ...navBtn(false), color: dark ? 'var(--accent)' : 'var(--text-muted)' }}>
          <Moon size={18} />
        </button>
      </div>
    </div>
  );
}

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    border: 'none', background: 'transparent', padding: 7, borderRadius: 'var(--radius-sm)',
    color: disabled ? 'var(--text-faint)' : 'var(--text-muted)',
    cursor: 'default', display: 'inline-flex', opacity: disabled ? 0.45 : 1,
  };
}
