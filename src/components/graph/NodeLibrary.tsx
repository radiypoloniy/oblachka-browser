import { NODE_KINDS, type GraphNodeKind } from '../../../shared/graph';
import { NODE_GROUPS, NodeIcon } from './nodeVisual';

// Библиотека узлов: что можно положить на холст.
//
// Вынесена из GraphCanvas отдельным компонентом — она самодостаточна (знает только про виды
// узлов и один колбэк) и потому меняет форму независимо от холста.

export default function NodeLibrary({ onAdd }: { onAdd: (kind: GraphNodeKind) => void }) {
  return (
    <>
      {NODE_GROUPS.map((group, gi) => (
            <div key={group.title} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {gi > 0 && (
                <span style={{ width: 1, height: 20, background: 'var(--divider)', marginRight: 3 }} />
              )}
              <span
                style={{
                  fontSize: 'var(--fs-xs)', letterSpacing: 'var(--ls-caps)',
                  textTransform: 'uppercase', color: 'var(--text-faint)', marginRight: 1,
                }}
              >
                {group.title}
              </span>
              {group.kinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onAdd(kind)}
                  title={NODE_KINDS[kind].hint}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
                    borderRadius: 'var(--radius-chip)', padding: '5px 10px', cursor: 'pointer',
                    color: 'var(--text-body)', font: 'inherit',
                    fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
                  }}
                >
                  <NodeIcon kind={kind} size={15} />
                  {NODE_KINDS[kind].label}
                </button>
              ))}
            </div>
      ))}
    </>
  );
}
