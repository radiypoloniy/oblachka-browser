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

declare global {
  interface Window {
    dropzones: { onZone: (cb: (zone: ZoneVisual | null) => void) => () => void };
  }
}

// Держать в синхроне со SPLIT_EDGE_RATIO в electron/DropZoneManager.ts: main по этой доле решает,
// а вью по ней же рисует. Разъедутся — подсветка будет обещать не то, что произойдёт.
const SPLIT_EDGE_RATIO = 0.35;

function Zone({ label, active, style }: { label: string; active: boolean; style: React.CSSProperties }) {
  return (
    <div style={{
      ...style,
      position: 'absolute', top: 0, bottom: 0,
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
  useEffect(() => window.dropzones.onZone(setZone), []);

  const edge = `${SPLIT_EDGE_RATIO * 100}%`;
  const middle = `${(1 - SPLIT_EDGE_RATIO * 2) * 100}%`;

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
