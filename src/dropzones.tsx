// Оверлей «куда отпустить вкладку» — рисуется поверх страницы, пока вкладку тащат.
//
// Вью ничего не решает: активную зону присылает main (он один видит курсор, когда тот ушёл на
// страницу — см. DropZoneManager.ts). Здесь только подсветка и подпись, потому что у одного
// дропа два исхода, и человек должен видеть, какой получит, ДО того как отпустит.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './styles/global.css';

// Что подсвечивать. Стороны разведены ради честной картинки: подсветить оба края и написать
// подпись дважды значило бы соврать, куда попадёт вкладка. Держать в синхроне с ZoneVisual
// в electron/DropZoneManager.ts.
//
// 'adopt' рисуется в окне-ПРИЁМНИКЕ: вкладку тащат из другого окна, и подсказка нужна там, куда
// смотрит человек. Зона у него одна на всю страницу — делить её на края незачем, исход всего один.
type ZoneVisual = 'split-left' | 'split-right' | 'window' | 'adopt';

import type { DragCard, SplitSwapHint } from '../shared/ipc';
import { SplitDragCard, SPLIT_DRAG_CARD_WIDTH } from './components/SplitDragCard';

declare global {
  interface Window {
    dropzones: {
      onZone: (cb: (zone: ZoneVisual | null) => void) => () => void;
      onSwapHint: (cb: (hint: SplitSwapHint | null) => void) => () => void;
      onCursor: (cb: (pos: { x: number; y: number } | null) => void) => () => void;
      onThumb: (cb: (thumb: string | null) => void) => () => void;
      onTabDrag: (cb: (t: { width: number; height: number; card: DragCard | null } | null) => void) => () => void;
    };
  }
}

// Держать в синхроне со SPLIT_EDGE_RATIO в electron/DropZoneManager.ts: main по этой доле решает,
// а вью по ней же рисует. Разъедутся — подсветка будет обещать не то, что произойдёт.
const SPLIT_EDGE_RATIO = 0.35;

// ⚠️ Прямоугольник задаёт вызывающий целиком, а не «во всю высоту оверлея»: у зон в режиме сплита
// он будет считаться по реальным панелям, а не по долям всей области (см. заход про замену панели).
function Zone({ label, active, rect }: {
  label: string; active: boolean;
  rect: { left: number; top: number; width: number; height: number };
}) {
  return (
    <div style={{
      position: 'absolute',
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Неактивная зона — едва заметная подсказка, что тут вообще что-то есть; активная
      // заливается акцентом. Анимируем только цвет и прозрачность (см. правило про анимации).
      background: active ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
      border: active ? '2px dashed var(--accent)' : '2px dashed transparent',
      borderRadius: 'var(--radius-card)',
      transition: 'background 120ms var(--ease-standard), border-color 120ms var(--ease-standard)',
    }}>
      <div style={{
        padding: '8px 14px', borderRadius: 'var(--radius-pill)',
        background: 'var(--accent)', color: 'var(--on-accent)',
        fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)',
        boxShadow: 'var(--shadow-pop)',
        opacity: active ? 1 : 0,
        transition: 'opacity 120ms var(--ease-standard)',
      }}>
        {label}
      </div>
    </div>
  );
}

// Карточка несомой панели — ровно та же, что чром рисует над собой (src/App.tsx): жест один, и на
// границе области контента карточка обязана перетекать незаметно, а не подменяться другой.
//
// ⚠️ transition на transform внешнего узла — не украшение. Координаты приезжают из чрома через
// IPC, то есть с опозданием на кадр-другой; без сглаживания карточка дёргалась бы рывками. С ним
// отставание читается как инерция вещи в руке.
function DragGhost({ x, y, thumb, favicon, title, label }: {
  x: number; y: number; thumb: string | null; favicon: string | null; title: string; label: string | null;
}) {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0,
      // Держим за верхний край по центру — так же, как схватили панель за её шапку.
      transform: `translate(${x - SPLIT_DRAG_CARD_WIDTH / 2}px, ${y + 14}px)`,
      transition: 'transform 70ms linear',
    }}>
      <SplitDragCard thumb={thumb} favicon={favicon} title={title} label={label} intro />
    </div>
  );
}

