import ReactMarkdown from 'react-markdown';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import {
  Play, AlertCircle, Loader2, Check, Clock, Hand, ExternalLink, X, Files,
  Maximize2,
} from 'lucide-react';
import type { GraphNodeConfig, GraphNodeKind, GraphNodeStatus } from '../../../shared/graph';
import { NODE_KINDS } from '../../../shared/graph';
import type { ImagePreset } from '../../../shared/imagePresets';
import { markdownComponents } from '../aiMarkdown';
import { InfographicView, MindmapView, QuizView } from '../studioViews';

// Карточка узла на холсте. Только рисует и зовёт колбэки — планирование и прогон живут
// в main (electron/GraphEngine.ts).

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
  onDelete: () => void;
  onDuplicate: () => void;
  onShowHistory: () => void;
  onExpand: () => void;
  // Только для source.file — нативный диалог выбора документа (его открывает main).
  onPickFile: () => void;
  // Только для image.prompt: список доступных пресетов и запрос на открытие редактора своих.
  imagePresets: ImagePreset[];
  onEditPresets: () => void;
  // Вынести результат наружу: в буфер обмена и файлом на диск.
  onCopyOutput: () => void;
  onSaveOutput: () => void;
  // Только для webapp.chat — открыть живой сайт в панели 1:1 (в карточку нативную вью
  // положить нельзя, см. шапку GraphCanvas.tsx).
  onOpenWebApp: () => void;
}

// Размер по умолчанию на тип узла. Задаём его ВСЕГДА (даже узлам, сохранённым до появления
// колонок w/h) — так высота карточки определённая, и внутренние области могут честно
// растягиваться по flex вместо подпорок с maxHeight.
export const DEFAULT_NODE_SIZE: Record<GraphNodeKind, { w: number; h: number }> = {
  'source.url': { w: 268, h: 268 },
  'source.note': { w: 268, h: 236 },
  'source.file': { w: 280, h: 260 },
  'qwen.transform': { w: 304, h: 320 },
  'image.prompt': { w: 330, h: 380 },
  'qwen.chat': { w: 320, h: 340 },
  'webapp.chat': { w: 300, h: 300 },
  'search.web': { w: 320, h: 340 },
  'factcheck.gemini': { w: 340, h: 340 },
  // Визуальным артефактам нужна площадь: дерево майндкарты и инфографика в узкой
  // карточке нечитаемы, а тест — это список вопросов с вариантами.
  'artifact.summary': { w: 380, h: 340 },
  'artifact.mindmap': { w: 520, h: 400 },
  'artifact.infographic': { w: 520, h: 420 },
  'artifact.quiz': { w: 420, h: 440 },
  'output.text': { w: 380, h: 360 },
};

const STATUS_TONE: Record<GraphNodeStatus, string> = {
  idle: 'var(--text-faint)',
  stale: 'var(--warning-500)',
  queued: 'var(--text-muted)',
  running: 'var(--accent)',
  // Жёлтый, как и «устарел»: оба состояния означают «нужно вмешательство», а не поломку.
  awaiting: 'var(--warning-500)',
  // Зелёный функционален по цветовому закону проекта: результат посчитан локальной моделью
  // на этой машине — тот же смысл, что у --dot-local в статусе модели.
  done: 'var(--dot-local)',
  error: 'var(--danger-500)',
};

const STATUS_HINT: Record<GraphNodeStatus, string> = {
  idle: 'Не считался',
  stale: 'Устарел — входные данные изменились',
  queued: 'Ждёт очереди',
  running: 'Считается',
  awaiting: 'Ждёт вас — откройте чат и заберите ответ',
  done: 'Готово',
  error: 'Ошибка',
};

function StatusIcon({ status }: { status: GraphNodeStatus }) {
  const color = STATUS_TONE[status];
  if (status === 'running') return <Loader2 size={13} color={color} className="oblako-graph-spin" />;
  if (status === 'awaiting') return <Hand size={13} color={color} />;
  if (status === 'error') return <AlertCircle size={13} color={color} />;
  if (status === 'done') return <Check size={13} color={color} />;
  if (status === 'queued') return <Clock size={13} color={color} />;
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />;
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--divider)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-strong)',
  font: 'inherit',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'var(--font-sans)',
  padding: '7px 9px',
  outline: 'none',
  resize: 'none',
};

const headerButton: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, flex: 'none', padding: 0,
  background: 'none', border: 0, borderRadius: '50%',
  color: 'var(--text-faint)', cursor: 'pointer',
};

// Вывод модели — БЕЗ подложки: чёрным по фону карточки, как текст в любом чат-боте.
// Серая плашка тут только отнимала контраст и делала ответ похожим на поле ввода.
const outputBox: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '2px 0',
  fontSize: 'var(--fs-sm)',
  lineHeight: 'var(--lh-body)',
  color: 'var(--text-body)',
  wordBreak: 'break-word',
};

