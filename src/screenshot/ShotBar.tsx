// Нижняя пилюля редактора снимка. Вынесена, чтобы ShotEditor не перерос порог функции.

import type { ReactNode } from 'react';
import { ArrowUpRight, Check, Crop, Circle, Scan, Type } from 'lucide-react';
import { ICON, RADIUS, TEXT, glyph, pad, sp } from '../styles/system';
import { cropReady, type CropFrame, type ShotTool } from '../../shared/screenshotMarkup';
import { SourceSeg } from './SourceSeg';
import type { ShotSource } from './SourceSeg';

export function ShotBar(props: {
  source: ShotSource;
  tool: ShotTool;
  capturing: boolean;
  frame: CropFrame | null;
  onSource: (next: ShotSource) => void;
  onPick: () => void;
  onTool: (id: ShotTool) => void;
  onDone: () => void;
}): ReactNode {
  const g = glyph(ICON.md);
  const tools: { id: ShotTool; label: string; icon: ReactNode }[] = [
    { id: 'crop', label: 'Вырезать', icon: <Crop {...g} /> },
    { id: 'oval', label: 'Обвести', icon: <Circle {...g} /> },
    { id: 'arrow', label: 'Стрелка', icon: <ArrowUpRight {...g} /> },
    { id: 'text', label: 'Текст', icon: <Type {...g} /> },
  ];
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: sp(1),
      padding: sp(1), borderRadius: RADIUS.pill,
      background: 'var(--surface)', boxShadow: 'var(--shadow-lvl2), var(--inner-light)',
    }}>
      <SourceSeg value={props.source} busy={props.capturing} onChange={props.onSource} />
      <button
        type="button"
        title="Элемент"
        disabled={props.capturing}
        onClick={props.onPick}
        style={{
          width: 32, height: 32, border: 'none', borderRadius: RADIUS.pill,
          background: 'transparent', color: 'var(--text-muted)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          opacity: props.capturing ? 0.6 : 1,
        }}
      ><Scan {...g} /></button>
      {tools.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.label}
          onClick={() => props.onTool(t.id)}
          style={{
            width: 32, height: 32, border: 'none', borderRadius: RADIUS.pill,
            background: props.tool === t.id ? 'var(--selected)' : 'transparent',
            color: props.tool === t.id ? 'var(--accent)' : 'var(--text-muted)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >{t.icon}</button>
      ))}
      <button
        type="button"
        onClick={props.onDone}
        style={{
          border: 'none', background: 'var(--text-strong)', color: 'var(--app-bg)',
          padding: pad(2, 4), borderRadius: RADIUS.pill, fontWeight: 650, fontSize: TEXT.body.fontSize,
          marginLeft: sp(1),
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: sp(1) }}>
          <Check {...glyph(ICON.sm)} /> {props.frame && cropReady(props.frame) ? 'Обрезать' : 'Готово'}
        </span>
      </button>
    </div>
  );
}
