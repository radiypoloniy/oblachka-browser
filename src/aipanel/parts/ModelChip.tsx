import { useEffect, useRef, useState } from 'react';
import type { AiConnectionsState } from '../contract';

/**
 * Какая модель отвечает в чате — и переключение на месте.
 *
 * ⚠️ ЧИПА НЕТ, ПОКА НЕЧЕГО ВЫБИРАТЬ. Без подключений ответ всегда локальный, и элемент, который
 * умеет ровно одно значение, — это не выбор, а лишняя строка, которую надо прочитать и понять.
 * Панель в этом состоянии выглядит ровно как до появления слоя.
 *
 * ⚠️ Меняет МАРШРУТ РОЛИ «Чат», то есть то же самое, что таблица в настройках, — просто под рукой.
 * Выбор «только для этой беседы» здесь честно не сделан: он требует протащить исключение через
 * отправку сообщения и хранение переписки, и притвориться, что переключатель локальный, когда он
 * глобальный, было бы хуже, чем не иметь его вовсе.
 *
 * ⚠️ Стоит В НИЖНЕМ РЯДУ поля ввода, а не в шапке: там, где человек действует. В шапке панели он
 * либо ужимался бы до нечитаемого, либо выталкивал крестик — та же причина, по которой полосой под
 * шапкой живёт индикатор работы (см. AiActivityPill.tsx).
 */
export function ModelChip() {
  const [state, setState] = useState<AiConnectionsState | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void window.aiPanel.aiConnections().then((s) => { if (alive) setState(s); });
    const off = window.aiPanel.onAiConnectionsChanged((s) => { if (alive) setState(s); });
    return () => { alive = false; off(); };
  }, []);

  // Клик мимо закрывает меню — иначе оно остаётся висеть поверх переписки.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  if (state === null || state.connections.length === 0) return null;

  const current = state.routing['chat'] ?? 'local';
  const chosen = state.connections.find((c) => c.id === current);
  const label = chosen?.label ?? 'На этой машине';
  const local = chosen === undefined || chosen.kind === 'local';

  const pick = (id: string): void => {
    setOpen(false);
    void window.aiPanel.setAiRoute('chat', id === 'local' ? null : id);
  };

  return (
    <div ref={box} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Кто отвечает в чате"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 9px', borderRadius: 'var(--radius-pill, 999px)',
          background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
          color: 'var(--text-body)', fontSize: 'var(--fs-xs)', cursor: 'pointer',
          maxWidth: 170, overflow: 'hidden', whiteSpace: 'nowrap',
        }}
      >
        <Dot local={local} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, color: 'var(--text-strong)' }}>
          {label}
        </span>
      </button>

      {open && (
        // ⚠️ Раскрывается ВВЕРХ: чип стоит у нижнего края панели, и вниз списку места нет.
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, minWidth: 190, zIndex: 10,
          background: 'var(--surface-solid)', border: '1px solid var(--glass-edge)',
          borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)', padding: 4,
        }}>
          <Item label="На этой машине" local checked={local} onPick={() => pick('local')} />
          {state.connections.map((c) => (
            <Item
              key={c.id}
              label={c.label}
              sub={c.model}
              local={c.kind === 'local'}
              checked={c.id === current}
              onPick={() => pick(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ⚠️ Смысл несёт и форма, а не только цвет: «здесь» — залитая точка, «облако» — кольцо. Два
 * оттенка на шести пикселях различит не каждый глаз и не каждый монитор.
 */
function Dot({ local }: { local: boolean }) {
  const color = local ? 'var(--dot-local)' : 'var(--dot-cloud)';
  return (
    <span style={{
      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
      background: local ? color : 'transparent',
      border: local ? 'none' : `1.5px solid ${color}`,
    }} />
  );
}

function Item({ label, sub, local, checked, onPick }: {
  label: string; sub?: string; local: boolean; checked: boolean; onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '7px 9px', borderRadius: 'var(--radius-sm)', border: 'none',
        background: checked ? 'var(--selected)' : 'transparent',
        color: 'var(--text-body)', fontSize: 'var(--fs-xs)', cursor: 'pointer', textAlign: 'left',
      }}
    >
      <Dot local={local} />
      <span style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{label}</span>
      {sub && <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', opacity: 0.85 }}>{sub}</span>}
    </button>
  );
}
