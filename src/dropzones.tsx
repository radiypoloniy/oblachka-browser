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
// 'replace-*' приходят только когда сплит уже на экране: над панелью единственный осмысленный
// исход — занять её место, и рисуется он по РЕАЛЬНОМУ прямоугольнику панели (её ширину человек
// сам задал разделителем), а не по доле области контента.
type ZoneVisual = 'split-left' | 'split-right' | 'window' | 'adopt' | 'replace-left' | 'replace-right';

// Готовые прямоугольники зон — их считает main (см. DropZoneManager.zonesForOverlay). Вью не
// вычисляет раскладку сама: раньше она делила ширину на фиксированные доли и в режиме сплита
// обещала не то, что произойдёт.
interface TabDragPayload {
  width: number;
  height: number;
  card: DragCard | null;
  // Как область контента выглядит СЕЙЧАС: один остров или два (сплит). Исходное положение
  // превью — острова переезжают из него в будущую раскладку, а не возникают на пустом месте.
  islands: Array<{ x: number; y: number; width: number; height: number }>;
}

// Подпись зоны — единственное, что остаётся на стороне вью: слова человеку показывает интерфейс,
// а не main.
const ZONE_LABEL: Record<ZoneVisual, string> = {
  'split-left': 'Разделить экран',
  'split-right': 'Разделить экран',
  'window': 'Открыть в новом окне',
  'adopt': 'Перенести вкладку сюда',
  'replace-left': 'Заменить панель',
  'replace-right': 'Заменить панель',
};

import type { DragCard, SplitSwapHint } from '../shared/ipc';
// Тот же зазор между островами, что и в раскладке окна: превью обязано совпасть с тем, что
// человек получит, вплоть до щели между панелями.
import { ISLAND_GAP } from '../shared/layout';
import { SplitDragCard, SPLIT_DRAG_CARD_WIDTH } from './components/SplitDragCard';

declare global {
  interface Window {
    dropzones: {
      onZone: (cb: (zone: ZoneVisual | null) => void) => () => void;
      onSwapHint: (cb: (hint: SplitSwapHint | null) => void) => () => void;
      onCursor: (cb: (pos: { x: number; y: number } | null) => void) => () => void;
      onThumb: (cb: (thumb: string | null) => void) => () => void;
      onTabDrag: (cb: (t: TabDragPayload | null) => void) => () => void;
    };
  }
}

// ⚠️ Здесь стояла копия SPLIT_EDGE_RATIO из electron/DropZoneManager.ts — доля, по которой main
// решал, а вью рисовала. Копию приходилось держать в синхроне руками, и разъехаться ей значило
// обещать человеку не то, что произойдёт. Теперь раскладку целиком считает main и присылает
// готовыми прямоугольниками (см. TabDragPayload.zones): синхронизировать больше нечего.

type Rect = { x: number; y: number; width: number; height: number };

// Подпись исхода. Живёт внутри острова-получателя, а не отдельным пунктирным прямоугольником:
// показывать надо ОДИН ответ на вопрос «что будет», а не три одновременно.
function Label({ text }: { text: string }) {
  return (
    <div style={{
      padding: '8px 14px', borderRadius: 'var(--radius-pill)',
      background: 'var(--accent)', color: 'var(--on-accent)',
      fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)',
      boxShadow: 'var(--shadow-pop)',
      whiteSpace: 'nowrap',
    }}>
      {text}
    </div>
  );
}

// Остров превью. 'page' — страница, которая уже на экране (её место может измениться —
// например, при разделении она ужимается в половину); 'target' — место, куда попадёт несомая
// вкладка.
//
// ⚠️ Переходы висят на left/top/width/height нарочно, и это не противоречит правилу «анимируем
// только цвет и прозрачность». Правило про НАТИВНЫЕ вьюхи страниц: там смена размера гонит
// пересчёт вёрстки живого сайта на каждом кадре (см. TabManager.slideViews). Здесь же это пустые
// div-ы поверх, и именно их переезд показывает человеку, что раскладка перестроится.
function Island({ rect, tone, label }: { rect: Rect; tone: 'page' | 'target'; label?: string }) {
  const target = tone === 'target';
  return (
    <div style={{
      position: 'absolute',
      left: rect.x, top: rect.y, width: rect.width, height: rect.height,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: 'var(--radius-island)',
      background: target ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent',
      boxShadow: target
        ? 'inset 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent)'
        : 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 16%, transparent)',
      transition: 'left var(--dur-base) var(--ease-standard), top var(--dur-base) var(--ease-standard),'
        + ' width 180ms var(--ease-standard), height 180ms var(--ease-standard),'
        + ' background 140ms var(--ease-standard), box-shadow 140ms var(--ease-standard)',
    }}>
      {label && <Label text={label} />}
    </div>
  );
}

