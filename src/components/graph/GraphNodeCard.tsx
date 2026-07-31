import { Handle, Position } from '@xyflow/react';
import { Play, AlertCircle, Loader2, Check, Clock } from 'lucide-react';
import type { GraphNodeConfig, GraphNodeKind, GraphNodeStatus } from '../../../shared/graph';
import { NODE_KINDS } from '../../../shared/graph';

// Карточка узла на холсте. Только рисует и зовёт колбэки — вся логика прогона живёт в main
// (electron/GraphEngine.ts), здесь нет ни планирования, ни обращений к модели.

export interface GraphNodeData extends Record<string, unknown> {
  kind: GraphNodeKind;
  title: string;
  config: GraphNodeConfig;
  status: GraphNodeStatus;
  output: string | null;
  outputTitle: string | null;
  error: string | null;
  onPatch: (patch: { title?: string; config?: GraphNodeConfig }) => void;
  onRun: () => void;
}

const STATUS_TONE: Record<GraphNodeStatus, string> = {
  idle: 'var(--text-faint)',
  stale: 'var(--warning-500)',
  queued: 'var(--text-muted)',
  running: 'var(--accent)',
  // Зелёный здесь функционален по цветовому закону проекта: результат посчитан локальной
  // моделью на этой машине, ровно тот же смысл, что у --dot-local в статусе модели.
  done: 'var(--dot-local)',
  error: 'var(--danger-500)',
};

function StatusIcon({ status }: { status: GraphNodeStatus }) {
  const color = STATUS_TONE[status];
  if (status === 'running') return <Loader2 size={13} color={color} className="oblako-graph-spin" />;
  if (status === 'error') return <AlertCircle size={13} color={color} />;
  if (status === 'done') return <Check size={13} color={color} />;
  if (status === 'queued') return <Clock size={13} color={color} />;
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />;
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--divider)',
  borderRadius: 'var(--radius-sm, 8px)',
  color: 'var(--text-strong)',
  font: 'inherit',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'var(--font-sans)',
  padding: '7px 9px',
  outline: 'none',
  resize: 'vertical',
};

export default function GraphNodeCard({ data, selected }: { data: GraphNodeData; selected?: boolean }) {
  const spec = NODE_KINDS[data.kind];
  const busy = data.status === 'running' || data.status === 'queued';

  return (
    <div
      style={{
        width: 264,
        background: 'var(--surface-island)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--divider)'}`,
        borderRadius: 'var(--radius-md, 12px)',
        boxShadow: 'var(--shadow-island, 0 6px 20px -10px rgba(0,0,0,.3))',
        overflow: 'hidden',
        // nodrag на полях ввода ниже — иначе React Flow таскает узел вместо выделения текста.
      }}
    >
      {spec.inputs.map((port, i) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          style={{
            top: 46 + i * 18,
            width: 9, height: 9,
            background: 'var(--surface)',
            border: '2px solid var(--accent)',
          }}
        />
      ))}

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '9px 11px',
          borderBottom: '1px solid var(--divider)',
        }}
      >
        <StatusIcon status={data.status} />
        <span
          style={{
            fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
            letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}
        >
          {spec.label}
        </span>
        <button
          type="button"
          className="nodrag"
          onClick={data.onRun}
          disabled={busy}
          title={busy ? 'Уже в работе' : 'Посчитать этот узел и то, что его питает'}
          style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center',
            background: 'none', border: 0, padding: 3, borderRadius: 6,
            color: busy ? 'var(--text-faint)' : 'var(--text-body)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          <Play size={13} />
        </button>
      </div>

      <div style={{ padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          className="nodrag"
          value={data.title}
          placeholder="Название узла"
          onChange={(e) => data.onPatch({ title: e.target.value })}
          style={{ ...fieldStyle, background: 'transparent', border: 0, padding: 0, fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-md)' }}
        />

        {data.kind === 'source.url' && (
          <input
            className="nodrag"
            value={data.config.url ?? ''}
            placeholder="https://…"
            onChange={(e) => data.onPatch({ config: { ...data.config, url: e.target.value } })}
            style={fieldStyle}
          />
        )}

        {data.kind === 'source.note' && (
          <textarea
            className="nodrag"
            value={data.config.text ?? ''}
            placeholder="Текст, который пойдёт дальше по графу"
            rows={4}
            onChange={(e) => data.onPatch({ config: { ...data.config, text: e.target.value } })}
            style={fieldStyle}
          />
        )}

        {data.kind === 'qwen.transform' && (
          <textarea
            className="nodrag"
            value={data.config.instruction ?? ''}
            placeholder="Что сделать с тем, что придёт на вход"
            rows={4}
            onChange={(e) => data.onPatch({ config: { ...data.config, instruction: e.target.value } })}
            style={fieldStyle}
          />
        )}

        {data.error && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger-500)', lineHeight: 'var(--lh-snug)' }}>
            {data.error}
          </div>
        )}

        {data.output && (
          <div
            className="nodrag nowheel"
            style={{
              maxHeight: 132, overflowY: 'auto',
              background: 'var(--surface-sunken)',
              borderRadius: 'var(--radius-sm, 8px)',
              padding: '7px 9px',
              fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-body)',
              color: 'var(--text-body)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {data.outputTitle && (
              <div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginBottom: 4 }}>
                {data.outputTitle}
              </div>
            )}
            {data.output}
          </div>
        )}
      </div>

      {spec.outputs.map((port, i) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          style={{
            top: 46 + i * 18,
            width: 9, height: 9,
            background: 'var(--accent)',
            border: '2px solid var(--surface)',
          }}
        />
      ))}
    </div>
  );
}