export default function GraphNodeCard({ data, selected }: { data: GraphNodeData; selected?: boolean }) {
  const spec = NODE_KINDS[data.kind];
  const busy = data.status === 'running' || data.status === 'queued';
  // Вывод модели — это Markdown, и читать его сырым (## и ** в тексте) неудобно. Источники
  // отдают текст чужой страницы: там разметки нет, а случайные # и * только исказили бы её.
  const asMarkdown = data.kind === 'qwen.transform' || data.kind === 'output.text'
    || data.kind === 'artifact.summary' || data.kind === 'search.web'
    || data.kind === 'factcheck.gemini';
  // Промпт картинки показываем сырым моноширинным текстом: это строка для копирования
  // в генератор, и markdown-обработка исказила бы её (звёздочки, подчёркивания).
  // Артефакты, которые рисуют себя во всю площадь контейнера, а не текстом со скроллом.
  const visual = data.kind === 'artifact.mindmap' || data.kind === 'artifact.infographic';
  const min = DEFAULT_NODE_SIZE[data.kind];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-island)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--divider)'}`,
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-island, 0 6px 20px -10px rgba(0,0,0,.3))',
        overflow: 'hidden',
      }}
    >
      <NodeResizer
        minWidth={min.w}
        minHeight={180}
        isVisible={!!selected}
        lineStyle={{ borderColor: 'var(--accent)' }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)', border: 0 }}
      />

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
          display: 'flex', alignItems: 'center', gap: 7, flex: 'none',
          padding: '9px 11px', borderBottom: '1px solid var(--divider)',
        }}
        title={STATUS_HINT[data.status]}
      >
        <StatusIcon status={data.status} />
        <span style={{ fontSize: 14, lineHeight: 1, flex: 'none' }}>{spec.emoji}</span>
        <span
          style={{
            fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
            letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
            color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
          }}
        >
          {spec.label}
        </span>
        <button
          type="button"
          className="nodrag"
          onClick={data.onRun}
          disabled={busy}
          title={busy ? 'Уже в работе' : 'Посчитать этот узел и всё, что от него зависит'}
          style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center',
            background: 'none', border: 0, padding: 3, borderRadius: '50%',
            color: busy ? 'var(--text-faint)' : 'var(--text-body)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          <Play size={13} />
        </button>
        <button
          type="button"
          className="nodrag"
          onClick={data.onDuplicate}
          title="Дублировать узел (Ctrl+D)"
          style={headerButton}
        >
          <Files size={13} />
        </button>
        <button
          type="button"
          className="nodrag"
          onClick={data.onExpand}
          title="Раскрыть на весь экран"
          style={headerButton}
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          className="nodrag"
          onClick={data.onDelete}
          title="Удалить узел"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, flex: 'none', padding: 0,
            background: 'none', border: 0, borderRadius: '50%',
            color: 'var(--text-faint)', cursor: 'pointer',
          }}
        >
          <X size={13} />
        </button>
      </div>

      <div
        style={{
          flex: 1, minHeight: 0, padding: '10px 11px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}
      >
        <input
          className="nodrag"
          value={data.title}
          placeholder="Название узла"
          onChange={(e) => data.onPatch({ title: e.target.value })}
          style={{
            ...fieldStyle, flex: 'none', background: 'transparent', border: 0, padding: 0,
            fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-md)',
          }}
        />

        {data.kind === 'source.url' && (
          <input
            className="nodrag"
            value={data.config.url ?? ''}
            placeholder="https://…"
            onChange={(e) => data.onPatch({ config: { ...data.config, url: e.target.value } })}
            style={{ ...fieldStyle, flex: 'none' }}
          />
        )}

        {data.kind === 'source.file' && (
          <>
            <button
              type="button"
              className="nodrag"
              onClick={data.onPickFile}
              style={{
                flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: 'var(--surface-sunken)', color: 'var(--text-body)',
                border: '1px solid var(--divider)', borderRadius: 'var(--radius-sm)',
                padding: '8px 12px', cursor: 'pointer', font: 'inherit',
                fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
              }}
            >
              📎 {data.config.path ? 'Другой файл' : 'Выбрать файл'}
            </button>
            {data.config.path && (
              <div
                title={data.config.path}
                style={{
                  flex: 'none', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {data.config.path.split(/[\/]/).pop()}
              </div>
            )}
          </>
        )}

        {data.kind === 'source.note' && (
          <textarea
            className="nodrag"
            value={data.config.text ?? ''}
            placeholder="Текст, который пойдёт дальше по графу"
            onChange={(e) => data.onPatch({ config: { ...data.config, text: e.target.value } })}
            style={{ ...fieldStyle, flex: 1, minHeight: 60 }}
          />
        )}

        {data.kind === 'qwen.chat' && (
          <button
            type="button"
            className="nodrag"
            onClick={data.onExpand}
            style={{
              flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: 'var(--accent)', color: 'var(--text-on-accent)', border: 0,
              borderRadius: 'var(--radius-sm)', padding: '8px 12px', cursor: 'pointer',
              font: 'inherit', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            🗨️ Открыть диалог
          </button>
        )}

        {data.kind === 'webapp.chat' && (
          <>
            <input
              className="nodrag"
              value={data.config.url ?? ''}
              placeholder="https://chatgpt.com/"
              onChange={(e) => data.onPatch({ config: { ...data.config, url: e.target.value } })}
              style={{ ...fieldStyle, flex: 'none' }}
            />
            <textarea
              className="nodrag"
              value={data.config.instruction ?? ''}
              placeholder="Что дописать перед материалом (необязательно)"
              onChange={(e) => data.onPatch({ config: { ...data.config, instruction: e.target.value } })}
              style={{ ...fieldStyle, flex: 'none', height: 64 }}
            />
            <button
              type="button"
              className="nodrag"
              onClick={data.onOpenWebApp}
              disabled={!(data.config.url ?? '').trim()}
              style={{
                flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: 'var(--accent)', color: 'var(--text-on-accent)', border: 0,
                borderRadius: 'var(--radius-sm)', padding: '8px 12px',
                cursor: (data.config.url ?? '').trim() ? 'pointer' : 'default',
                opacity: (data.config.url ?? '').trim() ? 1 : 0.5,
                font: 'inherit', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <ExternalLink size={13} />
              Открыть чат
            </button>
          </>
        )}

        {data.kind === 'search.web' && (
          <input
            className="nodrag"
            value={data.config.text ?? ''}
            placeholder="Что искать (пусто — возьмёт со входа)"
            onChange={(e) => data.onPatch({ config: { ...data.config, text: e.target.value } })}
            style={{ ...fieldStyle, flex: 'none' }}
          />
        )}

        {data.kind === 'image.prompt' && (
          <>
            <div style={{ flex: 'none', display: 'flex', gap: 6 }}>
              <select
                className="nodrag"
                value={data.config.preset ?? data.imagePresets[0]?.id ?? ''}
                onChange={(e) => data.onPatch({ config: { ...data.config, preset: e.target.value } })}
                style={{ ...fieldStyle, flex: 1, cursor: 'pointer' }}
              >
                {data.imagePresets.map((p) => (
                  <option key={p.id} value={p.id}>{p.emoji} {p.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="nodrag"
                onClick={data.onEditPresets}
                title="Свои пресеты"
                style={{
                  flex: 'none', width: 34, display: 'inline-flex', alignItems: 'center',
                  justifyContent: 'center', background: 'var(--surface-sunken)',
                  border: '1px solid var(--divider)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-body)', cursor: 'pointer', fontSize: 14,
                }}
              >
                ⚙
              </button>
            </div>
            <textarea
              className="nodrag"
              value={data.config.instruction ?? ''}
              placeholder="Пожелания: вертикально, зима, без людей…"
              onChange={(e) => data.onPatch({ config: { ...data.config, instruction: e.target.value } })}
              style={{ ...fieldStyle, flex: 'none', height: 56 }}
            />
          </>
        )}

        {data.kind === 'qwen.transform' && (
          <textarea
            className="nodrag"
            value={data.config.instruction ?? ''}
            placeholder="Что сделать с тем, что придёт на вход"
            onChange={(e) => data.onPatch({ config: { ...data.config, instruction: e.target.value } })}
            // Инструкцию пишут один раз, а результат перечитывают — поэтому при растягивании
            // узла место достаётся выводу, а не полю ввода.
            style={{ ...fieldStyle, flex: 'none', height: 86, resize: 'none' }}
          />
        )}

        {data.error && (
          <div
            style={{
              flex: 'none', fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-snug)',
              // «Ждёт вас» — не поломка, а приглашение к действию, и красным его красить нельзя.
              color: data.status === 'awaiting' ? 'var(--warning-500)' : 'var(--danger-500)',
            }}
          >
            {data.error}
          </div>
        )}

        {/* У заметки вывод равен введённому тексту — показывать его вторым блоком значит
            дублировать одно и то же и вдвое урезать полезную площадь карточки. */}
        {data.output && data.kind !== 'source.note' && (
          <div
            className="nodrag nowheel"
            // Майндкарта и инфографика рисуют себя сами во всю высоту — им внутренний
            // скролл и отступы только мешают, они масштабируются под контейнер. Подложку
            // тоже снимаем: с ней рисунок читается как вклеенный скриншот, а не как
            // содержимое карточки.
            style={visual ? { ...outputBox, overflow: 'auto', padding: 0 } : outputBox}
          >
            {data.outputTitle && !visual && (
              <div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginBottom: 4 }}>
                {data.outputTitle}
              </div>
            )}
            {data.kind === 'artifact.mindmap' ? (
              <MindmapView markdown={data.output} height="100%" />
            ) : data.kind === 'artifact.infographic' ? (
              <InfographicView syntax={data.output} height="100%" />
            ) : data.kind === 'artifact.quiz' ? (
              <QuizView json={data.output} />
            ) : asMarkdown ? (
              <ReactMarkdown components={markdownComponents}>{data.output}</ReactMarkdown>
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{data.output}</div>
            )}
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
