import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { MapPin, CreditCard } from 'lucide-react';
import type { AddressProfile, CardMeta } from '../shared/ipc';
import { islandPlate } from './styles/island';
import './styles/global.css';

// Состояние поповера (совпадает с electron/AutofillPopoverManager.ts::AutofillPopoverState).
type AutofillPopoverState =
  | { kind: 'address'; addresses: AddressProfile[] }
  | { kind: 'card'; cards: CardMeta[] }
  | { kind: 'save-address'; title: string; sub: string }
  | { kind: 'save-card'; title: string; sub: string };

declare global {
  interface Window {
    autofillPopover: {
      pick: (id: number) => void;
      save: () => void;
      close: () => void;
      reportHeight: (px: number) => void;
      onShow: (cb: (state: AutofillPopoverState) => void) => () => void;
    };
  }
}

// Держать в синхроне с SHADOW_MARGIN в electron/AutofillPopoverManager.ts.
const SHADOW_MARGIN = 16;

const cardShell: React.CSSProperties = {
  ...islandPlate, borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-island)',
  background: 'var(--surface-solid)', overflow: 'hidden',
};
const btnPrimary: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: 'none',
  background: 'var(--accent)', color: '#fff', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default',
};
const btnGhost: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--divider-strong)',
  background: 'transparent', color: 'var(--text-body)', fontSize: 'var(--fs-sm)', cursor: 'default',
};

function summary(a: AddressProfile): string {
  return [a.street, a.city, a.country].filter(Boolean).join(', ');
}
function primaryLabel(a: AddressProfile): string {
  return a.fullName || a.email || a.phone || summary(a) || 'Адрес';
}

function AutofillPopoverApp() {
  const [state, setState] = useState<AutofillPopoverState | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.autofillPopover.onShow((next) => setState(next)), []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.autofillPopover.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  if (!state) return null;

  // Режим предложения сохранить (после отправки формы).
  if (state.kind === 'save-address' || state.kind === 'save-card') {
    return (
      <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
        <div ref={cardRef} style={cardShell}>
          <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
            {state.kind === 'save-card'
              ? <CreditCard size={18} style={{ color: 'var(--text-muted)', flex: 'none' }} />
              : <MapPin size={18} style={{ color: 'var(--text-muted)', flex: 'none' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                {state.kind === 'save-card' ? 'Сохранить карту в Oblako?' : 'Сохранить адрес в Oblako?'}
              </div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {state.title}{state.sub ? `  ·  ${state.sub}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '4px 14px 12px', justifyContent: 'flex-end' }}>
            <button onClick={() => window.autofillPopover.close()} style={btnGhost}>Не сохранять</button>
            <button onClick={() => window.autofillPopover.save()} style={btnPrimary}>Сохранить</button>
          </div>
        </div>
      </div>
    );
  }

  const items = state.kind === 'address' ? state.addresses : state.cards;
  if (items.length === 0) return null;

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={cardShell}>
        <div style={{
          padding: '8px 12px', fontSize: 'var(--fs-xs)', fontWeight: 600,
          color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 'var(--ls-caps)',
          borderBottom: '1px solid var(--divider)',
        }}>
          {state.kind === 'address' ? 'Заполнить адрес' : 'Заполнить карту'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: 4 }}>
          {state.kind === 'address'
            ? state.addresses.map((a) => (
                <Row key={a.id} icon={<MapPin size={16} style={{ color: 'var(--text-muted)', flex: 'none' }} />}
                  title={primaryLabel(a)} sub={summary(a) || a.email || '—'} onClick={() => window.autofillPopover.pick(a.id)} />
              ))
            : state.cards.map((c) => (
                <Row key={c.id} icon={<CreditCard size={16} style={{ color: 'var(--text-muted)', flex: 'none' }} />}
                  title={[c.brand, `•••• ${c.last4}`].filter(Boolean).join(' ')}
                  sub={[c.cardholder, fmtExp(c.expMonth, c.expYear)].filter(Boolean).join('  ·  ') || '—'}
                  onClick={() => window.autofillPopover.pick(c.id)} />
              ))}
        </div>
      </div>
    </div>
  );
}

function Row({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: 'none',
        background: 'transparent', cursor: 'default',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
      </div>
    </button>
  );
}

function fmtExp(m: number, y: number): string {
  if (!m || !y) return '';
  return `${String(m).padStart(2, '0')}/${String(y).slice(-2)}`;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AutofillPopoverApp />
  </React.StrictMode>,
);
