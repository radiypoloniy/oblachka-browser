import { useEffect, useState } from 'react';
import type { AiConnectionsState } from '../../../shared/ipc';
import { InlineHint } from './kit';

export function PresetModelField({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [state, setState] = useState<AiConnectionsState | null>(null);
  useEffect(() => {
    let alive = true, received = false;
    const off = window.oblako.onAiConnectionsChanged(s => { received = true; setState(s); });
    void window.oblako.aiConnections().then(s => { if (alive && !received) setState(s); });
    return () => { alive = false; off(); };
  }, []);
  return <label style={{ display: 'grid', gap: 8 }}>
    <InlineHint>Модель набора</InlineHint>
    <select aria-label="Модель набора" value={value} onChange={e => onChange(e.target.value)}
      style={{ padding: '8px 12px', border: '1px solid var(--divider)', borderRadius: 'var(--radius-sm)',
        background: 'transparent', color: 'var(--text-body)', fontSize: 'var(--fs-sm)' }}>
      <option value="">Общий выбор для чата</option>
      <option value="local">Встроенная локальная модель</option>
      {state?.connections.map(c => <option key={c.id} value={c.id} disabled={!state.ready.includes(c.id)}>
        {c.label} · {c.model}{state.ready.includes(c.id) ? '' : ' — нет ключа'}
      </option>)}
      {value && value !== 'local' && !state?.connections.some(c => c.id === value) &&
        <option value={value}>Подключение недоступно</option>}
    </select>
    <InlineHint>Закреплённая модель используется только для этого набора. Смена модели начинает его беседы заново.</InlineHint>
  </label>;
}
