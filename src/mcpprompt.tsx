// Карточка «внешний агент просит разрешение» — отдельная WebContentsView поверх страницы,
// у ПРАВОГО верхнего угла контентной зоны (см. electron/McpPromptManager.ts). Очередь держит
// main: сюда приезжает ровно один текущий вопрос, null — очередь пуста.
//
// ⚠️ Она заменила системное окно Windows, и в этом вся суть правки: спрашивает браузер — значит
// и выглядеть это должно как браузер. Дизайн-система здесь та же, что у остального интерфейса,
// числа — из src/styles/system.ts.
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Plug, PenLine } from 'lucide-react';
import type { McpPromptRequest } from '../shared/ipc';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';
import { RADIUS, TEXT, motion, pad, sp } from './styles/system';

declare global {
  interface Window {
    mcpPrompt: {
      respond: (id: string, granted: boolean, remember: boolean) => void;
      reportHeight: (px: number) => void;
      onRequest: (cb: (req: McpPromptRequest | null) => void) => () => void;
    };
  }
}

const CARD_WIDTH = 380;

function McpPromptApp() {
  const [request, setRequest] = useState<McpPromptRequest | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.mcpPrompt.onRequest(setRequest), []);

  // Высоту меряем и сообщаем main: длинный адрес переносится на вторую строку, и карточка
  // подросла бы за границу вью — WebContentsView обрезает всё, что вышло за её прямоугольник.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.mcpPrompt.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [request]);

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box', width: CARD_WIDTH + SHADOW_MARGIN * 2 }}>
      <div ref={cardRef}>
        {request && <PromptCard key={request.id} request={request} />}
      </div>
    </div>
  );
}

function PromptCard({ request }: { request: McpPromptRequest }) {
  const connect = request.kind === 'connect';
  const Icon = connect ? Plug : PenLine;
  const answer = (granted: boolean, remember = false) => {
    window.mcpPrompt.respond(request.id, granted, remember);
  };

  return (
    <div style={{
      background: 'var(--surface-solid)',
      border: '1px solid var(--glass-edge)',
      borderRadius: RADIUS.box,
      boxShadow: 'var(--shadow-island)',
      padding: pad(4, 4),
      display: 'flex',
      flexDirection: 'column',
      gap: sp(3),
    }}>
      <div style={{ display: 'flex', gap: sp(3), alignItems: 'flex-start' }}>
        {/* Значок на нейтральной плашке, а не цветной: тон здесь ничего не сообщает — это
            вопрос, а не статус. */}
        <span style={{
          flex: 'none', width: 32, height: 32, borderRadius: RADIUS.control,
          background: 'var(--surface-sunken)', color: 'var(--text-body)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={16} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...TEXT.body, fontWeight: 600, color: 'var(--text-strong)' }}>
            {connect ? 'Подключить внешнюю программу?' : 'Разрешить изменить браузер?'}
          </div>
          {/* ⚠️ Про непроверенность имени сказано прямо и здесь: карточка не выдаёт чужое
              представление за удостоверение личности. */}
          <div style={{ ...TEXT.caption }}>{request.client} · назвалась так сама</div>
        </div>
      </div>

      <div style={{
        ...TEXT.body, color: 'var(--text-strong)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        padding: pad(2, 3), borderRadius: RADIUS.control, background: 'var(--surface-sunken)',
      }}>{request.detail}</div>

      <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
        <button onClick={() => answer(true)} style={btn('accent')}>
          {connect ? 'Подключить' : 'Разрешить'}
        </button>
        {/* ⚠️ «Всегда» есть не у всякого вопроса: у необратимого (закрыть вкладку) его нет
            вовсе — см. canRemember в shared/mcpPolicy.ts. */}
        {request.canRemember && (
          <button onClick={() => answer(true, true)} style={btn('quiet')}>Разрешать всегда</button>
        )}
        <button onClick={() => answer(false)} style={{ ...btn('quiet'), marginLeft: 'auto' }}>
          Отказать
        </button>
      </div>
    </div>
  );
}

function btn(kind: 'accent' | 'quiet'): React.CSSProperties {
  return {
    padding: pad(2, 3),
    borderRadius: RADIUS.pill,
    border: kind === 'accent' ? 'none' : '1px solid var(--divider-strong)',
    background: kind === 'accent' ? 'var(--accent)' : 'transparent',
    color: kind === 'accent' ? 'var(--on-accent)' : 'var(--text-body)',
    fontWeight: kind === 'accent' ? 600 : 400,
    ...TEXT.body,
    cursor: 'default',
    transition: motion.hover('background', 'opacity'),
  };
}

installOverlayReveal();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><McpPromptApp /></React.StrictMode>,
);
