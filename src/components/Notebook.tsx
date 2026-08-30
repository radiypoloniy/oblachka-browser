import { useEffect, useState, type ReactNode } from 'react';
import {
  FileText, Plus, X, ArrowLeft, Sparkles, Network, BarChart3, ListChecks, Link2, AlignLeft,
  Loader2, RotateCw, FileDown, Paperclip, ExternalLink, Newspaper,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { InfographicView, MindmapView, QuizView } from './studioViews';
import { islandPlate } from '../styles/island';
import { sp, pad, RADIUS } from '../styles/system';
import { SectionHeader, toneVars, CapsLabel, btnTone, btnGhost } from './settings/kit';
import { useNotebookColumns } from './notebook/useNotebookColumns';
import { NotebookEmpty, SourcesEmpty } from './notebook/NotebookEmpty';
import { GatherSheet } from './notebook/GatherSheet';
import { DocumentView } from './notebook/DocumentView';
import { PageView } from './notebook/PageView';
import { useGather } from './notebook/useGather';
import { useStudio, type StudioState } from './notebook/useStudio';
import { markdownComponents } from './aiMarkdown';
import {
  loadSources, saveSources, sourceFromInput, sourceFromFile, loadSelectedIds, saveSelectedIds,
  subscribeNotebook, getSelectedSourceContext, type NotebookSource,
} from '../newtab/notebook';

// Большой AI-экран как «блокнот» (NotebookLM-подобный): 3 колонки — Источники / Чат / Студия.
//
// ⚠️ ВИЗУАЛ СОБРАН ИЗ ГОТОВЫХ ПРИМИТИВОВ (src/components/settings/kit.tsx), своих здесь нет и
// заводить их не надо: шапка — SectionHeader, подписи групп — CapsLabel, кнопки — btnPrimary,
// острова — islandPlate, отступы и радиусы — sp()/RADIUS из styles/system.ts.
//
// ⚠️ Тон раздела — ЧАЙ, и он один на весь блокнот, включая подэкраны. Цвет принадлежит РАЗДЕЛУ,
// как в настройках (SECTION_TONE.ai === 'tea'), а не состоянию: над этой картой в kit.tsx стоит
// «Тон закреплён НАВСЕГДА: узнаваемость и есть смысл затеи». Пустоту показывает hero шапки
// (крупный 0), а не другой цвет.
// Центр (children) — существующий чат хаба (AiChatView, движок HubChatManager), не переписываем.
// Заход 1 — каркас и кнопки: источники добавляются/выбираются (localStorage), студия-кнопки на
// месте (генерация — следующими заходами). Заземление чата на источники и генерация артефактов —
// заходы 3–5.

interface NotebookProps {
  children: ReactNode;   // центральная колонка — чат
  onBack: () => void;    // назад к минимал-вкладке (mode 'tiles')
}

export type StudioKind = 'summary' | 'mindmap' | 'infographic' | 'quiz' | 'document' | 'page';
const STUDIO: { kind: StudioKind; label: string; Icon: typeof FileText; hint: string }[] = [
  { kind: 'summary',     label: 'Саммари',      Icon: FileText,   hint: 'Краткий пересказ по источникам' },
  { kind: 'mindmap',     label: 'Майндкарта',   Icon: Network,    hint: 'Ветвистая карта идей' },
  { kind: 'infographic', label: 'Инфографика',  Icon: BarChart3,  hint: 'Визуальная сводка' },
  { kind: 'quiz',        label: 'Тест',         Icon: ListChecks, hint: 'Вопросы по мотивам' },
  // ⚠️ Документ — пятый артефакт, а не новая машинерия: та же generateStudio, тот же канал,
  // тот же контейнер модалки. Модель выбирает блоки из закрытого каталога и наполняет их
  // текстом, вёрстку делает DocumentView (разбор — shared/notebookDoc.ts).
  { kind: 'document',    label: 'Документ',     Icon: FileDown,   hint: 'Структура блоками, вёрстка наша' },
  // ⚠️ Второй путь к тому же результату — модель пишет тело разметкой (разбор в
  // shared/docMarkup.ts). Стоит рядом с «Документом», пока не проверено, кто из них лучше.
  { kind: 'page',        label: 'Страница',     Icon: Newspaper,  hint: 'Статью пишет модель, стили наши' },
];

export default function Notebook({ children, onBack }: NotebookProps) {
  const [sources, setSources] = useState<NotebookSource[]>(() => loadSources());
  // По умолчанию выбраны все (как в NotebookLM): loadSelectedIds()===null → берём все текущие id.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const ids = loadSelectedIds();
    return new Set(ids ?? loadSources().map((s) => s.id));
  });
  // Генерация материала Студии, её ход и остановка — в useStudio.
  const studio = useStudio((k) => STUDIO.find((x) => x.kind === k)!.label);

  // Подвижные границы колонок и их память между сессиями — в useNotebookColumns.
  const cols = useNotebookColumns();
  // ⚠️ Форма добавления живёт ЗДЕСЬ, а не в колонке источников: её открывают и двери пустого
  // экрана в центре. Иначе пришлось бы дублировать форму во второй колонке.
  const [adding, setAdding] = useState<null | 'url' | 'text'>(null);
  const gather = useGather(addUrls);

  // Внешние изменения стора (напр. из другой вкладки) — перечитываем.
  useEffect(() => subscribeNotebook(() => setSources(loadSources())), []);

  const persist = (list: NotebookSource[]) => { setSources(list); saveSources(list); };
  const persistSelected = (next: Set<string>) => { setSelected(next); saveSelectedIds([...next]); };

  // Извлечение текста URL после добавления/по повтору. Обновляем именно этот источник, читая
  // актуальный список (функциональный setState — без гонки с параллельными добавлениями).
  async function extractSource(src: NotebookSource) {
    const res = src.kind === 'file'
      ? await window.oblako.extractNotebookFile(src.path ?? '')
      : await window.oblako.extractNotebookUrl(src.url ?? src.content);
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
  // Пачкой — из находок «Собрать материал». Отдельно от addSource: там одна строка от человека,
  // здесь список адресов, и каждый сразу уходит в извлечение.
  function addUrls(urls: string[]) {
    const added = urls.map((u) => sourceFromInput(u)).filter((x): x is NotebookSource => x !== null);
    if (added.length === 0) return;
    persist([...sources, ...added]);
    const sel = new Set(selected);
    for (const a of added) sel.add(a.id);
    persistSelected(sel);
    for (const a of added) if (a.kind === 'url') void extractSource(a);
  }

  // Локальные документы пачкой. Отдельно от addUrls: там адреса строками, здесь готовые
  // записи из диалога — придумывать им kind по виду строки нечего, он известен.
  async function addFiles() {
    const files = await window.oblako.pickNotebookFiles();
    if (files.length === 0) return;
    const added = files.map(sourceFromFile);
    persist([...sources, ...added]);
    const sel = new Set(selected);
    for (const a of added) sel.add(a.id);
    persistSelected(sel);
    for (const a of added) void extractSource(a);
  }

  // Открыть источник: адрес — вкладкой, файл — системной программой. Текст открывать негде,
  // он и так весь перед глазами.
  function openSource(s: NotebookSource) {
    if (s.kind === 'url' && s.url) void window.oblako.openNotebookSource('url', s.url);
    else if (s.kind === 'file' && s.path) void window.oblako.openNotebookSource('file', s.path);
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
  // Выбранные источники для подвала документа: адрес у ссылки, имя файла у документа с диска.
  const selectedSources = () => sources
    .filter((s) => selected.has(s.id) && s.status === 'ready')
    .map((s) => ({ title: s.title, url: s.url ?? (s.kind === 'file' ? 'локальный файл' : '') }));
  const empty = sources.length === 0;


  return (
    <div style={{
      position: 'absolute', inset: 0,
      // ⚠️ Поля ровно pad(6, 8): SectionHeader вычитает ИМЕННО их отрицательными полями, чтобы
      // шапка шла от края до края панели (см. её разбор в kit.tsx). Поменяются поля — поменять и там.
      padding: pad(6, 8),
      display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
      ...toneVars('tea'),
    }}>
      <SectionHeader
        title="Блокнот"
        tone="tea"
        hero={selectedCount}
        heroLabel={selectedCount === 1 ? 'источник выбран' : 'источников выбрано'}
      />

      {/* ⚠️ Пока источников нет, колонки «Студия» НЕТ вовсе, а не пустует: каждая её кнопка
          в этом состоянии отвечает «выберите источники». Пять мёртвых кнопок хуже их отсутствия. */}
      <div style={{
        flex: 1, minHeight: 0, display: 'grid',
        gridTemplateColumns: empty
          ? `${cols.left}px ${GRIP}px minmax(0, 1fr)`
          : `${cols.left}px ${GRIP}px minmax(0, 1fr) ${GRIP}px ${cols.right}px`,
      }}>
      <SourcesPanel
        sources={sources} selected={selected} adding={adding} onAddingChange={setAdding}
        onAdd={addSource} onAddFiles={() => void addFiles()} onOpen={openSource}
        onRemove={removeSource} onToggle={toggle} onRetry={retrySource} onBack={onBack}
      />

      <Grip onPointerDown={cols.onGripDown('left')} />

      {/* Центр — чат (children). AiChatView сам flex:1 внутри — даём ему высоту колонки. */}
      <div style={{
        ...islandPlate, borderRadius: 'var(--radius-island)', background: 'var(--surface-solid)',
        position: 'relative', minHeight: 0, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 24px',
      }}>
        {empty
          ? <NotebookEmpty
              onAddUrl={() => setAdding('url')} onAddText={() => setAdding('text')}
              onAddFiles={() => void addFiles()}
              extra={gather.available
                ? <button onClick={gather.start} style={btnGhost}>Собрать материал</button>
                : undefined}
            />
          : children}
      </div>

      {!empty && <Grip onPointerDown={cols.onGripDown('right')} />}

      {!empty && (
        <StudioPanel selectedCount={selectedCount} note={studio.note} busyKind={studio.busyKind}
          onGenerate={(k) => void studio.generate(k, getSelectedSourceContext(), selectedSources())} />
      )}
      </div>

      {gather.open && (
        <GatherSheet
          busy={gather.busy} step={gather.step} topic={gather.topic}
          queries={gather.queries} hits={gather.hits} error={gather.error}
          onTopicChange={gather.setTopic}
          onSuggest={() => void gather.suggest(getSelectedSourceContext() ?? '')}
          onQueriesChange={gather.setQueries}
          onSearch={() => void gather.search()} onAdd={gather.add} onClose={gather.close}
        />
      )}

      {studio.state && (
        <StudioResultModal state={studio.state} chars={studio.chars} onClose={studio.close} onStop={studio.stop} />
      )}
    </div>
  );
}

// Ширина полосы захвата между колонками. Совпадает с зазором между островами (--gutter-shell):
// ручка и есть этот зазор, отдельного места она не занимает.
const GRIP = 12;

/** Ручка между колонками. Своя, а не примитив kit: у настроек колонок нет. */
function Grip({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      title="Потяните, чтобы изменить ширину"
      style={{
        cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center',
        // ⚠️ Полоска рисуется ТОНКОЙ, а зона захвата — во всю ширину зазора: цель в 3 px мышью
        // не берётся, а видимая линия в 12 px читалась бы разделителем-предметом.
      }}
    >
      <span style={{
        width: 3, height: 38, borderRadius: RADIUS.tight, background: 'var(--divider)',
      }} />
    </div>
  );
}

// Модалка результата Студии. Саммари — Markdown; майндкарта — SVG через markmap; будущие типы
// (инфографика/тест) добавят свои рендеры этим же контейнером.
function StudioResultModal({ state, chars, onClose, onStop }: {
  state: StudioState;
  /** Знаков сгенерировано. Показываем только пока идёт прогон — см. ниже, почему. */
  chars: number;
  onClose: () => void;
  onStop: () => void;
}) {
  const isMindmap = state.kind === 'mindmap';
  const isInfographic = state.kind === 'infographic';
  const isDocument = state.kind === 'document';
  const isPage = state.kind === 'page';
  // Документу простор нужен по той же причине, что карте: это страница, а не заметка.
  const wide = isMindmap || isInfographic || isDocument || isPage;
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
          {/* ⚠️ «Остановить» — СЛОВОМ, а не значком: это единственное действие, которым человек
              возвращает себе машину, и угадывать его по пиктограмме он не должен. */}
          {state.busy && <button onClick={onStop} style={btnGhost}>Остановить</button>}
          <button onClick={onClose} style={xBtn}><X size={16} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: wide ? 0 : '16px 20px' }}>
          {state.busy ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', padding: wide ? '16px 20px' : 0 }}>
              <Loader2 size={16} style={{ animation: 'oblako-spin 1s linear infinite' }} />
              {/* ⚠️ Растущее число, а не полоса: сколько всего будет знаков, мы не знаем —
                  модель останавливается сама. Полоса прогресса тут была бы враньём, а счётчик
                  честно показывает, что работа идёт. Документ на 5–6 тысяч знаков собирается
                  минутами, и без этого признака жизни окно закрывают раньше времени. */}
              {isDocument || isPage
                ? <span>{isPage ? 'Пишу страницу' : 'Собираю документ'}… {chars > 0 && <b style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{chars.toLocaleString('ru-RU')} знаков</b>}</span>
                : <span>Генерирую по источникам…</span>}
            </div>
          ) : state.error ? (
            <div style={{ color: 'var(--danger-500)', fontSize: 'var(--fs-sm)', padding: wide ? '16px 20px' : 0 }}>{state.error}</div>
          ) : isMindmap ? (
            <MindmapView markdown={state.text || ''} />
          ) : isInfographic ? (
            <InfographicView syntax={state.text || ''} />
          ) : isDocument ? (
            <DocumentView json={state.text || ''} />
          ) : isPage ? (
            <PageView json={state.text || ''} />
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
function SourcesPanel({ sources, selected, adding, onAddingChange, onAdd, onAddFiles, onOpen, onRemove, onToggle, onRetry, onBack }: {
  sources: NotebookSource[]; selected: Set<string>;
  /** Открыта ли форма и с какой подсказкой. Состояние поднято в Notebook: форму открывают ещё и
   *  двери пустого экрана в центральной колонке. */
  adding: null | 'url' | 'text';
  onAddingChange: (v: null | 'url' | 'text') => void;
  onAdd: (raw: string) => void; onAddFiles: () => void; onOpen: (s: NotebookSource) => void;
  onRemove: (id: string) => void; onToggle: (id: string) => void;
  onRetry: (id: string) => void; onBack: () => void;
}) {
  const [value, setValue] = useState('');
  const submit = () => { if (value.trim()) { onAdd(value); setValue(''); onAddingChange(null); } };

  return (
    <Panel title="Источники" onBack={onBack} action={<>
      {/* Скрепка отдельной кнопкой, а не пунктом меню: выбор файла — самостоятельное действие,
          и прятать его за раскрытием формы значило бы сделать его на клик дальше остальных. */}
      <IconButton title="Добавить документы с диска" onClick={onAddFiles}><Paperclip size={15} /></IconButton>
      <IconButton title="Добавить адрес или текст" onClick={() => onAddingChange(adding ? null : 'url')}><Plus size={16} /></IconButton>
    </>}>
      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
          <textarea
            value={value} onChange={(e) => setValue(e.target.value)} autoFocus rows={3}
            placeholder={adding === 'text' ? 'Вставьте текст…' : 'Вставьте адрес сайта или текст…'}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 60,
              background: 'var(--surface-sunken)', border: '1px solid var(--divider-strong)',
              borderRadius: 'var(--radius-sm)', padding: '8px 10px', color: 'var(--text-strong)',
              fontSize: 'var(--fs-sm)', outline: 'none',
            }}
          />
          <button onClick={submit} style={btnTone}>Добавить</button>
        </div>
      )}

      {sources.length === 0 ? (
        <SourcesEmpty />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {sources.map((s) => {
            const loading = s.status === 'loading';
            const failed = s.status === 'error';
            // Вставленный текст открывать негде — он и так весь в источниках.
            const openable = (s.kind === 'url' && !!s.url) || (s.kind === 'file' && !!s.path);
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
                    : s.kind === 'file'
                      ? <Paperclip size={14} style={{ color: failed ? 'var(--danger-500)' : 'var(--text-faint)', flex: 'none' }} />
                      : <AlignLeft size={14} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Открытие висит на ИМЕНИ, а не на всей строке: строку занимает чекбокс, и
                      промах по нему уводил бы во вкладку вместо снятия галочки. */}
                  {openable ? (
                    <button onClick={() => onOpen(s)} title={s.kind === 'file' ? 'Открыть документ' : 'Открыть в новой вкладке'}
                      style={{
                        border: 'none', background: 'transparent', padding: 0, cursor: 'default',
                        display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left',
                        fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--section-tone)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-body)')}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                      <ExternalLink size={11} style={{ flex: 'none', opacity: 0.5 }} />
                    </button>
                  ) : (
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                  )}
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
      <CapsLabel>Материалы · {selectedCount} источн.</CapsLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {STUDIO.map(({ kind, label, Icon, hint }) => (
          <button key={kind} onClick={() => onGenerate(kind)} title={hint}
            style={{
              display: 'flex', alignItems: 'center', gap: sp(3), textAlign: 'left', width: '100%',
              padding: pad(2, 3), borderRadius: RADIUS.box, border: 'none',
              background: 'var(--surface-sunken)', cursor: 'default',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}>
            {/* ⚠️ Глиф в плитке ТОНОМ РАЗДЕЛА, а не своим цветом на каждый артефакт. Плакатная
                палитра различает разделы, а не строки внутри одного: пять цветов в одной колонке
                спорят с правилом узнаваемости (см. SECTION_TONE в kit.tsx). */}
            <span style={{
              width: 30, height: 30, borderRadius: RADIUS.control, flex: 'none',
              display: 'grid', placeItems: 'center',
              background: 'var(--section-soft)', color: 'var(--section-tone)',
            }}>
              {busyKind === kind
                ? <Loader2 size={16} style={{ animation: 'oblako-spin 1s linear infinite' }} />
                : <Icon size={16} />}
            </span>
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
        display: 'flex', alignItems: 'center', gap: sp(2), padding: pad(3, 4),
        borderBottom: '1px solid var(--divider)', flex: 'none',
      }}>
        {onBack && <button onClick={onBack} title="Назад" style={xBtn}><ArrowLeft size={16} /></button>}
        <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-strong)' }}>{title}</span>
        {action}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: pad(3, 4) }}>{children}</div>
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

const xBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: 5,
  borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', display: 'inline-flex', flex: 'none',
};
