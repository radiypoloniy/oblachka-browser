import { useState, type ReactNode } from 'react';
import {
  FileText, Plus, X, ArrowLeft, Sparkles, Network, BarChart3, ListChecks, Link2, AlignLeft,
} from 'lucide-react';
import { islandPlate } from '../styles/island';
import { loadSources, saveSources, sourceFromInput, type NotebookSource } from '../newtab/notebook';

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
  // По умолчанию выбраны все — как в NotebookLM. Пустой Set трактуем как «выбраны все» до первого снятия.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(loadSources().map((s) => s.id)));
  const [studioNote, setStudioNote] = useState<string | null>(null);

  const persist = (list: NotebookSource[]) => { setSources(list); saveSources(list); };

  function addSource(raw: string) {
    const src = sourceFromInput(raw);
    if (!src) return;
    persist([...sources, src]);
    setSelected((prev) => new Set(prev).add(src.id));
  }
  function removeSource(id: string) {
    persist(sources.filter((s) => s.id !== id));
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }
  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const selectedCount = selected.size;

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'grid', gridTemplateColumns: '280px 1fr 300px', gap: 'var(--gutter-shell, 12px)',
    }}>
      <SourcesPanel
        sources={sources} selected={selected}
        onAdd={addSource} onRemove={removeSource} onToggle={toggle} onBack={onBack}
      />

      {/* Центр — чат (children). AiChatView сам flex:1 внутри — даём ему высоту колонки. */}
      <div style={{
        ...islandPlate, borderRadius: 'var(--radius-island)', background: 'var(--surface-solid)',
        position: 'relative', minHeight: 0, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 24px',
      }}>
        {children}
      </div>

      <StudioPanel selectedCount={selectedCount} note={studioNote}
        onGenerate={(k) => setStudioNote(`Скоро: сгенерирую «${STUDIO.find((s) => s.kind === k)!.label}» по выбранным источникам (${selectedCount})`)} />
    </div>
  );
}

// ── Источники (слева) ──────────────────────────────────────────────────────────
function SourcesPanel({ sources, selected, onAdd, onRemove, onToggle, onBack }: {
  sources: NotebookSource[]; selected: Set<string>;
  onAdd: (raw: string) => void; onRemove: (id: string) => void; onToggle: (id: string) => void; onBack: () => void;
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
          {sources.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 'var(--radius-sm)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => onToggle(s.id)} style={{ flex: 'none' }} />
              {s.kind === 'url' ? <Link2 size={14} style={{ color: 'var(--text-faint)', flex: 'none' }} /> : <AlignLeft size={14} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
              <button onClick={() => onRemove(s.id)} title="Удалить" style={xBtn}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── Студия (справа) ─────────────────────────────────────────────────────────────
function StudioPanel({ selectedCount, note, onGenerate }: {
  selectedCount: number; note: string | null; onGenerate: (k: StudioKind) => void;
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
            <Icon size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
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
  background: 'var(--accent)', color: '#fff', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default',
};
const xBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: 5,
  borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', display: 'inline-flex', flex: 'none',
};