// Отдельное окно — не зона среди зон, а вещь другого рода: она уедет из этой раскладки вовсе.
// Поэтому и рисуется иначе — наклонённой карточкой, парящей над содержимым, а не вписанной в
// сетку островов. Наклон и парение здесь несут смысл: «этот прямоугольник не отсюда».
function FloatingWindow({ width, height }: { width: number; height: number }) {
  const w = Math.round(Math.min(width * 0.42, 380));
  const h = Math.round(Math.min(height * 0.52, w * 0.64));
  return (
    <div style={{
      position: 'absolute',
      left: width / 2, top: height / 2, width: w, height: h,
      marginLeft: -w / 2, marginTop: -h / 2,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: 'var(--radius-island)',
      background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
      boxShadow: 'inset 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent), var(--shadow-pop)',
      // Появление и парение — двумя анимациями подряд (вторая с задержкой на длину первой):
      // обе крутят transform, и одновременно они бы спорили за одно свойство.
      animation: 'dz-pop var(--dur-base) var(--ease-standard) both, dz-float 2.8s ease-in-out var(--dur-base) infinite',
    }}>
      <Label text={ZONE_LABEL.window} />
    </div>
  );
}

// Раскладка, которая получится, если отпустить прямо сейчас.
//
// ⚠️ Ключи узлов стабильные ('page-0'), и это вся суть картинки. React анимирует ОДИН И ТОТ ЖЕ
// узел из старого прямоугольника в новый — поэтому при наведении на край страница на глазах
// ужимается в половину, освобождая место, а не подменяется другим прямоугольником. Раздай мы
// ключи по зоне, каждый переезд был бы мгновенной подменой, то есть тем же щелчком, что и раньше.
function previewSlots(p: TabDragPayload, zone: ZoneVisual | null): {
  pages: Array<{ key: string; rect: Rect }>;
  target: Rect | null;
} {
  const full: Rect = { x: 0, y: 0, width: p.width, height: p.height };
  const halfW = (p.width - ISLAND_GAP) / 2;
  const leftHalf: Rect = { x: 0, y: 0, width: halfW, height: p.height };
  const rightHalf: Rect = { x: halfW + ISLAND_GAP, y: 0, width: halfW, height: p.height };
  const pages = p.islands.map((rect, i) => ({ key: `page-${i}`, rect }));

  switch (zone) {
    // Сплита ещё нет: единственная страница ужимается в противоположную половину, а несомая
    // занимает ту, к которой её ведут.
    case 'split-left':  return { pages: [{ key: 'page-0', rect: rightHalf }], target: leftHalf };
    case 'split-right': return { pages: [{ key: 'page-0', rect: leftHalf }],  target: rightHalf };
    // Сплит уже на экране: раскладка не меняется, меняется содержимое одной панели.
    case 'replace-left':  return { pages, target: p.islands[0] ?? null };
    case 'replace-right': return { pages, target: p.islands[1] ?? null };
    // Приём чужой вкладки: делить нечего, исход один на всю область.
    case 'adopt': return { pages, target: full };
    // 'window' и «ничего»: раскладка остаётся как есть. У окна свой знак — FloatingWindow.
    default: return { pages, target: null };
  }
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
      transition: 'transform var(--dur-fast) linear',
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
  const [tab, setTab] = useState<TabDragPayload | null>(null);
  useEffect(() => window.dropzones.onZone(setZone), []);
  useEffect(() => window.dropzones.onTabDrag(setTab), []);
  useEffect(() => window.dropzones.onCursor(setCursor), []);
  useEffect(() => window.dropzones.onThumb(setThumb), []);
  // ⚠️ Курсор над областью контента ставит ЭТА вью, а не чром: пока идёт жест, оверлей лежит
  // поверх страницы и хром до курсора здесь не дотягивается (у себя он делает то же самое
  // классом .oblako-dragging-tab, см. global.css). Без этих двух половин вкладка ведётся к
  // сплиту с обычной стрелкой, будто её никто не несёт.
  //
  // Половина сплита (swap) сюда не входит: там в руке миниатюра страницы, и жест ведёт свой
  // курсор через SPLIT_DRAG_CURSOR.
  useEffect(() => {
    document.body.style.cursor = tab ? 'grabbing' : '';
    return () => { document.body.style.cursor = ''; };
  }, [tab]);

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
          transition: 'background var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard)',
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
    // Курсор приходит в координатах оверлея, то есть области контента. Отрицательный или за краем —
    // человек над сайдбаром/тулбаром, и карточку там ведёт сам чром своим призраком.
    const overContent = !!cursor
      && cursor.x >= 0 && cursor.x <= tab.width
      && cursor.y >= 0 && cursor.y <= tab.height;
    const { pages, target } = previewSlots(tab, zone);
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', animation: 'dz-fade var(--dur-fast) var(--ease-standard) both' }}>
        {/* Страницы, которые уже на экране. Их прямоугольники приезжают в те места, которые они
            займут после дропа, — это и есть превью: раскладка перестраивается на глазах, до
            того как человек отпустил. */}
        {pages.map(({ key, rect }) => <Island key={key} rect={rect} tone="page" />)}
        {/* Место несомой вкладки. Ключ постоянный, поэтому при переводе курсора с края на край
            остров переезжает, а не мигает подменой. */}
        {target && zone && <Island key="target" rect={target} tone="target" label={ZONE_LABEL[zone]} />}
        {zone === 'window' && <FloatingWindow width={tab.width} height={tab.height} />}
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
