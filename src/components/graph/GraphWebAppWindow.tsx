import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClipboardPaste, Download, ListEnd, ImageDown, X, PanelRight, Maximize2, Minimize2,
} from 'lucide-react';

export type WebAppMode = 'floating' | 'docked' | 'fullscreen'

// Окно веб-приложения над холстом графа. Внешне — тот же слот, что в разделе
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
  // Порядковый номер открытия — окна раскладываются лесенкой, чтобы второй чат не лёг
  // ровно поверх первого (сравнивать два ответа рядом — основной сценарий).
  index: number;
  mode: WebAppMode;
  // Развёрнут другой сайт — этот надо спрятать, иначе всплывёт поверх него: у нативных вью
  // свой порядок наложения, и React-слой их не перекрывает.
  hidden: boolean;
  // Прямоугольник области графа в координатах окна. Плавающее окно живёт ВНУТРИ него:
  // position:fixed отсчитывается от вьюпорта, и без этого окно садилось поверх сайдбара
  // браузера и тулбара — то есть за пределами графа, которому принадлежит.
  area: { x: number; y: number; w: number; h: number };
  onSetMode: (mode: WebAppMode) => void;
  onFocus: () => void;
  onClose: () => void;
  onInsert: () => void;
  onCaptureSelection: () => void;
  onCaptureLast: () => void;
  onCaptureImage: () => void;
}

