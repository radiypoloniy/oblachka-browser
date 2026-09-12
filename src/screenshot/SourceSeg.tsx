// Сегмент Страница / Окно на острове инструментов. Не settings/kit: вью снимка
// не тянет настройки, а рецепт тот же — well() и пилюля.

import type { ReactNode } from 'react';
import { RADIUS, TEXT, pad, sp, well } from '../styles/system';

export type ShotSource = 'page' | 'window';

export function SourceSeg(props: {
  value: ShotSource;
  busy: boolean;
  onChange: (next: ShotSource) => void;
}): ReactNode {
  const opts: { id: ShotSource; label: string }[] = [
    { id: 'page', label: 'Страница' },
    { id: 'window', label: 'Окно' },
  ];
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: sp(1), padding: sp(1),
      borderRadius: RADIUS.pill, ...well(RADIUS.pill),
    }}>
      {opts.map((o) => {
        const on = props.value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            disabled={props.busy}
            onClick={() => props.onChange(o.id)}
            style={{
              padding: pad(2, 4), border: 'none', borderRadius: RADIUS.pill,
              background: on ? 'var(--surface)' : 'transparent',
              boxShadow: on ? 'var(--shadow-card)' : 'none',
              color: on ? 'var(--text-strong)' : 'var(--text-muted)',
              fontWeight: on ? 650 : 450,
              fontSize: TEXT.body.fontSize,
              opacity: props.busy ? 0.6 : 1,
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}
