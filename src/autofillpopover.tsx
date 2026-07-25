import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { MapPin } from 'lucide-react';
import type { AddressProfile } from '../shared/ipc';
import { islandPlate } from './styles/island';
import './styles/global.css';

// Состояние поповера (совпадает с electron/AutofillPopoverManager.ts::AutofillPopoverState).
interface AutofillPopoverState {
  kind: 'address';
  addresses: AddressProfile[];
}

declare global {
  interface Window {
    autofillPopover: {
      pick: (id: number) => void;
      close: () => void;
      reportHeight: (px: number) => void;
      onShow: (cb: (state: AutofillPopoverState) => void) => () => void;
    };
  }
}

// Держать в синхроне с SHADOW_MARGIN в electron/AutofillPopoverManager.ts.
const SHADOW_MARGIN = 16;

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

  if (!state || state.addresses.length === 0) return null;

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={{
        ...islandPlate,
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-island)',
        background: 'var(--surface-solid)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '8px 12px', fontSize: 'var(--fs-xs)', fontWeight: 600,
          color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 'var(--ls-caps)',
          borderBottom: '1px solid var(--divider)',
        }}>
          Заполнить адрес
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: 4 }}>
          {state.addresses.map((a) => (
            <button
              key={a.id}
              onClick={() => window.autofillPopover.pick(a.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: 'none',
                background: 'transparent', cursor: 'default',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <MapPin size={16} style={{ color: 'var(--text-muted)', flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{primaryLabel(a)}</div>
                <div style={{
                  fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{summary(a) || a.email || '—'}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AutofillPopoverApp />
  </React.StrictMode>,
);
