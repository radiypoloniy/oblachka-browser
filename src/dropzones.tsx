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

import type { SplitSwapHint } from '../shared/ipc';

declare global {
  interface Window {
    dropzones: {
      onZone: (cb: (zone: ZoneVisual | null) => void) => () => void;
      onSwapHint: (cb: (hint: SplitSwapHint | null) => void) => () => void;
    };
  }
}

// Держать в синхроне со SPLIT_EDGE_RATIO в electron/DropZoneManager.ts: main по этой доле решает,
// а вью по ней же рисует. Разъедутся — подсветка будет обещать не то, что произойдёт.
const SPLIT_EDGE_RATIO = 0.35;

// top/bottom по умолчанию растягивают зону на всю высоту (так у зон дропа вкладки); подсветка
// панели-цели задаёт свой прямоугольник целиком и эти два значения перебивает через style.
function Zone({ label, active, style }: { label: string; active: boolean; style: React.CSSProperties }) {
  return (
    <div style={{
      position: 'absolute', top: 0, bottom: 0,
      ...style,
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

function DropZones() {
  const [zone, setZone] = useState<ZoneVisual | null>(null);
  const [swap, setSwap] = useState<SplitSwapHint | null>(null);
  useEffect(() => window.dropzones.onZone(setZone), []);
  useEffect(() => window.dropzones.onSwapHint(setSwap), []);

  const edge = `${SPLIT_EDGE_RATIO * 100}%`;
  const middle = `${(1 - SPLIT_EDGE_RATIO * 2) * 100}%`;

  // Половину сплита тащат за шапку: подсвечена ровно вторая панель, и подпись обещает
  // единственный исход этого жеста над ней. Прямоугольник приходит в координатах области
  // контента, а вью накрыта ровно ею — пересчитывать нечего (см. SplitSwapHint).
  if (swap) {
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <Zone
          label="Поменять местами"
          active={swap.active}
          style={{
            left: swap.rect.x, top: swap.rect.y,
            width: swap.rect.width, height: swap.rect.height,
            bottom: 'auto',
          }}
        />
      </div>
    );
  }

  // Приём вкладки из другого окна — одна зона во всю страницу, без деления на края: разделять
  // экран чужой вкладкой на лету мы не умеем, и обещать этого нельзя.
  if (zone === 'adopt') {
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <Zone label="Перенести вкладку сюда" active style={{ left: 0, right: 0 }} />
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <Zone label="Разделить экран" active={zone === 'split-left'} style={{ left: 0, width: edge }} />
      <Zone label="Открыть в новом окне" active={zone === 'window'} style={{ left: edge, width: middle }} />
      <Zone label="Разделить экран" active={zone === 'split-right'} style={{ right: 0, width: edge }} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<DropZones />);
