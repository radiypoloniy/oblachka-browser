import { X } from 'lucide-react';
import { GRAPH_TEMPLATES, type GraphTemplate } from '../../../shared/graphTemplates';

// Выбор схемы при создании воркспейса. Пустой холст остаётся первым пунктом — шаблон
// подсказка, а не обязанность.

export default function TemplatePicker({ onPick, onClose }: {
  onPick: (template: GraphTemplate | null) => void;
  onClose: () => void;
}) {
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
          width: 'min(620px, 100%)', maxHeight: '100%', display: 'flex', flexDirection: 'column',
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
          <span style={{ fontSize: 16 }}>🧩</span>
          <span style={{ flex: 1, fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>
            С чего начать
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

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Row
            emoji="⬜"
            label="Пустой холст"
            summary="Соберу схему сам"
            onClick={() => onPick(null)}
          />
          <div style={{ height: 1, background: 'var(--divider)', margin: '6px 2px' }} />
          {GRAPH_TEMPLATES.map((t) => (
            <Row
              key={t.id}
              emoji={t.emoji}
              label={t.label}
              summary={t.summary}
              onClick={() => onPick(t)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ emoji, label, summary, onClick }: {
  emoji: string; label: string; summary: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%',
        padding: '11px 12px', borderRadius: 'var(--radius-sm)',
        background: 'var(--surface-sunken)', border: '1px solid transparent',
        cursor: 'pointer', font: 'inherit', fontFamily: 'var(--font-sans)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
    >
      <span style={{ fontSize: 20, flex: 'none' }}>{emoji}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-medium)', color: 'var(--text-strong)' }}>
          {label}
        </span>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{summary}</span>
      </span>
    </button>
  );
}
