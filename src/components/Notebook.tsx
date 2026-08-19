import { useEffect, useState, type ReactNode } from 'react';
import {
  FileText, Plus, X, ArrowLeft, Sparkles, Network, BarChart3, ListChecks, Link2, AlignLeft,
  Loader2, RotateCw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { InfographicView, MindmapView, QuizView } from './studioViews';
import { islandPlate } from '../styles/island';
import { markdownComponents } from './aiMarkdown';
import {
  loadSources, saveSources, sourceFromInput, loadSelectedIds, saveSelectedIds, subscribeNotebook,
  getSelectedSourceContext, type NotebookSource,
} from '../newtab/notebook';

// Большой AI-экран как «блокнот» (NotebookLM-подобный): 3 колонки — Источники / Чат / Студия.
// Центр (children) — существующий чат хаба (AiChatView, движок HubChatManager), не переписываем.
// Заход 1 — каркас и кнопки: источники добавляются/выбираются (localStorage), студия-кнопки на
// месте (генерация — следующими заходами). Заземление чата на источники и генерация артефактов —
// заходы 3–5.

interface NotebookProps {
  children: ReactNode;   // центральная колонка — чат
  onBack: () => void;    // назад к минимал-вкладке (mode 'tiles')
}

export type StudioKind = 'summary' | 'mindmap' | 'infographic' | 'quiz';
const STUDIO: { kind: StudioKind; label: string; Icon: typeof FileText; hint: string }[] = [
  { kind: 'summary',     label: 'Саммари',      Icon: FileText,   hint: 'Краткий пересказ по источникам' },
  { kind: 'mindmap',     label: 'Майндкарта',   Icon: Network,    hint: 'Ветвистая карта идей' },
  { kind: 'infographic', label: 'Инфографика',  Icon: BarChart3,  hint: 'Визуальная сводка' },
  { kind: 'quiz',        label: 'Тест',         Icon: ListChecks, hint: 'Вопросы по мотивам' },
];

export default function Notebook({ children, onBack }: NotebookProps) {
  const [sources, setSources] = useState<NotebookSource[]>(() => loadSources());
  // По умолчанию выбраны все (как в NotebookLM): loadSelectedIds()===null → берём все текущие id.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const ids = loadSelectedIds();
    return new Set(ids ?? loadSources().map((s) => s.id));
  });
  const [studioNote, setStudioNote] = useState<string | null>(null);
  // Открытый результат Студии (модалка). busy — идёт генерация; text/error — итог.
  const [studio, setStudio] = useState<{ kind: StudioKind; label: string; busy: boolean; text?: string; error?: string } | null>(null);

  // Внешние изменения стора (напр. из другой вкладки) — перечитываем.
  useEffect(() => subscribeNotebook(() => setSources(loadSources())), []);

  const persist = (list: NotebookSource[]) => { setSources(list); saveSources(list); };
  const persistSelected = (next: Set<string>) => { setSelected(next); saveSelectedIds([...next]); };

  // Извлечение текста URL после добавления/по повтору. Обновляем именно этот источник, читая
  // актуальный список (функциональный setState — без гонки с параллельными добавлениями).
  async function extractSource(src: NotebookSource) {
    const res = await window.oblako.extractNotebookUrl(src.content);
    setSources((prev) => {
      const upd = prev.map((s) => s.id !== src.id ? s : (
        res.ok
          ? { ...s, title: res.title || s.title, content: res.text || '', status: 'ready' as const }
          : { ...s, status: 'error' as const }
      ));
      saveSources(upd);
      return upd;
    });
  }

  function addSource(raw: string) {
    const src = sourceFromInput(raw);
    if (!src) return;
    persist([...sources, src]);
    persistSelected(new Set(selected).add(src.id));
    if (src.kind === 'url') void extractSource(src);
  }
  function retrySource(id: string) {
    const src = sources.find((s) => s.id === id);
    if (!src) return;
    const loading = sources.map((s) => s.id === id ? { ...s, status: 'loading' as const } : s);
    persist(loading);
    void extractSource({ ...src, status: 'loading' });
  }
  function removeSource(id: string) {
    persist(sources.filter((s) => s.id !== id));
    const n = new Set(selected); n.delete(id); persistSelected(n);
  }
  function toggle(id: string) {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    persistSelected(n);
  }

  const selectedCount = sources.filter((s) => selected.has(s.id) && s.status === 'ready').length;

  // Реализованные типы Студии (остальные — свои заходы, пока показывают заметку «скоро»).
  const STUDIO_IMPLEMENTED = new Set<StudioKind>(['summary', 'mindmap', 'infographic', 'quiz']);
  async function handleStudio(kind: StudioKind) {
    const label = STUDIO.find((s) => s.kind === kind)!.label;
    const ctx = getSelectedSourceContext();
    if (!ctx) { setStudioNote('Выберите источники с текстом — по ним построю материал.'); return; }
    if (!STUDIO_IMPLEMENTED.has(kind)) { setStudioNote(`«${label}» — скоро, генерация появится следующим заходом.`); return; }
    setStudioNote(null);
    setStudio({ kind, label, busy: true });
    const r = await window.oblako.generateStudio(kind, ctx);
    setStudio({ kind, label, busy: false, text: r.ok ? r.text : undefined, error: r.ok ? undefined : (r.error || 'Не удалось сгенерировать') });
  }

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'grid', gridTemplateColumns: '280px 1fr 300px', gap: 'var(--gutter-shell, 12px)',
    }}>
      <SourcesPanel
        sources={sources} selected={selected}
        onAdd={addSource} onRemove={removeSource} onToggle={toggle} onRetry={retrySource} onBack={onBack}
      />

      {/* Центр — чат (children). AiChatView сам flex:1 внутри — даём ему высоту колонки. */}
      <div style={{
        ...islandPlate, borderRadius: 'var(--radius-island)', background: 'var(--surface-solid)',
        position: 'relative', minHeight: 0, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 24px',
      }}>
        {children}
      </div>

      <StudioPanel selectedCount={selectedCount} note={studioNote} busyKind={studio?.busy ? studio.kind : null}
        onGenerate={(k) => void handleStudio(k)} />

      {studio && <StudioResultModal state={studio} onClose={() => setStudio(null)} />}
    </div>
  );
}

