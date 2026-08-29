import { Copy, Check } from 'lucide-react'

// Чип «скопировать значение» — общий для пипетки и котёнка.
export function CopyChip({ label, copied, onCopy }: { label: string; copied: boolean; onCopy: () => void }) {
  return (
    <button
      onClick={onCopy}
      title="Скопировать"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        flex: 1, minWidth: 0, padding: '7px 10px',
        borderRadius: 'var(--radius-sm)', border: 'none',
        background: 'var(--surface-sunken)', color: 'var(--text-body)',
        fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)', cursor: 'pointer',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {copied
        ? <Check size={12} style={{ color: 'var(--success-500)', flexShrink: 0 }} />
        : <Copy size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />}
    </button>
  )
}
