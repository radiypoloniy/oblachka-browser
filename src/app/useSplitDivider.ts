import { useCallback, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

/**
 * Делитель между половинами сплита: тянем — меняется доля левой панели.
 *
 * ⚠️ setPointerCapture, а не отслеживание на document: капчур удерживает pointermove на самом
 * делителе даже когда курсор уходит над нативные WebContentsViews страниц (в Electron/Aura все
 * вьюхи в одном HWND). Без него жест обрывался бы, стоило курсору заехать на страницу.
 *
 * Долю хранит модель (useBrowserModel) — она же зажимает её и отправляет в main; здесь только
 * жест и признак «сейчас тянут», по которому чром гасит указатель над страницами.
 */
export function useSplitDivider(opts: {
  contentRef: RefObject<HTMLDivElement | null>;
  onRatio: (ratio: number) => void;
}) {
  const { contentRef, onRatio } = opts;
  const [isDragging, setIsDragging] = useState(false);

  const handleDividerPointerDown = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
  }, []);

  const handleDividerPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    const container = contentRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    onRatio((e.clientX - rect.left) / rect.width);
  }, [contentRef, onRatio]);

  const handleDividerPointerUp = useCallback((_e: ReactPointerEvent) => {
    setIsDragging(false);
  }, []);

  return { isDragging, handleDividerPointerDown, handleDividerPointerMove, handleDividerPointerUp };
}
