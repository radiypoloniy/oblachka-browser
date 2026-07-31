import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Download, ListEnd, X } from 'lucide-react';

// Плавающее окно веб-приложения над холстом графа. Внешне — тот же слот, что в разделе
// «Приложения» AI-панели (см. SlotFrame в src/components/aiApps.tsx): карточка с шапкой,
// иконкой, названием и крестиком, а сайт живёт в «дырке» под шапкой.
//
// Почему окно плавает НАД холстом, а не лежит внутри карточки узла: внутри узла живёт
// нативная WebContentsView, а её нельзя ни отмасштабировать вместе с зумом холста, ни
// обрезать по его краю (setBounds — прямоугольник, не маска), ни увести под связи —
// нативный слой всегда поверх React. Отсюда плата: окно не ездит и не масштабируется
// вместе с холстом, его двигают за шапку.

const MIN_W = 360;
const MIN_H = 320;

interface Props {
  graphId: number;
  nodeId: string;
  url: string;
  title: string;
  hostLabel: string;
  note: string | null;
  onClose: () => void;
  onInsert: () => void;
  onCaptureSelection: () => void;
  onCaptureLast: () => void;
}

// Буквенная иконка — тот же приём, что у пользовательских веб-приложений панели
// (customToDef → gradient var(--appicon-webcustom)).
function LetterBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        width: 20, height: 20, flexShrink: 0, borderRadius: 6,
        background: 'var(--appicon-webcustom)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
      }}
    >
      {label.slice(0, 1)}
    </span>
  );
}

function HeaderButton({ title, onClick, children }: {
  title: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, flexShrink: 0, padding: 0,
        background: 'transparent', border: 'none', borderRadius: '50%',
        color: 'var(--text-muted)', cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export default function GraphWebAppWindow({
  graphId, nodeId, url, title, hostLabel, note,
  onClose, onInsert, onCaptureSelection, onCaptureLast,
}: Props) {
  const [rect, setRect] = useState({ x: 120, y: 60, w: 460, h: 560 });
  const holeRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize'; dx: number; dy: number } | null>(null);
  const shownRef = useRef(false);

  // Вью создаёт и двигает сам слот — тот же приём, что у WebAppSlot в aiApps.tsx
  // (маунт → open, ResizeObserver → bounds). Держать это в родителе нельзя: дочерние
  // эффекты в React выполняются РАНЬШЕ родительских, и первые bounds уходили бы до того,
  // как вью вообще создана, — то есть терялись бы.
  //
  // Координаты шлём на КАЖДОЕ изменение прямоугольника, а не только по ResizeObserver:
  // перетаскивание меняет позицию при неизменном размере, и observer на это не срабатывает —
  // ровно та же ловушка, что описана у WebAppSlot про свап слотов.
  useEffect(() => {
    const el = holeRef.current;
    if (!el) return;
    const box = () => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const send = () => {
      if (!shownRef.current) {
        shownRef.current = true;
        void window.oblako.showGraphWebApp(graphId, nodeId, url, box());
        return;
      }
      void window.oblako.setGraphWebAppBounds(box());
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener('resize', send);
    return () => { ro.disconnect(); window.removeEventListener('resize', send); };
  }, [rect, graphId, nodeId, url]);

  // Закрытие окна прячет вью, но НЕ уничтожает её: переписка в чужом чате должна пережить
  // сворачивание. Уничтожается вью только вместе с узлом (см. onNodesChange в GraphCanvas).
  useEffect(() => () => {
    void window.oblako.setGraphWebAppBounds({ x: 0, y: 0, width: 0, height: 0 });
  }, []);

  const onPointerDown = useCallback((mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = mode === 'move'
      ? { mode, dx: e.clientX - rect.x, dy: e.clientY - rect.y }
      : { mode, dx: e.clientX - rect.w, dy: e.clientY - rect.h };
  }, [rect]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    if (drag.mode === 'move') {
      setRect((r) => ({ ...r, x: Math.max(0, e.clientX - drag.dx), y: Math.max(0, e.clientY - drag.dy) }));
    } else {
      setRect((r) => ({
        ...r,
        w: Math.max(MIN_W, e.clientX - drag.dx),
        h: Math.max(MIN_H, e.clientY - drag.dy),
      }));
    }
  }, []);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  return (
    <div
      style={{
        position: 'fixed', left: rect.x, top: rect.y, width: rect.w, height: rect.h,
        zIndex: 5, display: 'flex', flexDirection: 'column',
        background: 'var(--surface-solid)', borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)', overflow: 'hidden',
        border: '1px solid var(--glass-edge)',
      }}
    >
      <div
        onPointerDown={onPointerDown('move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
          flexShrink: 0, borderBottom: '1px solid var(--divider)',
          cursor: 'move', touchAction: 'none',
        }}
      >
        <LetterBadge label={hostLabel} />
        <span
          style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
          }}
        >
          {title}
        </span>
        <HeaderButton title="Вставить промпт графа в поле ввода" onClick={onInsert}>
          <ClipboardPaste size={13} strokeWidth={2} />
        </HeaderButton>
        <HeaderButton title="Забрать выделенный текст в узел" onClick={onCaptureSelection}>
          <Download size={13} strokeWidth={2} />
        </HeaderButton>
        <HeaderButton title="Забрать последний ответ в узел" onClick={onCaptureLast}>
          <ListEnd size={13} strokeWidth={2} />
        </HeaderButton>
        <HeaderButton title="Закрыть приложение" onClick={onClose}>
          <X size={13} strokeWidth={2} />
        </HeaderButton>
      </div>

      {note && (
        <div
          style={{
            flexShrink: 0, padding: '6px 12px', borderBottom: '1px solid var(--divider)',
            background: 'var(--surface-sunken)', color: 'var(--text-body)',
            fontSize: 'var(--fs-xs)', lineHeight: 'var(--lh-snug)',
          }}
        >
          {note}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, padding: '0 8px 8px', display: 'flex' }}>
        <div
          ref={holeRef}
          style={{
            flex: 1, minWidth: 0, borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-sunken)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {/* Видно только пока сайт не отрисовался — нативная вью ложится сверху. */}
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>Загрузка…</span>
        </div>
      </div>

      {/* Уголок изменения размера — окно должно тянуться, чат бывает длинным. */}
      <div
        onPointerDown={onPointerDown('resize')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: 'absolute', right: 0, bottom: 0, width: 16, height: 16,
          cursor: 'nwse-resize', touchAction: 'none',
        }}
      />
    </div>
  );
}
