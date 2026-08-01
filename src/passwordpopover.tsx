import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { PasswordIndicatorState } from '../shared/ipc';
import PasswordIndicatorPopover from './components/PasswordIndicatorPopover';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';

declare global {
  interface Window {
    passwordPopover: {
      savePendingPassword: () => Promise<boolean>;
      updatePendingPassword: () => Promise<boolean>;
      fillSavedPassword: (id: number) => Promise<boolean>;
      dismissPendingPassword: () => Promise<void>;
      generatePendingPassword: () => Promise<boolean>;
      close: () => void;
      reportHeight: (px: number) => void;
      onShow: (cb: (state: PasswordIndicatorState) => void) => () => void;
    };
  }
}

// Держать в синхроне с SHADOW_MARGIN в electron/PasswordPopoverManager.ts.
const SHADOW_MARGIN = 16;

function PasswordPopoverApp() {
  const [state, setState] = useState<PasswordIndicatorState | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return window.passwordPopover.onShow((next) => setState(next));
  }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.passwordPopover.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  if (!state) return null;
  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef}>
        <PasswordIndicatorPopover
          state={state}
          onClose={() => window.passwordPopover.close()}
          actions={window.passwordPopover}
        />
      </div>
    </div>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PasswordPopoverApp />
  </React.StrictMode>,
);
