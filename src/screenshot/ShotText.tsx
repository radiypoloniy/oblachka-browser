// Подпись на кадре: поле стоит в точке клика, Голос, нейтральный чёрный.

import type { ReactNode, Ref } from 'react';
import { SHOT_FONT, SHOT_TEXT, type Point } from '../../shared/screenshotMarkup';

export function ShotText(props: {
  at: Point;
  nat: { width: number; height: number };
  value: string;
  inputRef: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
  onCommit: () => void;
  onBlur: () => void;
}): ReactNode {
  const size = Math.max(16, Math.round(Math.min(props.nat.width, props.nat.height) * 0.032));
  return (
    <input
      ref={props.inputRef}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); props.onCommit(); }
        if (e.key === 'Escape') return;
        e.stopPropagation();
      }}
      onBlur={props.onBlur}
      placeholder="подпись"
      style={{
        position: 'absolute',
        left: `${(props.at.x / props.nat.width) * 100}%`,
        top: `${(props.at.y / props.nat.height) * 100}%`,
        fontFamily: SHOT_FONT,
        fontWeight: 600,
        fontSize: `calc(${size} * 100cqw / ${props.nat.width})`,
        lineHeight: 1.2,
        color: SHOT_TEXT,
        caretColor: SHOT_TEXT,
        background: 'transparent',
        border: 'none',
        outline: 'none',
        padding: 0,
        minWidth: '8ch',
        width: `${Math.max(8, props.value.length + 2)}ch`,
        pointerEvents: 'auto',
        boxShadow: 'none',
      }}
    />
  );
}
