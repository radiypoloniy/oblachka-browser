import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { DesktopLayout } from '../../newtab/desktop';
import {
  DEFAULT_COLS, SCALE_PRESETS, computeGrid, moveItemTo, normalize, placeItems, resizeItem,
  saveDesktop, scaleOf, minSizeFor,
} from '../../newtab/desktop';
import { GEN_GHOST_ID, type GenGhost } from './GenStudio';
import { APPS } from '../aiApps';

/**
 * Модель сетки стола: геометрия, предполагаемая раскладка и жесты переноса и растягивания.
 *
 * ⚠️ Вынесено из DesktopScreen целиком, вместе с разборами. Здесь собрано всё, что зависит от
 * ЖЕСТА: раскладка считается по предполагаемому состоянию (во время переноса элемент уже стоит
 * в целевой клетке, во время растягивания уже нового размера), поэтому отпускание ничего не
 * меняет и «отпустил, а встало не туда» невозможно по построению. Разорви эту связку между
 * файлами — и правило придётся держать в голове в двух местах сразу.
 */
export function useDesktopGrid({
  layout, setLayout, width, editing, studioOpen, studioEditId, ghost, gridRef,
}: {
  layout: DesktopLayout;
  setLayout: (l: DesktopLayout) => void;
  width: number;
  editing: boolean;
  studioOpen: boolean;
  studioEditId: string | null;
  ghost: GenGhost | null;
  gridRef: React.RefObject<HTMLDivElement>;
}) {
  const [drag, setDrag] = useState<{
    id: string;
    startX: number; startY: number; dx: number; dy: number;
    // ⚠️ Позиция элемента В МОМЕНТ ЗАХВАТА. Он рисуется от неё, а не от целевой клетки: место
    // назначения меняется по ходу жеста, и элемент прыгал следом за ним, уезжая из-под курсора.
    originX: number; originY: number;
    // Клетка, в которую он встанет, если отпустить. Считается от угла самой плитки, а не от
    // курсора, — плитка примагничивается к ближайшей клетке, как иконка на springboard.
    col: number; row: number;
  } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; w: number; h: number } | null>(null);


  // Правка раскладки: сохраняем сразу — стол это косметика, отдельной кнопки «применить» тут
  // не нужно, а неожиданно потерянная перестановка раздражает сильнее лишней записи.
  // ⚠️ normalize — не косметика: у только что добавленного элемента координат ещё нет, их
  // назначает укладчик. Без записи назад сохранённая раскладка отличалась бы от увиденной, и
  // первая же смена плотности разложила бы стол не так, как он выглядел.
  const apply = (next: DesktopLayout): void => {
    const n = normalize(next);
    setLayout(n);
    saveDesktop(n);
  };

  // Колонки берутся из раскладки, а не из ширины окна (см. computeGrid): расклад не должен
  // перестраиваться от того, что окно потянули за край.
  const grid = useMemo(
    () => computeGrid(Math.max(320, width), layout.cols ?? DEFAULT_COLS, SCALE_PRESETS[scaleOf(layout)].cell),
    [width, layout.cols, layout.scale],
  );
  // ⚠️ Раскладка считается по ПРЕДПОЛАГАЕМОМУ состоянию: во время перетаскивания элемент уже
  // стоит в целевой клетке, во время растягивания — уже нового размера. Отпускание тогда ничего
  // не меняет, и «отпустил, а встало не туда» невозможно по построению.
  //
  // ⚠️ Прежней ловушки обратной связи (место считалось по раскладке, которую сам расчёт и менял,
  // отчего в конце жеста начиналась дрожь) здесь больше нет вовсе: на координатах перенос одного
  // элемента не двигает соседей, поэтому и колебаться нечему. Гистерезис, база «без элемента» и
  // порог в треть клетки уехали вместе с укладкой по порядку.
  const moved = useMemo(() => {
    if (drag) return moveItemTo(layout, drag.id, drag.col, drag.row);
    if (resizing) return resizeItem(layout, resizing.id, { w: resizing.w, h: resizing.h });
    return layout;
  }, [layout, drag, resizing]);

  // Болванка сборки подмешивается в раскладку ТОЛЬКО для показа: укладчик ставит её в первую
  // свободную клетку, как любой новый виджет, а на диск она не попадает никогда — сохраняется
  // `layout`, а не `preview`.
  const preview = useMemo(() => (
    studioOpen && ghost && !studioEditId
      ? { ...moved, items: [...moved.items, { id: GEN_GHOST_ID, kind: 'widget' as const, widget: 'gen', size: ghost.size, fill: ghost.fill }] }
      : moved
  ), [moved, studioOpen, ghost, studioEditId]);

  const { placed, rows } = useMemo(
    () => placeItems(preview.items, grid.cols, drag?.id ?? resizing?.id),
    [preview.items, grid.cols, drag?.id, resizing?.id],
  );

  // Встанет ли плитка туда, куда её тянут. Отказ (занято чем-то другого размера) виден сразу:
  // подсветки целевой клетки нет, и плитка вернётся на место — гадать после отпускания не нужно.
  const dropOk = drag ? moved !== layout : false;
  // Где рисовать контур цели. Берём МЕСТО ИЗ РАСЧЁТА, а не желаемую клетку: укладчик мог
  // подвинуть плитку (например, край сетки), и контур обязан показывать правду.
  const dropCell = useMemo(() => {
    const at = drag ? placed.find((p) => p.item.id === drag.id) : null;
    return at ?? { col: 0, row: 0, w: 1, h: 1 };
  }, [placed, drag]);

  // Пока ширина не измерена, сетки нет вовсе: показать её «как получится» и переставить через
  // кадр — это и есть та самая куча при запуске.
  const ready = width > 0;
  const step = grid.cell + grid.gap;
  // Запасная строка снизу в режиме правки — иначе положить плитку ниже последней некуда.
  const gridRows = rows + (editing ? 1 : 0);

  // Сменилась ли геометрия сетки в этом кадре (человек тянет границу окна). Плиткам в такой
  // кадр переходы противопоказаны — они обязаны встать по новой сетке немедленно, вместе с
  // контейнером. Сравнение через ref, а не состояние: лишний рендер тут ни к чему.
  const prevMetrics = useRef({ cell: grid.cell, gap: grid.gap });
  const metricsChanged = prevMetrics.current.cell !== grid.cell || prevMetrics.current.gap !== grid.gap;
  useEffect(() => { prevMetrics.current = { cell: grid.cell, gap: grid.gap }; });
  const appById = useMemo(() => new Map(APPS.map((a) => [a.id, a])), []);

  const onItemPointerDown = (e: React.PointerEvent, id: string): void => {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const at = placed.find((p) => p.item.id === id);
    setDrag({
      id,
      startX: e.clientX, startY: e.clientY, dx: 0, dy: 0,
      originX: (at?.col ?? 0) * step, originY: (at?.row ?? 0) * step,
      col: at?.col ?? 0, row: at?.row ?? 0,
    });
  };

  const onGridPointerMove = (e: React.PointerEvent): void => {
    if (drag) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      // Клетка — по УГЛУ плитки, а не по курсору: плитка примагничивается к ближайшей клетке,
      // как иконка на springboard. Курсор при этом может быть где угодно внутри плитки, и
      // широкий виджет не прыгает вбок оттого, что взяли его за правый край.
      const col = Math.round((drag.originX + dx) / step);
      const row = Math.round((drag.originY + dy) / step);
      setDrag({ ...drag, dx, dy, col, row });
      return;
    }
    if (!resizing) return;
    const box = gridRef.current?.getBoundingClientRect();
    const item = placed.find((p) => p.item.id === resizing.id);
    if (!box || !item) return;
    // Тянем от левого-верхнего угла элемента: сколько клеток укладывается до курсора.
    // ⚠️ Не меньше минимума своего типа (см. WIDGET_MIN): на плитке 1×1 у «Курса» и «Защиты»
    // содержимое налезает само на себя, и адаптацией это не лечится — там нет места под число
    // и подпись к нему. Ручка просто не даёт утянуть туда, где виджет заведомо сломается.
    const min = minSizeFor(item.item);
    const w = Math.max(min.w, Math.min(grid.cols, Math.round((e.clientX - box.left - item.col * step) / step)));
    const h = Math.max(min.h, Math.min(4, Math.round((e.clientY - box.top - item.row * step) / step)));
    if (w !== resizing.w || h !== resizing.h) setResizing({ ...resizing, w, h });
  };

  const onGridPointerUp = (): void => {
    // Применяем ровно ту раскладку, которую человек видел под рукой: пересчитывать её заново
    // другим способом — верный путь к «отпустил, а встало не туда».
    if (drag) { apply(preview); setDrag(null); }
    if (resizing) { apply(resizeItem(layout, resizing.id, { w: resizing.w, h: resizing.h })); setResizing(null); }
  };


  return {
    apply, grid, moved, preview, placed, rows, drag, resizing, setResizing,
    dropOk, dropCell, ready, step, gridRows, metricsChanged, appById,
    onItemPointerDown, onGridPointerMove, onGridPointerUp,
  };
}
