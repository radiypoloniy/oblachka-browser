// Редактор снимка — режим той же вью, не новое окно. Жест карточки не меняется.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, Crop, Circle, Scan, Type } from 'lucide-react';
import { overlayPlate } from '../styles/island';
import { ICON, RADIUS, TEXT, glyph, pad, sp } from '../styles/system';
import { SHOT_PAPER } from '../../shared/screenshotDecorate';
import { SHOT_MARK, clampRect, cropReady, rectFromPoints, type ShotTool } from '../../shared/screenshotMarkup';
import { cropShot, paintArrow, paintOval, paintText, withPaint } from './paint';
import { SourceSeg } from './SourceSeg';
import { useMarkup, type Draft } from './useMarkup';
import { useShotSource } from './useShotSource';

const HINT: Record<ShotTool, string> = {
  crop: 'Вырезать — рамка по кадру. Вьюпорт, не вся прокрутка.',
  oval: 'Обвести — овал цветом разметки. Не акцент палитры.',
  arrow: 'Стрелка — «посмотри сюда».',
  text: 'Текст. Enter — готово, Esc — снять подпись, не редактор.',
};

function DraftSvg({ draft, nw, nh }: { draft: Draft | null; nw: number; nh: number }): ReactNode {
  if (!draft || nw < 1 || nh < 1) return null;
  const sw = Math.max(3, Math.round(Math.min(nw, nh) * 0.006));
  let body: React.ReactNode = null;
  if (draft.tool === 'crop' || draft.tool === 'oval') {
    const r = rectFromPoints(draft.a, draft.b);
    body = draft.tool === 'crop'
      ? <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="var(--accent)" strokeWidth={sw} strokeDasharray={`${sw * 3} ${sw * 2}`} />
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

export function ShotEditor(props: {
  raw: string;
  onDone: (raw: string) => void;
  onSave: (raw: string) => void;
  onCancel: () => void;
}): ReactNode {
  const { source, working, capturing, failed, bake: applyShot, choose, pickElement } = useShotSource(props.raw);
  const [tool, setTool] = useState<ShotTool>('oval');
  const [nat, setNat] = useState({ width: 1, height: 1 });
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState('');
  const imgRef = useRef<HTMLImageElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const skipBlur = useRef(false);

  useEffect(() => { if (textAt) inputRef.current?.focus(); }, [textAt]);

  const bake = useCallback(async (next: string) => {
    busy.current = true;
    applyShot(next);
    busy.current = false;
  }, [applyShot]);

  const markup = useMarkup({
    imgRef,
    natural: nat,
    tool,
    enabled: !textAt && !busy.current && !capturing,
    onRect: (kind, r) => {
      const clamped = clampRect(r, nat);
      if (kind === 'crop') {
        if (!cropReady(clamped)) return;
        void cropShot(working, clamped).then((url) => { void bake(url); });
        return;
      }
      void withPaint(working, (ctx, min) => paintOval(ctx, clamped, min)).then((url) => { void bake(url); });
    },
    onArrow: (a, b) => {
      void withPaint(working, (ctx, min) => paintArrow(ctx, a, b, min)).then((url) => { void bake(url); });
    },
    onText: (at) => { setText(''); setTextAt(at); },
  });

  const commitText = useCallback(() => {
    const at = textAt;
    const value = text;
    setTextAt(null);
    setText('');
    if (!at || !value.trim()) return;
    void withPaint(working, (ctx, min) => paintText(ctx, at, value, min)).then((url) => { void bake(url); });
  }, [bake, text, textAt, working]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (textAt) { skipBlur.current = true; setTextAt(null); setText(''); markup.cancelDraft(); return; }
        props.onCancel();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (textAt) commitText();
        props.onSave(working);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commitText, markup, props, textAt, working]);

  const g = glyph(ICON.md);
  const tools: { id: ShotTool; label: string; icon: React.ReactNode }[] = [
    { id: 'crop', label: 'Вырезать', icon: <Crop {...g} /> },
    { id: 'oval', label: 'Обвести', icon: <Circle {...g} /> },
    { id: 'arrow', label: 'Стрелка', icon: <ArrowUpRight {...g} /> },
    { id: 'text', label: 'Текст', icon: <Type {...g} /> },
  ];

  return (
    <div style={{
      ...overlayPlate, width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
    }}>
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: pad(6),
      }}>
        <div
          style={{
            position: 'relative', maxWidth: '100%', maxHeight: '100%',
            background: SHOT_PAPER, padding: sp(6), boxSizing: 'border-box',
            borderRadius: RADIUS.tight,
          }}
          onPointerDown={markup.onPointerDown}
          onPointerMove={markup.onPointerMove}
          onPointerUp={markup.onPointerUp}
        >
          <img
            ref={imgRef}
            src={working}
            alt=""
            onLoad={(e) => setNat({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            style={{
              display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 160px)',
              objectFit: 'contain', borderRadius: RADIUS.box,
              boxShadow: 'var(--shadow-lvl2)', pointerEvents: 'none',
            }}
          />
          <DraftSvg draft={markup.draft} nw={nat.width} nh={nat.height} />
          {textAt && (
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitText(); }
                e.stopPropagation();
              }}
              onBlur={() => {
                if (skipBlur.current) { skipBlur.current = false; return; }
                commitText();
              }}
              placeholder="подпись"
              style={{
                position: 'absolute', left: '12%', top: '12%',
                ...TEXT.body, fontWeight: 700, color: SHOT_MARK,
                background: 'var(--surface)', border: '1.5px solid var(--divider-strong)',
                borderRadius: RADIUS.control, padding: pad(1, 2), minWidth: 160,
              }}
            />
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: `0 ${sp(4)}px ${sp(2)}px` }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: sp(1),
          padding: sp(1), borderRadius: RADIUS.pill,
          background: 'var(--surface)', boxShadow: 'var(--shadow-lvl2), var(--inner-light)',
        }}>
          <SourceSeg
            value={source}
            busy={capturing}
            onChange={(next) => { markup.cancelDraft(); setTextAt(null); choose(next); }}
          />
          <button
            type="button"
            title="Элемент"
            disabled={capturing}
            onClick={() => { markup.cancelDraft(); setTextAt(null); pickElement(); }}
            style={{
              width: 32, height: 32, border: 'none', borderRadius: RADIUS.pill,
              background: 'transparent', color: 'var(--text-muted)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              opacity: capturing ? 0.6 : 1,
            }}
          ><Scan {...g} /></button>
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              onClick={() => { setTool(t.id); markup.cancelDraft(); setTextAt(null); }}
              style={{
                width: 32, height: 32, border: 'none', borderRadius: RADIUS.pill,
                background: tool === t.id ? 'var(--selected)' : 'transparent',
                color: tool === t.id ? 'var(--accent)' : 'var(--text-muted)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >{t.icon}</button>
          ))}
          <button
            type="button"
            onClick={() => props.onDone(working)}
            style={{
              border: 'none', background: 'var(--text-strong)', color: 'var(--app-bg)',
              padding: pad(2, 4), borderRadius: RADIUS.pill, fontWeight: 650, fontSize: TEXT.body.fontSize,
              marginLeft: sp(1),
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: sp(1) }}>
              <Check {...glyph(ICON.sm)} /> Готово
            </span>
          </button>
        </div>
      </div>
      <div style={{ ...TEXT.caption, textAlign: 'center', padding: `0 ${sp(4)}px ${sp(3)}px` }}>
        {capturing ? 'Снимаем окно…' : failed ? 'Не удалось снять окно' : HINT[tool]}
      </div>
    </div>
  );
}
