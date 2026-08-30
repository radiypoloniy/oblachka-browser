import { NodeResizer } from '@xyflow/react';
import { X } from 'lucide-react';
import type { GraphNodeConfig } from '../../../shared/graph';
import { NODE_TONE, graphToneVars, headerButton } from './nodeVisual';
import { RADIUS } from '../../styles/system';

// Стикер — подпись на холсте, а не узел конвейера: ни портов, ни статуса, ни кнопки
// «посчитать». Отдельный компонент, потому что общая шапка ему вся не нужна: внутри карточки
// это была ранняя ветка `return`, то есть половина файла читалась мимо неё.

export default function StickerCard({ config, selected, onPatch, onDelete }: {
  config: GraphNodeConfig;
  selected?: boolean;
  onPatch: (patch: { config: GraphNodeConfig }) => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        width: '100%', height: '100%', display: 'flex', boxSizing: 'border-box',
        padding: '10px 12px',
        // ⚠️ Свой тон (небо), а не --accent-soft. Акцент означает «нажимается» и «выбрано»;
        // подпись на холсте не то и не другое — она просто ещё одна роль в наборе.
        ...graphToneVars(NODE_TONE.sticker),
        background: 'var(--section-soft)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--section-edge)'}`,
        borderRadius: RADIUS.content,
      }}
    >
      <NodeResizer
        minWidth={160} minHeight={56} isVisible={!!selected}
        lineStyle={{ borderColor: 'var(--accent)' }}
        handleStyle={{ width: 8, height: 8, borderRadius: RADIUS.tight, background: 'var(--accent)', border: 0 }}
      />
      <textarea
        className="nodrag nowheel"
        value={config.text ?? ''}
        placeholder="Подпись к участку графа"
        onChange={(e) => onPatch({ config: { ...config, text: e.target.value } })}
        style={{
          flex: 1, resize: 'none', border: 0, outline: 'none', background: 'transparent',
          color: 'var(--text-strong)', font: 'inherit',
          fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-medium)',
          fontFamily: 'var(--font-sans)', lineHeight: 'var(--lh-snug)',
        }}
      />
      <button
        type="button" className="nodrag" onClick={onDelete} title="Удалить заметку"
        style={{ ...headerButton, alignSelf: 'flex-start' }}
      >
        <X size={13} />
      </button>
    </div>
  );
}