// Буквенная иконка — тот же приём, что у пользовательских веб-приложений панели
// (customToDef → gradient var(--appicon-webcustom)).
function LetterBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        width: 20, height: 20, flexShrink: 0, borderRadius: 'var(--radius-sm)',
        background: 'var(--appicon-webcustom)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 'var(--fs-xs)', fontWeight: 700, textTransform: 'uppercase',
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
  graphId, nodeId, url, title, hostLabel, note, index, mode, hidden, area,
  onSetMode, onFocus, onClose, onInsert, onCaptureSelection, onCaptureLast, onCaptureImage,
}: Props) {
  const [rect, setRect] = useState(() => ({
    x: area.x + 24 + (index % 4) * 40,
    y: area.y + 20 + (index % 4) * 34,
    w: Math.min(460, Math.max(MIN_W, area.w - 48)),
    h: Math.min(560, Math.max(MIN_H, area.h - 40)),
  }));
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
      // Нулевой прямоугольник — сентинел «спрятать». Пока развёрнут другой сайт, этот
      // обязан уйти с экрана целиком, а не просто оказаться под ним.
      const rect = hidden ? { x: 0, y: 0, width: 0, height: 0 } : box();
      if (!shownRef.current) {
        shownRef.current = true;
        void window.oblako.showGraphWebApp(graphId, nodeId, url, rect);
        return;
      }
      void window.oblako.setGraphWebAppBounds(graphId, nodeId, rect);
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener('resize', send);
    return () => { ro.disconnect(); window.removeEventListener('resize', send); };
  }, [rect, graphId, nodeId, url, hidden, mode]);

  // Закрытие окна прячет вью, но НЕ уничтожает её: переписка в чужом чате должна пережить
  // сворачивание. Уничтожается вью только вместе с узлом (см. onNodesChange в GraphCanvas).
  useEffect(() => () => {
    void window.oblako.setGraphWebAppBounds(graphId, nodeId, { x: 0, y: 0, width: 0, height: 0 });
  }, [graphId, nodeId]);

  // Esc — страховочный выход. Нативная вью лежит поверх React и закрывает часть экрана;
  // если до крестика почему-то не добраться, окно всё равно должно убираться с клавиатуры.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Область меняется при ресайзе окна и при открытии дока — читаем её через ref, чтобы
  // обработчики перетаскивания не пересоздавались на каждое изменение.
  const areaRef = useRef(area);
  areaRef.current = area;

  const dragMode = mode;
  const onPointerDown = useCallback((mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    // ⚠️ Клик по кнопке в шапке не должен становиться перетаскиванием. setPointerCapture
    // на шапке перехватывает указатель ЦЕЛИКОМ: последующие pointer-события уходят шапке,
    // до кнопки не доходят, и click не рождается вовсе. Из-за этого не работали разом
    // крестик, вставка промпта и забор ответа — при живой логике под ними.
    if (mode === 'move' && (e.target as HTMLElement).closest('button')) return;
    if (dragMode !== 'floating') return; // закреплённое и развёрнутое окно не таскают
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = mode === 'move'
      ? { mode, dx: e.clientX - rect.x, dy: e.clientY - rect.y }
      : { mode, dx: e.clientX - rect.w, dy: e.clientY - rect.h };
  }, [rect, dragMode]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    if (drag.mode === 'move') {
      // Держим окно в границах графа: за них ему выезжать некуда — нативная вью всё равно
      // не обрежется по краю области и легла бы поверх чужого интерфейса.
      setRect((r) => ({
        ...r,
        x: Math.min(Math.max(areaRef.current.x, e.clientX - drag.dx), areaRef.current.x + areaRef.current.w - r.w),
        y: Math.min(Math.max(areaRef.current.y, e.clientY - drag.dy), areaRef.current.y + areaRef.current.h - r.h),
      }));
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
      // Любое касание окна поднимает его наверх — и React-рамку, и нативную вью разом,
      // иначе их порядки разъезжаются (см. raiseGraphWebApp в GraphWebAppManager).
      onPointerDownCapture={onFocus}
      style={{
        // Три раскладки одной карточки. Плавающая — по своим координатам поверх всего;
        // закреплённая — обычный блок в правом доке, размер даёт родитель; развёрнутая —
        // во всю область графа. Внутренности во всех трёх одинаковые, поэтому шапка,
        // «дырка» и вся логика координат не дублируются.
        ...(mode === 'floating'
          ? { position: 'fixed' as const, left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: 5 }
          : mode === 'fullscreen'
            ? { position: 'absolute' as const, inset: 0, zIndex: 16 }
            : { position: 'relative' as const, flex: 1, minHeight: 0, width: '100%' }),
        display: hidden ? 'none' : 'flex', flexDirection: 'column',
        background: 'var(--surface-solid)',
        borderRadius: mode === 'fullscreen' ? 0 : 'var(--radius-card)',
        boxShadow: mode === 'floating' ? 'var(--shadow-card)' : 'none',
        overflow: 'hidden',
        border: mode === 'fullscreen' ? 'none' : '1px solid var(--glass-edge)',
      }}
    >
      <div
        onPointerDown={onPointerDown('move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
          flexShrink: 0, borderBottom: '1px solid var(--divider)',
          cursor: mode === 'floating' ? 'move' : 'default', touchAction: 'none',
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
        <HeaderButton title="Забрать сгенерированную картинку в узел" onClick={onCaptureImage}>
          <ImageDown size={13} strokeWidth={2} />
        </HeaderButton>
        <HeaderButton
          title={mode === 'docked' ? 'Открепить' : 'Закрепить справа'}
          onClick={() => onSetMode(mode === 'docked' ? 'floating' : 'docked')}
        >
          <PanelRight size={13} strokeWidth={2} />
        </HeaderButton>
        <HeaderButton
          title={mode === 'fullscreen' ? 'Свернуть' : 'На весь экран'}
          onClick={() => onSetMode(mode === 'fullscreen' ? 'floating' : 'fullscreen')}
        >
          {mode === 'fullscreen'
            ? <Minimize2 size={13} strokeWidth={2} />
            : <Maximize2 size={13} strokeWidth={2} />}
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

      {/* Уголок изменения размера — только у плавающего: у закреплённого размер задаёт док,
          у развёрнутого — вся область. */}
      {mode === 'floating' && (
      <div
        onPointerDown={onPointerDown('resize')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: 'absolute', right: 0, bottom: 0, width: 16, height: 16,
          cursor: 'nwse-resize', touchAction: 'none',
        }}
      />
      )}
    </div>
  );
}
