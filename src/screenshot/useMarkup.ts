// Жесты разметки: тянем рамку/овал/стрелку, клик ставит текст. Без JSX.

import { useCallback, useRef, useState, type PointerEvent as RE, type RefObject } from 'react';
import { mapContainPoint, rectFromPoints, type Point, type ShotRect, type ShotTool } from '../../shared/screenshotMarkup';

export type Draft =
  | { tool: 'crop' | 'oval'; a: Point; b: Point }
  | { tool: 'arrow'; a: Point; b: Point }
  | { tool: 'text'; at: Point };

export function useMarkup(opts: {
  imgRef: RefObject<HTMLImageElement | null>;
  natural: { width: number; height: number };
  tool: ShotTool;
  enabled: boolean;
  onRect: (tool: 'crop' | 'oval', r: ShotRect) => void;
  onArrow: (a: Point, b: Point) => void;
  onText: (at: Point) => void;
}): {
  draft: Draft | null;
  onPointerDown: (e: RE<HTMLElement>) => void;
  onPointerMove: (e: RE<HTMLElement>) => void;
  onPointerUp: (e: RE<HTMLElement>) => void;
  cancelDraft: () => void;
} {
  const start = useRef<Point | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const local = useCallback((e: RE<HTMLElement>): Point | null => {
    const el = opts.imgRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return mapContainPoint(
      { width: box.width, height: box.height },
      opts.natural,
      { x: e.clientX - box.left, y: e.clientY - box.top },
    );
  }, [opts.imgRef, opts.natural]);

  const onPointerDown = useCallback((e: RE<HTMLElement>) => {
    if (!opts.enabled) return;
    const p = local(e);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (opts.tool === 'text') {
      opts.onText(p);
      return;
    }
    start.current = p;
    setDraft(opts.tool === 'arrow' ? { tool: 'arrow', a: p, b: p } : { tool: opts.tool, a: p, b: p });
  }, [local, opts]);

  const onPointerMove = useCallback((e: RE<HTMLElement>) => {
    if (!start.current) return;
    const p = local(e);
    if (!p) return;
    const a = start.current;
    if (opts.tool === 'arrow') setDraft({ tool: 'arrow', a, b: p });
    else if (opts.tool === 'crop' || opts.tool === 'oval') setDraft({ tool: opts.tool, a, b: p });
  }, [local, opts.tool]);

  const onPointerUp = useCallback((e: RE<HTMLElement>) => {
    if (!start.current) return;
    const a = start.current;
    start.current = null;
    const p = local(e) ?? a;
    setDraft(null);
    if (opts.tool === 'arrow') opts.onArrow(a, p);
    else if (opts.tool === 'crop' || opts.tool === 'oval') opts.onRect(opts.tool, rectFromPoints(a, p));
  }, [local, opts]);

  const cancelDraft = useCallback(() => {
    start.current = null;
    setDraft(null);
  }, []);

  return { draft, onPointerDown, onPointerMove, onPointerUp, cancelDraft };
}
