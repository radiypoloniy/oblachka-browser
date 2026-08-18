// Поповер разрешений — отдельная WebContentsView поверх страницы, у левого верхнего угла
// контентной зоны (см. electron/PermissionPopoverManager.ts). Очередь запросов держит main:
// сюда приезжает ровно один текущий вопрос, а null означает «очередь пуста».
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { PermissionRequest } from '../shared/ipc';
import PermissionPrompt from './components/PermissionPrompt';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';

declare global {
  interface Window {
    permissionPopover: {
      respond: (requestId: string, granted: boolean, remember: boolean) => Promise<void>;
      reportHeight: (px: number) => void;
      onRequest: (cb: (req: PermissionRequest | null) => void) => () => void;
    };
  }
}

const CARD_WIDTH = 380;

function PermissionPopoverApp() {
  const [request, setRequest] = useState<PermissionRequest | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.permissionPopover.onRequest(setRequest), []);

  // Высоту меряем и сообщаем main: длинный домен переносится на вторую строку, и карточка
  // подросла бы за границу вью — WebContentsView обрезает всё, что вышло за её прямоугольник.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.permissionPopover.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [request]);

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box', width: CARD_WIDTH + SHADOW_MARGIN * 2 }}>
      <div ref={cardRef}>
        {request && (
          <PermissionPrompt
            // key — чтобы «Запомнить» не переезжал со старого вопроса на новый: галочка
            // относится к конкретному сайту и конкретному разрешению.
            key={request.requestId}
            request={request}
            onRespond={(granted, remember) => {
              void window.permissionPopover.respond(request.requestId, granted, remember);
            }}
          />
        )}
      </div>
    </div>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PermissionPopoverApp />
  </React.StrictMode>,
);
