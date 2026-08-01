import { useEffect, useState } from 'react';
import { Copy, X } from 'lucide-react';
import type { GraphNodeVersion } from '../../../shared/graph';

// Прошлые результаты узла. Смотреть и копировать — но НЕ «откатывать»: старый результат
// посчитан по старым входам, и вернуть его текущим значило бы соврать про отпечаток,
// на котором держится весь кэш прогона (см. GraphEngine). Хочешь вернуть формулировку —
// верни промпт, а результат пересчитается честно.

function formatWhen(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `сегодня в ${time}` : `${d.toLocaleDateString('ru-RU')}, ${time}`;
}

export default function NodeHistoryPanel({ graphId, nodeId, nodeTitle, current, onClose }: {
  graphId: number;
  nodeId: string;
  nodeTitle: string;
  current: string | null;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<GraphNodeVersion[] | null>(null);

  useEffect(() => {
    let alive = true;
    void window.oblako.listNodeHistory(graphId, nodeId).then((v) => { if (alive) setVersions(v); });
    return () => { alive = false; };
  }, [graphId, nodeId]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.32)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 100%)', maxHeight: '100%', display: 'flex', flexDirection: 'column',
          background: 'var(--surface-solid)', borderRadius: 'var(--radius-island)',
          boxShadow: 'var(--shadow-card)', overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flex: 'none',
            padding: '12px 14px', borderBottom: '1px solid var(--divider)',
          }}
        >
          <span style={{ fontSize: 16 }}>🕘</span>
          <span
            style={{
              flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)',
            }}
          >
            Прошлые результаты — {nodeTitle}
          </span>
          <button
            type="button" onClick={onClose} title="Закрыть"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, background: 'none', border: 0, borderRadius: '50%',
              color: 'var(--text-faint)', cursor: 'pointer',
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {current && <Version label="Сейчас" text={current} highlight />}

          {versions === null && (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>Загружаю…</div>
          )}
          {versions?.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-body)' }}>
              Прошлых результатов пока нет. Они появятся, когда узел посчитается ещё раз —
              так можно будет сравнить, что дала правка промпта.
            </div>
          )}
          {versions?.map((v) => (
            <Version key={v.at} label={formatWhen(v.at)} text={v.output} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Version({ label, text, highlight }: { label: string; text: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
            letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
            color: highlight ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          {label}
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--divider)' }} />
        <button
          type="button"
          title="Скопировать эту версию"
          onClick={() => void navigator.clipboard.writeText(text)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, background: 'none', border: 0, borderRadius: '50%',
            color: 'var(--text-faint)', cursor: 'pointer',
          }}
        >
          <Copy size={13} />
        </button>
      </div>
      <div
        style={{
          fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-body)',
          color: highlight ? 'var(--text-strong)' : 'var(--text-body)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 220, overflowY: 'auto',
        }}
      >
        {text}
      </div>
    </div>
  );
}
