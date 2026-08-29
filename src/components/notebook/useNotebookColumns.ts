import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

// Ширины боковых колонок блокнота. ⚠️ Вилки узкие намеренно, по той же причине, что у сайдбара:
// колонка источников — это список заголовков, и её ширина решает, сколько букв названия влезло в
// строку; колонка Студии — пять строк действий, ей ширина не нужна вовсе. Верхние границы держат
// центр (чат) достаточно широким, чтобы в нём можно было читать.
const LEFT_MIN = 220;
const LEFT_MAX = 420;
const LEFT_DEFAULT = 280;   // прежнее жёсткое значение — оно же дефолт
const RIGHT_MIN = 240;
const RIGHT_MAX = 440;
const RIGHT_DEFAULT = 300;  // прежнее жёсткое значение

const KEY = 'oblako-notebook-columns';

/** Какая ручка сейчас в руке. Их две, и обе ведут себя одинаково — отсюда общий жест. */
type Side = 'left' | 'right';

interface Widths { left: number; right: number }

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

function load(): Widths {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Widths> | null;
    if (raw && Number.isFinite(raw.left) && Number.isFinite(raw.right)) {
      return {
        left: clamp(raw.left as number, LEFT_MIN, LEFT_MAX),
        right: clamp(raw.right as number, RIGHT_MIN, RIGHT_MAX),
      };
    }
  } catch { /* приватный режим/выключенный storage — просто дефолт */ }
  return { left: LEFT_DEFAULT, right: RIGHT_DEFAULT };
}

/**
 * Подвижные границы трёх колонок блокнота.
 *
 * ⚠️ Схлопнуть колонку до нуля НЕЛЬЗЯ, и это решение, а не недоделка: тот же закон, что у
 * сайдбара. Исчезнувшую колонку человек не может вернуть тем же жестом, которым убрал, — ручка
 * пропадает вместе с ней. Поэтому минимум есть, а полного исчезновения нет.
 *
 * ⚠️ pointermove слушается на ДОКУМЕНТЕ, а не на самой ручке: увести курсор с полоски в 8 px
 * проще простого, и без этого жест рвался бы на первом быстром движении. setPointerCapture здесь
 * не нужен — блокнот целиком живёт в одной React-вью, нативных WebContentsView внутри нет, и
 * курсор от нас никто не забирает (в отличие от разделителя сплита, см. useSplitPanelDrag).
 */
export function useNotebookColumns(): {
  left: number;
  right: number;
  onGripDown: (side: Side) => (e: ReactPointerEvent) => void;
  resizing: boolean;
} {
  const [widths, setWidths] = useState<Widths>(load);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ side: Side; startX: number; startW: number } | null>(null);

  // Свежие ширины для обработчика отпускания: он заведён один раз и замкнул бы стартовое значение.
  const ref = useRef(widths);
  ref.current = widths;

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const d = drag.current;
      if (!d) return;
      e.preventDefault();
      // ⚠️ Правая ручка тянется В ОБРАТНУЮ сторону: колонка растёт, когда курсор идёт влево.
      const delta = d.side === 'left' ? e.clientX - d.startX : d.startX - e.clientX;
      const next = d.side === 'left'
        ? clamp(d.startW + delta, LEFT_MIN, LEFT_MAX)
        : clamp(d.startW + delta, RIGHT_MIN, RIGHT_MAX);
      setWidths((cur) => (cur[d.side] === next ? cur : { ...cur, [d.side]: next }));
    };
    const onUp = (): void => {
      if (!drag.current) return;
      drag.current = null;
      setResizing(false);
      document.body.style.cursor = '';
      // Пишем на диск ТОЛЬКО в конце жеста: на каждое движение это была бы сотня записей в секунду.
      try { localStorage.setItem(KEY, JSON.stringify(ref.current)); } catch { /* см. load */ }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, []);

  return {
    left: widths.left,
    right: widths.right,
    resizing,
    onGripDown: (side) => (e) => {
      e.preventDefault();
      drag.current = { side, startX: e.clientX, startW: widths[side] };
      setResizing(true);
      document.body.style.cursor = 'col-resize';
    },
  };
}
