// Редактор снимка — режим той же вью, не новое окно. Жест карточки не меняется.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { overlayPlate } from '../styles/island';
import { TEXT, RADIUS, pad, sp } from '../styles/system';
import { SHOT_PAPER } from '../../shared/screenshotDecorate';
import { clampRect, cropReady, mapContainPoint, type CropFrame, type ShotTool } from '../../shared/screenshotMarkup';
import { cropShot, paintArrow, paintOval, paintText, withPaint } from './paint';
import { CropFrameView, DraftSvg } from './CropOverlay';
import { ShotBar } from './ShotBar';
import { ShotFade } from './ShotFade';
import { ShotText } from './ShotText';
import { useMarkup } from './useMarkup';
import { useShotSource } from './useShotSource';

const HINT: Record<ShotTool, string> = {
  crop: 'Вырезать — растяните рамку, поверните за кружок. Enter — обрезать.',
  oval: 'Обвести — овал цветом разметки. Не акцент палитры.',
  arrow: 'Стрелка — «посмотри сюда».',
  text: 'Кликните, куда поставить текст. Enter — готово, Esc — снять шаг.',
};

export function ShotEditor(props: {
  raw: string;
  onDone: (raw: string) => void;
  onSave: (raw: string) => void;
  onCancel: () => void;
}): ReactNode {
  const { source, working, capturing, failed, bake: applyShot, choose, pickElement, undo } = useShotSource(props.raw);
  const [tool, setTool] = useState<ShotTool>('oval');
  const [nat, setNat] = useState({ width: 1, height: 1 });
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState('');
  const [frame, setFrame] = useState<CropFrame | null>(null);
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

  const commitCrop = useCallback(() => {
    if (!frame || !cropReady(frame)) return;
    const next = frame;
    setFrame(null);
    void cropShot(working, next, next.angle).then((url) => { void bake(url); });
  }, [bake, frame, working]);

  const markup = useMarkup({
    imgRef,
    natural: nat,
    tool,
    enabled: !textAt && !busy.current && !capturing,
    onRect: (kind, r) => {
      const clamped = clampRect(r, nat);
      if (kind === 'crop') {
        if (!cropReady(clamped)) return;
        setFrame({ ...clamped, angle: 0 });
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
        if (markup.draft) { markup.cancelDraft(); return; }
        if (frame) { setFrame(null); return; }
        if (!undo()) props.onCancel();
        return;
      }
      if (e.key === 'Enter' && frame && !textAt) { e.preventDefault(); commitCrop(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (textAt) commitText();
        props.onSave(working);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [commitCrop, commitText, frame, markup, props, textAt, undo, working]);

  const resetDraft = () => { markup.cancelDraft(); setTextAt(null); setFrame(null); };

  return (
    <div style={{
      ...overlayPlate, width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
      userSelect: 'none',
    }}>
      <div
        data-shot-stage
        style={{
          flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: pad(6),
        }}
      >
        <div
          style={{
            position: 'relative', width: '100%', height: '100%',
            maxWidth: '100%', maxHeight: '100%', minWidth: 0, minHeight: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: SHOT_PAPER, padding: sp(6), boxSizing: 'border-box',
            borderRadius: RADIUS.tight,
          }}
          onPointerDown={(e) => {
            if (tool === 'crop' && frame && imgRef.current) {
              const box = imgRef.current.getBoundingClientRect();
              const hit = mapContainPoint(box, nat, { x: e.clientX - box.left, y: e.clientY - box.top });
              if (hit) setFrame(null);
            }
            markup.onPointerDown(e);
          }}
          onPointerMove={markup.onPointerMove}
          onPointerUp={markup.onPointerUp}
        >
          <ShotFade
            src={working}
            capturing={capturing}
            imgRef={imgRef}
            overlay={(
              <>
                <DraftSvg draft={markup.draft} nw={nat.width} nh={nat.height} />
                {frame && (
                  <CropFrameView
                    frame={frame}
                    nw={nat.width}
                    nh={nat.height}
                    imgRef={imgRef}
                    onChange={setFrame}
                    onCommit={commitCrop}
                  />
                )}
                {textAt && (
                  <ShotText
                    at={textAt}
                    nat={nat}
                    value={text}
                    inputRef={inputRef}
                    onChange={setText}
                    onCommit={commitText}
                    onBlur={() => {
                      if (skipBlur.current) { skipBlur.current = false; return; }
                      commitText();
                    }}
                  />
                )}
              </>
            )}
            onLoad={(e) => setNat({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: `0 ${sp(4)}px ${sp(2)}px` }}>
        <ShotBar
          source={source}
          tool={tool}
          capturing={capturing}
          frame={frame}
          onSource={(next) => { resetDraft(); choose(next); }}
          onPick={() => { resetDraft(); pickElement(); }}
          onTool={(id) => { setTool(id); resetDraft(); }}
          onDone={() => {
            if (frame && cropReady(frame)) commitCrop();
            else props.onDone(working);
          }}
        />
      </div>
      <div style={{ ...TEXT.caption, textAlign: 'center', padding: `0 ${sp(4)}px ${sp(3)}px` }}>
        {capturing ? 'Снимаем…' : failed ? 'Не удалось снять окно' : HINT[tool]}
      </div>
    </div>
  );
}
