// Поповер обновления — отдельная WebContentsView поверх страницы, у левого верхнего угла
// контентной зоны (см. electron/UpdatePromptManager.ts). Состояние держит main: сюда приезжает
// текущий UpdateStatus, null — карточки нет.
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { UpdateStatus } from '../shared/ipc';
import UpdatePrompt from './components/UpdatePrompt';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';

declare global {
  interface Window {
    updatePrompt: {
      respond: (action: 'update' | 'later' | 'skip') => void;
      reportHeight: (px: number) => void;
      onState: (cb: (s: UpdateStatus | null) => void) => () => void;
    };
  }
}

const CARD_WIDTH = 380;

function UpdatePromptApp() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.updatePrompt.onState(setStatus), []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.updatePrompt.reportHeight(el.offsetHeight);
    report();
    const raf = requestAnimationFrame(report);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    void document.fonts?.ready.then(report).catch(() => { /* шрифты не наша забота */ });
    document.addEventListener('visibilitychange', report);
    window.addEventListener('resize', report);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', report);
      window.removeEventListener('resize', report);
    };
  }, [status]);

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box', width: CARD_WIDTH + SHADOW_MARGIN * 2 }}>
      <div ref={cardRef}>
        {status && (
          <UpdatePrompt
            key={`${status.kind}:${status.newVersion ?? ''}`}
            status={status}
            onRespond={(action) => window.updatePrompt.respond(action)}
          />
        )}
      </div>
    </div>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UpdatePromptApp />
  </React.StrictMode>,
);