function DropZones() {
  const [zone, setZone] = useState<ZoneVisual | null>(null);
  const [swap, setSwap] = useState<SplitSwapHint | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [tab, setTab] = useState<{ width: number; height: number; card: DragCard | null } | null>(null);
  useEffect(() => window.dropzones.onZone(setZone), []);
  useEffect(() => window.dropzones.onTabDrag(setTab), []);
  useEffect(() => window.dropzones.onCursor(setCursor), []);
  useEffect(() => window.dropzones.onThumb(setThumb), []);
  // ⚠️ Снимок сбрасываем вместе с концом жеста, а не с каждой новой подсветкой: hint приезжает
  // заново на каждую смену зоны, и обнуляй мы снимок по нему — карточка мигала бы подписью.
  // Вью переживает жесты, поэтому без этого сброса следующий драг начинался бы с чужой картинки.
  useEffect(() => window.dropzones.onSwapHint((h) => {
    setSwap(h);
    if (!h) setThumb(null);
  }), []);


  // Половину сплита тащат за шапку. Тут своя, тихая манера: пунктир и подпись во всю панель —
  // язык ДРУГОГО жеста (вкладку из сайдбара кладут в первый раз и надо объяснять словами), а
  // здесь человек уже держит панель в руке и ведёт её к цели. Значит: несомую панель приглушаем,
  // цель заливаем акцентом, слова уносим на призрака под курсором — он и без того перед глазами.
  if (swap) {
    const panel = (r: typeof swap.target): React.CSSProperties => ({
      position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height,
      borderRadius: 'var(--radius-island)',
    });
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {/* ⚠️ Приглушать несомую панель больше не нужно и нечем: она вышла из раскладки, её вьюха
            скрыта, слот пустует (TabManager.applyPanelDragLayout). Пустой остров с подкрашенной
            шапкой говорит «отсюда взяли» честнее, чем любая заливка поверх живой страницы. */}
        {/* Цель: пока курсор не над ней — едва заметный кант, как подсказка, что тут вообще
            что-то есть; над ней — заливка и уверенный кант. Анимируем только цвет. */}
        <div style={{
          ...panel(swap.target),
          background: swap.zone === 'swap'
            ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
            : 'color-mix(in srgb, var(--accent) 3%, transparent)',
          boxShadow: swap.zone === 'swap'
            ? 'inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 50%, transparent)'
            : 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent)',
          transition: 'background 140ms var(--ease-standard), box-shadow 140ms var(--ease-standard)',
        }} />
        {cursor && (
          <DragGhost
            x={cursor.x} y={cursor.y}
            thumb={thumb} favicon={swap.favicon} title={swap.title}
            label={swap.zone === 'swap' ? 'Поменять местами'
              : swap.zone === 'sidebar' ? 'Вернуть в панель'
              : null}
          />
        )}
      </div>
    );
  }

  // Перетаскивание ВКЛАДКИ из сайдбара. Карточку в руке ведёт этот же оверлей — но только над
  // областью контента: над сайдбаром её рисует сам чром (там он виден, и в списке из узких строк
  // уместнее его собственный узкий призрак).
  if (tab) {
    const edgeW = Math.round(tab.width * SPLIT_EDGE_RATIO);
    const rect = (x: number, w: number) => ({ left: x, top: 0, width: w, height: tab.height });
    // Курсор приходит в координатах оверлея, то есть области контента. Отрицательный или за краем —
    // человек над сайдбаром/тулбаром, и карточку там ведёт сам чром своим призраком.
    const overContent = !!cursor
      && cursor.x >= 0 && cursor.x <= tab.width
      && cursor.y >= 0 && cursor.y <= tab.height;
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {/* Приём вкладки из другого окна — одна зона во всю страницу, без деления на края:
            разделять экран чужой вкладкой на лету мы не умеем, и обещать этого нельзя. */}
        {zone === 'adopt' ? (
          <Zone label="Перенести вкладку сюда" active rect={rect(0, tab.width)} />
        ) : (
          <>
            <Zone label="Разделить экран" active={zone === 'split-left'} rect={rect(0, edgeW)} />
            <Zone label="Открыть в новом окне" active={zone === 'window'} rect={rect(edgeW, tab.width - edgeW * 2)} />
            <Zone label="Разделить экран" active={zone === 'split-right'} rect={rect(tab.width - edgeW, edgeW)} />
          </>
        )}
        {cursor && overContent && tab.card && (
          <DragGhost
            x={cursor.x} y={cursor.y}
            thumb={null} favicon={tab.card.favicon} title={tab.card.title}
            label={null}
          />
        )}
      </div>
    );
  }

  return null;
}

createRoot(document.getElementById('root')!).render(<DropZones />);
