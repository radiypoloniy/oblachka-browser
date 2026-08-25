import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import type { ContentBounds } from '../../../shared/ipc';

/**
 * Поповер, привязанный к кнопке в тулбаре: пароли, загрузки, карточка сайта, буфер.
 *
 * ⚠️ Их было ЧЕТЫРЕ КОПИИ одного и того же кода — по три блока на каждый: отправить прямоугольник
 * якоря, следить за его размером, закрыться по клику мимо. Отличались они только тем, какой канал
 * зовут, то есть дублировалась ровно механика, а не смысл. Правка в одной копии (например,
 * добавление reflow при смене ширины тулбара) до остальных доезжала не всегда — три из четырёх
 * слушают toolbarWidth, четвёртая нет.
 *
 * ⚠️ Сам поповер живёт отдельной WebContentsView в main: DOM внутри тулбара не годится, потому
 * что нативная вью страницы лежит выше любого z-index. Отсюда и разговор прямоугольниками —
 * позицию считает main, а renderer только сообщает, где сейчас якорь.
 */
export function useAnchoredPopover(opts: {
  /** Кнопка-якорь. Её прямоугольник и уезжает в main. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Открыт ли поповер прямо сейчас (флаг renderer'а). */
  open: boolean;
  /** Отправить прямоугольник якоря в main. */
  push: (b: ContentBounds) => void;
  /** Закрыть: снять флаг здесь и сказать main. Зовётся при клике мимо якоря. */
  onDismiss: () => void;
  /**
   * Величина, при изменении которой якорь мог УЕХАТЬ, не изменившись в размере.
   *
   * ⚠️ Нужна обязательно: ResizeObserver ловит изменение РАЗМЕРА, а сворачивание сайдбара двигает
   * весь тулбар по X — кнопка при этом остаётся прежней ширины, и без пересчёта поповер повисал
   * бы рядом со старым местом.
   */
  reflowKey?: unknown;
}): { pushBounds: () => void } {
  const { anchorRef, open, push, onDismiss, reflowKey } = opts;

  const pushBounds = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    push({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, [anchorRef, push]);

  useEffect(() => {
    if (!open) return;
    pushBounds();
    const el = anchorRef.current;
    if (!el) return;
    const ro = new ResizeObserver(pushBounds);
    ro.observe(el);
    return () => ro.disconnect();
    // reflowKey намеренно в зависимостях: см. разбор выше.
  }, [open, anchorRef, pushBounds, reflowKey]);

  useEffect(() => {
    if (!open) return;
    // ⚠️ Фаза ПЕРЕХВАТА (capture): клик по кнопке другого поповера обязан сначала закрыть этот,
    // а уже потом открыть свой. В фазе всплытия порядок обратный, и два поповера успевали
    // оказаться открытыми одновременно.
    const onOutsideMouseDown = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown, true);
  }, [open, anchorRef, onDismiss]);

  return { pushBounds };
}
