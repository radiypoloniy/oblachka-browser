import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, Copy, Download, History, Play } from 'lucide-react';
import type { GraphNodeConfig, GraphNodeKind, GraphNodeStatus } from '../../../shared/graph';
import { NODE_KINDS } from '../../../shared/graph';
import { markdownComponents } from '../aiMarkdown';
import { InfographicView, MindmapView, QuizView } from '../studioViews';
import NodeChatView from './NodeChatView';
import { ImagePreview } from './GraphNodeCard';

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
  // Конфиг узла целиком и правка его текстового поля. Раскрытый вид здесь не витрина, а
  // рабочее место: в карточке 300–400 px связный текст не пишут и не вычитывают.
  config: GraphNodeConfig;
  onConfigChange: (config: GraphNodeConfig) => void;
}

// Какое поле конфига правится в раскрытом виде и как оно подписано. Отдельной таблицей, а не
// ветками в разметке: типов много, и подписи не должны разъезжаться с полями.
const EDITABLE: Partial<Record<GraphNodeKind, { key: 'text' | 'instruction'; label: string; hint: string }>> = {
  'source.note': { key: 'text', label: 'Текст заметки', hint: 'Текст, который пойдёт дальше по графу' },
  'draft.text': { key: 'text', label: 'Черновик', hint: 'Пусто — материал со входа пройдёт дальше как есть' },
  'compose.doc': { key: 'text', label: 'Шаблон документа', hint: 'Пусто — блоки склеятся по порядку. Ссылки на блоки: номер или имя узла в фигурных скобках' },
  'qwen.transform': { key: 'instruction', label: 'Инструкция', hint: 'Что сделать с тем, что придёт на вход' },
  'webapp.chat': { key: 'instruction', label: 'Что дописать перед материалом', hint: 'Промпт, который уедет в чат вместе с входом' },
  'image.prompt': { key: 'instruction', label: 'Пожелания к картинке', hint: 'Вертикально, зима, без людей…' },
};

const headerButton: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, flex: 'none', padding: 0,
  background: 'none', border: 0, borderRadius: '50%',
  color: 'var(--text-body)', cursor: 'pointer',
};

export default function NodeFullscreen({
  graphId, nodeId, kind, title, status, output, outputTitle, error,
  onClose, onRun, onCopyOutput, onSaveOutput, onShowHistory,
  config, onConfigChange,
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
        // Белый лист на ВСЕ типы. Карточка узла на холсте тоже белая, и раскрытие не должно
        // менять тон под тем же содержимым: серый «колодец» читался как чужая подложка.
        background: 'var(--surface-solid)',
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
        {kind === 'qwen.chat' ? (
          <NodeChatView graphId={graphId} nodeId={nodeId} />
        ) : kind === 'source.image' ? (
          <ImagePreview path={config.path ?? ''} />
        ) : (
          <Editable
            kind={kind} config={config} onConfigChange={onConfigChange}
            output={output} outputTitle={outputTitle} error={error} status={status}
          />
        )}
      </div>
    </div>
  );
}

// Редактируемое поле узла и его результат в одном раскрытом виде. У заметки и черновика
// результат равен полю — второй блок был бы дублем, поэтому редактор занимает всю высоту.
function Editable({ kind, config, onConfigChange, output, outputTitle, error, status }: {
  kind: GraphNodeKind; config: GraphNodeConfig;
  onConfigChange: (config: GraphNodeConfig) => void;
  output: string | null; outputTitle: string | null;
  error: string | null; status: GraphNodeStatus;
}) {
  const field = EDITABLE[kind];
  // Отдельный блок результата нужен только там, где он НЕ равен введённому тексту.
  const showsOutput = kind !== 'source.note' && kind !== 'draft.text';

  if (!field) {
    return <Body kind={kind} output={output} outputTitle={outputTitle} error={error} status={status} />;
  }

  const editor = (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0,
        flex: showsOutput ? 'none' : 1,
      }}
    >
      <div
        style={{
          flex: 'none', fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
          letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase', color: 'var(--text-muted)',
        }}
      >
        {field.label}
      </div>
      <textarea
        className="nowheel"
        value={config[field.key] ?? ''}
        placeholder={field.hint}
        onChange={(e) => onConfigChange({ ...config, [field.key]: e.target.value })}
        style={{
          // Когда следом идёт результат, полю хватает трети экрана: инструкцию пишут один
          // раз, а перечитывают выхлоп. Где результата нет — поле забирает всю высоту.
          ...(showsOutput ? { height: '32vh', flex: 'none' } : { flex: 1, minHeight: 0 }),
          width: '100%', boxSizing: 'border-box', resize: 'none',
          background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
          borderRadius: 'var(--radius-sm)', padding: '10px 12px',
          outline: 'none', color: 'var(--text-strong)', font: 'inherit',
          fontFamily: kind === 'compose.doc' ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)',
        }}
      />
    </div>
  );

  // Колонка ограничена по ширине: вычитывать текст во весь экран нельзя, глаз теряет строку.
  if (!showsOutput) {
    return (
      <div style={{ flex: 1, minHeight: 0, width: '100%', maxWidth: 760, margin: '0 auto', display: 'flex' }}>
        {editor}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {editor}
      <div className="nowheel" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Body kind={kind} output={output} outputTitle={outputTitle} error={error} status={status} />
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