// Модалка результата Студии. Саммари — Markdown; майндкарта — SVG через markmap; будущие типы
// (инфографика/тест) добавят свои рендеры этим же контейнером.
function StudioResultModal({ state, onClose }: {
  state: { kind: StudioKind; label: string; busy: boolean; text?: string; error?: string };
  onClose: () => void;
}) {
  const isMindmap = state.kind === 'mindmap';
  const isInfographic = state.kind === 'infographic';
  const wide = isMindmap || isInfographic;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 500, background: 'var(--scrim, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        // Майндкарте/инфографике нужен простор — модалка шире.
        width: wide ? 960 : 680, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 96px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        ...islandPlate, borderRadius: 'var(--radius-island)', boxShadow: 'var(--shadow-island)', background: 'var(--surface-solid)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--divider-strong)', flex: 'none' }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>{state.label}</span>
          <button onClick={onClose} style={xBtn}><X size={16} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: wide ? 0 : '16px 20px' }}>
          {state.busy ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', padding: wide ? '16px 20px' : 0 }}>
              <Loader2 size={16} style={{ animation: 'oblako-spin 1s linear infinite' }} /> Генерирую по источникам…
            </div>
          ) : state.error ? (
            <div style={{ color: 'var(--danger-500)', fontSize: 'var(--fs-sm)', padding: wide ? '16px 20px' : 0 }}>{state.error}</div>
          ) : isMindmap ? (
            <MindmapView markdown={state.text || ''} />
          ) : isInfographic ? (
            <InfographicView syntax={state.text || ''} />
          ) : state.kind === 'quiz' ? (
            <QuizView json={state.text || ''} />
          ) : (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', lineHeight: 'var(--lh-body)' }}>
              <ReactMarkdown components={markdownComponents}>{state.text || ''}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Источники (слева) ──────────────────────────────────────────────────────────
function SourcesPanel({ sources, selected, onAdd, onRemove, onToggle, onRetry, onBack }: {
  sources: NotebookSource[]; selected: Set<string>;
  onAdd: (raw: string) => void; onRemove: (id: string) => void; onToggle: (id: string) => void;
  onRetry: (id: string) => void; onBack: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const submit = () => { if (value.trim()) { onAdd(value); setValue(''); setAdding(false); } };

  return (
    <Panel title="Источники" onBack={onBack} action={
      <IconButton title="Добавить источник" onClick={() => setAdding((v) => !v)}><Plus size={16} /></IconButton>
    }>
      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          <textarea
            value={value} onChange={(e) => setValue(e.target.value)} autoFocus rows={3}
            placeholder="Вставьте адрес сайта или текст…"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 60,
              background: 'var(--surface-sunken)', border: '1px solid var(--divider-strong)',
              borderRadius: 'var(--radius-sm)', padding: '8px 10px', color: 'var(--text-strong)',
              fontSize: 'var(--fs-sm)', outline: 'none',
            }}
          />
          <button onClick={submit} style={btnPrimary}>Добавить</button>
        </div>
      )}

      {sources.length === 0 ? (
        <Empty>Добавьте сайты или тексты — на них будет опираться чат и Студия.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {sources.map((s) => {
            const loading = s.status === 'loading';
            const failed = s.status === 'error';
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 'var(--radius-sm)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                {/* Пока не извлечён — чекбокс неактивен (нечего подмешивать в чат). */}
                <input type="checkbox" checked={selected.has(s.id)} disabled={loading || failed}
                  onChange={() => onToggle(s.id)} style={{ flex: 'none' }} />
                {loading
                  ? <Loader2 size={14} style={{ color: 'var(--text-faint)', flex: 'none', animation: 'oblako-spin 1s linear infinite' }} />
                  : s.kind === 'url'
                    ? <Link2 size={14} style={{ color: failed ? 'var(--danger-500)' : 'var(--text-faint)', flex: 'none' }} />
                    : <AlignLeft size={14} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                  {loading && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>извлекается…</div>}
                  {failed && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger-500)' }}>не удалось извлечь</div>}
                </div>
                {failed && <button onClick={() => onRetry(s.id)} title="Повторить" style={xBtn}><RotateCw size={13} /></button>}
                <button onClick={() => onRemove(s.id)} title="Удалить" style={xBtn}><X size={13} /></button>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ── Студия (справа) ─────────────────────────────────────────────────────────────
function StudioPanel({ selectedCount, note, busyKind, onGenerate }: {
  selectedCount: number; note: string | null; busyKind: StudioKind | null; onGenerate: (k: StudioKind) => void;
}) {
  return (
    <Panel title="Студия">
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginBottom: 10 }}>
        Материалы по выбранным источникам ({selectedCount}).
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {STUDIO.map(({ kind, label, Icon, hint }) => (
          <button key={kind} onClick={() => onGenerate(kind)} title={hint}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
              padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--divider-strong)',
              background: 'var(--surface)', cursor: 'default',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface)')}>
            {busyKind === kind
              ? <Loader2 size={18} style={{ color: 'var(--accent)', flex: 'none', animation: 'oblako-spin 1s linear infinite' }} />
              : <Icon size={18} style={{ color: 'var(--accent)', flex: 'none' }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>{label}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{hint}</div>
            </div>
          </button>
        ))}
      </div>
      {note && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 'var(--radius-sm)',
          background: 'var(--accent-soft)', color: 'var(--text-body)', fontSize: 'var(--fs-xs)',
          display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <Sparkles size={14} style={{ color: 'var(--accent)', flex: 'none', marginTop: 1 }} />
          {note}
        </div>
      )}
    </Panel>
  );
}

// ── Общая рамка-панель ──────────────────────────────────────────────────────────
function Panel({ title, action, onBack, children }: {
  title: string; action?: ReactNode; onBack?: () => void; children: ReactNode;
}) {
  return (
    <div style={{
      ...islandPlate, borderRadius: 'var(--radius-island)', background: 'var(--surface-solid)',
      display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px',
        borderBottom: '1px solid var(--divider)', flex: 'none',
      }}>
        {onBack && <button onClick={onBack} title="Назад" style={xBtn}><ArrowLeft size={16} /></button>}
        <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-strong)' }}>{title}</span>
        {action}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px' }}>{children}</div>
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} title={title} style={xBtn}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>{children}</button>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', padding: '8px 4px', lineHeight: 1.5 }}>{children}</div>;
}

const btnPrimary: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: 'none',
  background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default',
};
const xBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: 5,
  borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', display: 'inline-flex', flex: 'none',
};
