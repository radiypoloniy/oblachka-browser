// Карточка «внешний агент просит разрешение» — отдельная WebContentsView поверх страницы,
// у ПРАВОГО верхнего угла контентной зоны (см. electron/McpPromptManager.ts). Очередь держит
// main: сюда приезжает ровно один текущий вопрос, null — очередь пуста.
//
// ⚠️ РИСУЕТСЯ ТЕМ ЖЕ РЕЦЕПТОМ, ЧТО КАРТОЧКА РАЗРЕШЕНИЙ САЙТА (popoverKit + PermissionPrompt), и
// это не экономия. У них одна речь — «ответь сейчас, иначе действие не состоится». Своя вёрстка
// здесь сначала и была написана, и вышло ровно то, чем плоха любая самодеятельность в общем
// интерфейсе: другая плита, другой кегль, другие кнопки — и карточка читается как чужая.
//
// ⚠️ Инверсная плита теперь у ДВУХ карточек, а не у одной. Правило в popoverKit переписано под
// это: класс — «вопрос, требующий ответа сейчас», членов ровно два (разрешение сайта и
// разрешение внешней программы). Третьей карточке инверсию не давать.
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Plug, PenLine } from 'lucide-react';
import type { McpPromptRequest } from '../shared/ipc';
import { PopoverCard, PopoverActions, PrimaryButton, QuietButton } from './components/popoverKit';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';
import { RADIUS, TEXT, DISPLAY, sp } from './styles/system';

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
  const [remember, setRemember] = useState(false);
  const connect = request.kind === 'connect';
  const Icon = connect ? Plug : PenLine;

  return (
    <div className="oblako-ask-in">
      <PopoverCard width={CARD_WIDTH} invert>
        <div style={{ display: 'flex', gap: sp(4), alignItems: 'flex-start' }}>
          {/* Плашка значка — на инверсной плите своя: акцентная заливка на тёмном не читается. */}
          <span style={{
            width: 46, height: 46, borderRadius: RADIUS.box, flex: 'none',
            display: 'grid', placeItems: 'center',
            background: 'var(--overlay-invert-quiet)', color: 'var(--overlay-invert-ink)',
          }}>
            <Icon size={23} style={{ flexShrink: 0 }} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            {/* ⚠️ ПРОГРАММА ПЕРВОЙ СТРОКОЙ — ровно как имя сайта у разрешений: решение
                принимается про неё. Моноширинным, как адрес: это идентификатор, а не заголовок. */}
            <div style={{
              ...TEXT.caption, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
              color: 'var(--overlay-invert-body)', marginBottom: sp(1),
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{request.client}</div>
            <div style={{
              ...DISPLAY, fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em',
              lineHeight: 1.14, color: 'var(--overlay-invert-ink)', marginBottom: sp(2),
            }}>{request.title}</div>
            <div style={{
              ...TEXT.body, color: 'var(--overlay-invert-body)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{request.detail}</div>
          </div>
        </div>

        {/* ⚠️ Галочка, а не третья кнопка: «больше не спрашивать» — уточнение ответа, а не
            отдельный ответ. У необратимого (закрыть вкладку) её нет вовсе — см. canRemember. */}
        {request.canRemember && (
          <label style={{
            display: 'flex', alignItems: 'center', gap: sp(2),
            ...TEXT.caption, color: 'var(--overlay-invert-body)',
            cursor: 'default', userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ cursor: 'default', accentColor: 'var(--accent)' }}
            />
            Больше не спрашивать об этом действии
          </label>
        )}

        <PopoverActions>
          <PrimaryButton stretch big onClick={() => window.mcpPrompt.respond(request.id, true, remember)}>
            {connect ? 'Подключить' : 'Разрешить'}
          </PrimaryButton>
          <QuietButton stretch big invert onClick={() => window.mcpPrompt.respond(request.id, false, false)}>
            Отказать
          </QuietButton>
        </PopoverActions>
      </PopoverCard>
    </div>
  );
}

installOverlayReveal();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><McpPromptApp /></React.StrictMode>,
);
