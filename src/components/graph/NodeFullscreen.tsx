import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, Copy, Download, History, Play } from 'lucide-react';
import type { GraphNodeKind, GraphNodeStatus } from '../../../shared/graph';
import { NODE_KINDS } from '../../../shared/graph';
import { markdownComponents } from '../aiMarkdown';
import { InfographicView, MindmapView, QuizView } from '../studioViews';
import NodeChatView from './NodeChatView';

// Раскрытый узел — один общий механизм на все типы, а не три похожих режима.
// Внутри меняется только содержимое: артефакт рисуется своим рендерером, текст — разметкой,
// промпт картинки — сырой строкой для копирования. Сюда же со временем встанут чат и сайт.
//
// Вторичные действия (скопировать, сохранить, история) живут ЗДЕСЬ, а не в карточке: в шапке
// узла шириной 268 px семь кнопок не помещаются, а раскрытый узел — это рабочее место, где
// место есть. В карточке остаётся то, что нужно прямо на холсте: посчитать, дублировать,
// раскрыть, удалить.

interface Props {
  graphId: number;
  nodeId: string;
  kind: GraphNodeKind;
  title: string;
  status: GraphNodeStatus;
  output: string | null;
  outputTitle: string | null;
  error: string | null;
  onClose: () => void;
  onRun: () => void;
  onCopyOutput: () => void;
  onSaveOutput: () => void;
  onShowHistory: () => void;
}

const headerButton: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, flex: 'none', padding: 0,
  background: 'none', border: 0, borderRadius: '50%',
  color: 'var(--text-body)', cursor: 'pointer',
};

export default function NodeFullscreen({
  graphId, nodeId, kind, title, status, output, outputTitle, error,
  onClose, onRun, onCopyOutput, onSaveOutput, onShowHistory,
}: Props) {
  const spec = NODE_KINDS[kind];
  const busy = status === 'running' || status === 'queued';

  // Esc возвращает к холсту — привычный выход из полноэкранного режима.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 15,
        display: 'flex', flexDirection: 'column',
        // У диалога — белый лист, как у чата в AI-панели и на странице. Остальные типы
        // остаются на фоне приложения: там содержимое само лежит на карточках.
        // Диалог — белый лист, как чат на странице; остальным нужен «колодец», на котором
        // читаются белые карточки артефактов (тот же тон, что у холста).
        background: kind === 'qwen.chat' ? 'var(--surface-solid)' : 'var(--surface-sunken)',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, flex: 'none',
          padding: '10px 14px', borderBottom: '1px solid var(--divider-strong)',
          background: 'var(--surface-solid)',
        }}
      >
        <button type="button" onClick={onClose} title="Вернуться к графу (Esc)" style={headerButton}>
          <ArrowLeft size={17} />
        </button>
        <span style={{ fontSize: 17, flex: 'none' }}>{spec.emoji}</span>
        <span
          style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)',
          }}
        >
          {title || spec.label}
        </span>

        <button
          type="button" onClick={onRun} disabled={busy}
          title={busy ? 'Уже в работе' : 'Посчитать заново'}
          style={{ ...headerButton, color: busy ? 'var(--text-faint)' : 'var(--text-body)' }}
        >
          <Play size={15} />
        </button>
        {output && (
          <>
            <button type="button" onClick={onCopyOutput} title="Скопировать результат" style={headerButton}>
              <Copy size={15} />
            </button>
            <button type="button" onClick={onSaveOutput} title="Сохранить в файл" style={headerButton}>
              <Download size={15} />
            </button>
            <button type="button" onClick={onShowHistory} title="Прошлые результаты" style={headerButton}>
              <History size={15} />
            </button>
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 20, display: 'flex', flexDirection: 'column' }}>
        {kind === 'qwen.chat'
          ? <NodeChatView graphId={graphId} nodeId={nodeId} />
          : <Body kind={kind} output={output} outputTitle={outputTitle} error={error} status={status} />}
      </div>
    </div>
  );
}

function Body({ kind, output, outputTitle, error, status }: {
  kind: GraphNodeKind; output: string | null; outputTitle: string | null;
  error: string | null; status: GraphNodeStatus;
}) {
  if (error && !output) {
    return (
      <div
        style={{
          fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)',
          color: status === 'awaiting' ? 'var(--warning-500)' : 'var(--danger-500)',
        }}
      >
        {error}
      </div>
    );
  }
  if (!output) {
    return (
      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)' }}>
        Узел ещё не считался — нажмите «Посчитать заново» в шапке.
      </div>
    );
  }

  // Визуальные артефакты занимают всю площадь: ради этого полноэкранный режим и делался —
  // дерево майндкарты и сетка инфографики в карточке 520 px нечитаемы.
  if (kind === 'artifact.mindmap') return <MindmapView markdown={output} height="100%" />;
  if (kind === 'artifact.infographic') return <InfographicView syntax={output} height="100%" />;
  if (kind === 'artifact.quiz') {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', maxWidth: 760, width: '100%', margin: '0 auto' }}>
        <QuizView json={output} />
      </div>
    );
  }

  // Промпт картинки — строка для вставки в генератор: разметка исказила бы её.
  const raw = kind === 'image.prompt' || kind.startsWith('source.');

  return (
    <div
      style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        // Колонка около 70 символов: длинная строка во весь экран не читается.
        maxWidth: 780, width: '100%', margin: '0 auto',
        fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)', color: 'var(--text-body)',
      }}
    >
      {outputTitle && (
        <div
          style={{
            fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)',
            color: 'var(--text-strong)', marginBottom: 12,
          }}
        >
          {outputTitle}
        </div>
      )}
      {raw
        ? <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{output}</div>
        : <ReactMarkdown components={markdownComponents}>{output}</ReactMarkdown>}
    </div>
  );
}
