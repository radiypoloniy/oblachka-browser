// Рамка выреза: живая, с ручками растяжения и поворота. Черновик овала/стрелки — рядом.

import { useCallback, useRef, type PointerEvent as RE, type ReactNode, type RefObject } from 'react';
import {
  EDGE_HANDLES, SHOT_MARK, cropReady, frameCorners, handlePoint, mapContainCoords, moveCrop,
  rectFromPoints, resizeCrop, rotateCrop, rotateHandle, type CropFrame, type CropHandle,
  type EdgeHandle, type ShotRect,
} from '../../shared/screenshotMarkup';
import type { Draft } from './useMarkup';

function CropDraft({ r, nw, nh }: { r: ShotRect; nw: number; nh: number }): ReactNode {
  const hair = Math.max(1, Math.min(nw, nh) * 0.0014);
  const arm = Math.min(20, Math.max(9, Math.min(r.w, r.h) * 0.04));
  const x2 = r.x + r.w;
  const y2 = r.y + r.h;
  const corner = (x: number, y: number, dx: number, dy: number) =>
    `M${x + dx} ${y} H${x} V${y + dy}`;
  return (
    <>
      <path
        fill="color-mix(in srgb, var(--text-strong) 16%, transparent)"
        fillRule="evenodd"
        d={`M0 0h${nw}v${nh}h${-nw}z M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}z`}
      />
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none"
        stroke="rgba(0,0,0,0.2)" strokeWidth={hair} />
      <path fill="none" stroke="rgba(255,255,255,0.96)" strokeWidth={hair * 1.15} strokeLinecap="square"
        d={[
          corner(r.x, r.y, arm, arm),
          corner(x2, r.y, -arm, arm),
          corner(r.x, y2, arm, -arm),
          corner(x2, y2, -arm, -arm),
        ].join(' ')} />
    </>
  );
}

export function DraftSvg({ draft, nw, nh }: { draft: Draft | null; nw: number; nh: number }): ReactNode {
  if (!draft || nw < 1 || nh < 1) return null;
  const sw = Math.max(2, Math.round(Math.min(nw, nh) * 0.003));
  let body: ReactNode = null;
  if (draft.tool === 'crop' || draft.tool === 'oval') {
    const r = rectFromPoints(draft.a, draft.b);
    body = draft.tool === 'crop'
      ? <CropDraft r={r} nw={nw} nh={nh} />
      : <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} fill="none" stroke={SHOT_MARK} strokeWidth={sw} />;
  } else if (draft.tool === 'arrow') {
    body = (
      <line x1={draft.a.x} y1={draft.a.y} x2={draft.b.x} y2={draft.b.y}
        stroke={SHOT_MARK} strokeWidth={sw} strokeLinecap="round" />
    );
  }
  return (
    <svg viewBox={`0 0 ${nw} ${nh}`} preserveAspectRatio="xMidYMid meet" style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none',
    }}>{body}</svg>
  );
}

const CURSOR: Record<EdgeHandle, string> = {
  n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize',
  s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize', nw: 'nwse-resize',
};

function shotPoint(img: HTMLImageElement | null, natural: { width: number; height: number }, e: RE<Element>) {
  if (!img) return null;
  const box = img.getBoundingClientRect();
  return mapContainCoords(box, natural, { x: e.clientX - box.left, y: e.clientY - box.top });
}

export function CropFrameView(props: {
  frame: CropFrame;
  nw: number;
  nh: number;
  imgRef: RefObject<HTMLImageElement | null>;
  onChange: (next: CropFrame) => void;
  onCommit: () => void;
}): ReactNode {
  const drag = useRef<{ handle: CropHandle; origin: CropFrame; at: { x: number; y: number } } | null>(null);
  const { frame, nw, nh, imgRef, onChange, onCommit } = props;
  const hair = Math.max(1, Math.min(nw, nh) * 0.0014);
  const knob = Math.max(5, Math.min(nw, nh) * 0.007);
  const corners = frameCorners(frame);
  const hole = corners.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ') + 'Z';
  const rot = rotateHandle(frame);
  const top = handlePoint(frame, 'n');

  const onMove = useCallback((e: RE<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = shotPoint(imgRef.current, { width: nw, height: nh }, e);
    if (!p) return;
    if (d.handle === 'rot') { onChange(rotateCrop(d.origin, p)); return; }
    if (d.handle === 'move') { onChange(moveCrop(d.origin, d.at, p, { width: nw, height: nh })); return; }
    onChange(resizeCrop(d.origin, d.handle, p));
  }, [imgRef, nh, nw, onChange]);

  const onUp = useCallback(() => { drag.current = null; }, []);

  const start = (handle: CropHandle, e: RE<SVGElement>) => {
    const p = shotPoint(imgRef.current, { width: nw, height: nh }, e);
    if (!p) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture(e.pointerId);
    drag.current = { handle, origin: frame, at: p };
  };

  if (!cropReady(frame)) return null;

  return (
    <svg viewBox={`0 0 ${nw} ${nh}`} preserveAspectRatio="xMidYMid meet" style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible',
    }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <path
        fill="color-mix(in srgb, var(--text-strong) 16%, transparent)"
        fillRule="evenodd"
        d={`M0 0h${nw}v${nh}h${-nw}z ${hole}`}
        style={{ pointerEvents: 'none' }}
      />
      <polygon
        points={corners.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="transparent"
        stroke="rgba(255,255,255,0.95)"
        strokeWidth={hair}
        style={{ pointerEvents: 'auto', cursor: 'move' }}
        onPointerDown={(e) => start('move', e)}
        onDoubleClick={(e) => { e.stopPropagation(); onCommit(); }}
      />
      <line x1={top.x} y1={top.y} x2={rot.x} y2={rot.y}
        stroke="rgba(255,255,255,0.9)" strokeWidth={hair} style={{ pointerEvents: 'none' }} />
      <circle cx={rot.x} cy={rot.y} r={knob * 1.15} fill="#fff" stroke="rgba(0,0,0,0.45)" strokeWidth={hair}
        style={{ pointerEvents: 'auto', cursor: 'grab' }}
        onPointerDown={(e) => start('rot', e)} />
      {EDGE_HANDLES.map((id) => {
        const p = handlePoint(frame, id);
        return (
          <rect
            key={id}
            x={p.x - knob}
            y={p.y - knob}
            width={knob * 2}
            height={knob * 2}
            rx={knob * 0.35}
            fill="#fff"
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={hair}
            style={{ pointerEvents: 'auto', cursor: CURSOR[id] }}
            onPointerDown={(e) => start(id, e)}
          />
        );
      })}
    </svg>
  );
}
