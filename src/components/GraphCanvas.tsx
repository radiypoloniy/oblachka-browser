import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  applyEdgeChanges, applyNodeChanges, addEdge,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Plus, Play, Square, Trash2, ArrowLeft, Pencil,
} from 'lucide-react';
import type {
  GraphDoc, GraphMeta, GraphNodeConfig, GraphNodeKind, GraphNodeStatus, GraphStructure,
} from '../../shared/graph';
import { NODE_KINDS } from '../../shared/graph';
import GraphNodeCard, { DEFAULT_NODE_SIZE, type GraphNodeData } from './graph/GraphNodeCard';
import GraphWebAppWindow from './graph/GraphWebAppWindow';
import { downstreamOf } from '../../shared/graph';

// Граф-воркспейс: холст рисует и складывает структуру, считает всё main (GraphEngine.ts).
// Логика прогона, обращения к модели и извлечение страниц сюда не переезжают — компонент
// только шлёт «посчитай» и слушает GRAPH_PROGRESS.
//
// Живые WebContentsView в узлы намеренно НЕ кладутся: нативные view нельзя ни отмасштабировать
// вместе с холстом, ни обрезать по его краю, ни увести под связи — они всегда рисуются поверх
// React-слоя. Поэтому узел webapp.chat остаётся карточкой, а сайт открывается плавающим окном
// поверх холста (GraphWebAppWindow) — тем же слотом-приложением, что в разделе «Приложения».

type RFNode = Node<GraphNodeData>;

const nodeTypes = { oblako: GraphNodeCard };

// Панель сгруппирована по роли узла, а не свалена в один ряд: восемь одинаковых кнопок
// подряд не читаются, а группы отвечают на вопрос «откуда взять — что сделать — что получить».
const NODE_GROUPS: { title: string; kinds: GraphNodeKind[] }[] = [
  { title: 'Откуда', kinds: ['source.url', 'source.note'] },
  { title: 'Обработка', kinds: ['qwen.transform', 'webapp.chat'] },
  { title: 'Проверка', kinds: ['search.web', 'factcheck.gemini'] },
  { title: 'Артефакты', kinds: ['artifact.summary', 'artifact.mindmap', 'artifact.infographic', 'artifact.quiz'] },
  { title: 'Итог', kinds: ['output.text'] },
];

const SAVE_DEBOUNCE_MS = 600;

function toRFNodes(doc: GraphDoc): RFNode[] {
  return doc.nodes.map((n) => ({
    id: n.id,
    type: 'oblako',
    position: { x: n.x, y: n.y },
    // Размер задаём всегда, в том числе узлам, сохранённым до появления колонок w/h:
    // при определённой высоте внутренности карточки растягиваются по flex честно.
    width: n.w ?? DEFAULT_NODE_SIZE[n.kind].w,
    height: n.h ?? DEFAULT_NODE_SIZE[n.kind].h,
    data: {
      kind: n.kind,
      title: n.title,
      config: n.config,
      // Узел с результатом и без ошибки — готов. Более тонкое «устарел» посчитает движок:
      // он один знает отпечаток входов, renderer его не воспроизводит.
      status: (n.error ? 'error' : n.output ? 'done' : 'idle') as GraphNodeStatus,
      output: n.output,
      outputTitle: n.outputTitle,
      error: n.error,
      onPatch: () => {},
      onRun: () => {},
      onDelete: () => {},
      onOpenWebApp: () => {},
    },
  }));
}

function toRFEdges(doc: GraphDoc): Edge[] {
  return doc.edges.map((e) => ({
    id: e.id,
    source: e.fromNode,
    sourceHandle: e.fromPort,
    target: e.toNode,
    targetHandle: e.toPort,
  }));
}

export default function GraphCanvas({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<GraphMeta[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  // Открытые узлы-веб-приложения. Их может быть несколько: держать рядом ChatGPT и Gemini,
  // сравнивая ответы, — основной сценарий графа. Порядок в массиве = порядок наложения,
  // последний сверху (см. focusWebApp).
  const [webApps, setWebApps] = useState<
    { nodeId: string; url: string; title: string; hostLabel: string }[]
  >([]);
  // Подсказка последнего действия — своя у каждого окна, иначе ответ одной кнопки
  // появлялся бы в чужом чате.
  const [webAppNotes, setWebAppNotes] = useState<Record<string, string>>({});
  // Переименование воркспейса прямо в списке: id строки в правке и текущий черновик.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // Пока идёт загрузка графа, автосейв обязан молчать: иначе пустое стартовое состояние
  // успело бы записаться поверх только что открытого воркспейса.
  const loadedIdRef = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Связи нужны patchNode для пометки «устарел», но через замыкание они пересоздавали бы
  // колбэки на каждое движение мыши по холсту — держим их зеркалом в ref.
  const edgesRef = useRef<Edge[]>([]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const refreshList = useCallback(async () => {
    const metas = await window.oblako.listGraphs();
    setList(metas);
    return metas;
  }, []);

  const openGraph = useCallback(async (graphId: number) => {
    setLoading(true);
    loadedIdRef.current = null;
    const doc = await window.oblako.getGraph(graphId);
    if (!doc) { setLoading(false); return; }
    setNodes(toRFNodes(doc));
    setEdges(toRFEdges(doc));
    setCurrentId(graphId);
    loadedIdRef.current = graphId;
    setLoading(false);
  }, []);

  // Первое открытие: берём самый свежий воркспейс, а если их нет — заводим первый,
  // чтобы человек попал сразу на холст, а не на пустой экран с одной кнопкой.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const metas = await refreshList();
      if (!alive) return;
      if (metas.length > 0) {
        await openGraph(metas[0]!.id);
      } else {
        const created = await window.oblako.createGraph('Мой первый граф');
        if (!alive || !created) { setLoading(false); return; }
        await refreshList();
        await openGraph(created.id);
      }
    })();
    return () => { alive = false; };
  }, [openGraph, refreshList]);

  // Ход прогона из main. Чанки Qwen приходят потоком — дописываем их в вывод узла.
  useEffect(() => {
    return window.oblako.onGraphProgress((p) => {
      if (p.graphId !== loadedIdRef.current) return;
      setNodes((prev) => prev.map((n) => {
        if (n.id !== p.nodeId) return n;
        const data = { ...n.data, status: p.status };
        if (p.chunk !== undefined) {
          data.output = (n.data.output ?? '') + p.chunk;
        } else if (p.status === 'running') {
          data.output = null; // новый прогон — старый результат больше не про него
          data.error = null;
        }
        if (p.output !== undefined) data.output = p.output;
        if (p.outputTitle !== undefined) data.outputTitle = p.outputTitle;
        // awaiting несёт не ошибку, а подсказку «что от вас требуется» — показываем её тем
        // же полем, карточка красит его жёлтым, а не красным (см. GraphNodeCard).
        if (p.status === 'error' || p.status === 'awaiting') data.error = p.error ?? 'Не получилось';
        if (p.status === 'done') data.error = null;
        return { ...n, data };
      }));
      if (p.status === 'running' || p.status === 'queued') setRunning(true);
    });
  }, []);

  // Прогон закончился, когда ни один узел больше не в работе.
  useEffect(() => {
    const busy = nodes.some((n) => n.data.status === 'running' || n.data.status === 'queued');
    if (!busy) setRunning(false);
  }, [nodes]);

  // Автосохранение структуры. Шлём только её — результаты узлов принадлежат движку
  // (см. шапку electron/GraphStore.ts), холст не должен затирать их своей копией.
  useEffect(() => {
    if (loading || currentId === null || loadedIdRef.current !== currentId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const structure: GraphStructure = {
        nodes: nodes.map((n) => ({
          id: n.id,
          kind: n.data.kind,
          x: n.position.x,
          y: n.position.y,
          w: n.width ?? null,
          h: n.height ?? null,
          title: n.data.title,
          config: n.data.config,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          fromNode: e.source,
          fromPort: e.sourceHandle ?? 'text',
          toNode: e.target,
          toPort: e.targetHandle ?? 'context',
        })),
      };
      void window.oblako.saveGraph(currentId, structure);
    }, SAVE_DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [nodes, edges, currentId, loading]);

  const onNodesChange = useCallback((changes: NodeChange<RFNode>[]) => {
    for (const ch of changes) {
      // Узел убрали с холста — его живой сайт больше не нужен, иначе процесс чужой
      // страницы остался бы висеть до конца сессии. Для не-веб-узлов вызов безвреден.
      if (ch.type === 'remove' && currentId !== null) {
        void window.oblako.closeGraphWebApp(currentId, ch.id);
        setWebApps((cur) => cur.filter((w) => w.nodeId !== ch.id));
      }
    }
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, [currentId]);
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );
  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, id: crypto.randomUUID() }, es)),
    [],
  );

  const patchNode = useCallback((id: string, patch: { title?: string; config?: GraphNodeConfig }) => {
    setNodes((ns) => {
      // Правка конфига обесценивает и сам узел, и всё, что от него питается: результаты ниже
      // посчитаны по прежним входам. Без этой пометки они стояли бы с зелёной галкой «готово»
      // и выдавали устаревший текст за актуальный — ровно та ложь, из-за которой прогон узла
      // теперь тянет downstream (см. GraphEngine.runGraph). Переименование не в счёт: в
      // отпечаток входов заголовок не входит.
      const affected = patch.config
        ? downstreamOf([id], edgesRef.current.map((e) => ({
            id: e.id, fromNode: e.source, fromPort: e.sourceHandle ?? 'text',
            toNode: e.target, toPort: e.targetHandle ?? 'context',
          })))
        : new Set<string>();

      return ns.map((n) => {
        const base = n.id === id ? { ...n.data, ...patch } : n.data;
        const goesStale = affected.has(n.id) && base.status === 'done';
        if (n.id !== id && !goesStale) return n;
        return { ...n, data: goesStale ? { ...base, status: 'stale' as GraphNodeStatus } : base };
      });
    });
  }, []);

  const runNode = useCallback((id: string) => {
    if (currentId === null) return;
    window.oblako.runGraph(currentId, id);
  }, [currentId]);

  // Удаление узла. Связи чистим сами: applyNodeChanges убирает только сам узел, а висячая
  // связь на удалённый узел ломала бы топологическую сортировку в движке.
  const deleteNode = useCallback((id: string) => {
    onNodesChange([{ type: 'remove', id }]);
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
  }, [onNodesChange]);

  const openWebApp = useCallback((id: string) => {
    setNodes((ns) => {
      const node = ns.find((n) => n.id === id);
      const raw = (node?.data.config.url ?? '').trim();
      if (raw) {
        const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        // Имя хоста — подпись окна и буква иконки, как у пользовательских веб-приложений
        // панели. Заголовок узла важнее: его человек писал сам.
        let host = url;
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* оставим как есть */ }
        setWebAppNotes((prev) => { const next = { ...prev }; delete next[id]; return next; });
        setWebApps((cur) => {
          // Повторное «Открыть чат» не плодит окно, а поднимает уже открытое.
          const without = cur.filter((w) => w.nodeId !== id);
          return [...without, {
            nodeId: id,
            url,
            title: (node?.data.title ?? '').trim() || host,
            hostLabel: host,
          }];
        });
      }
      return ns; // читаем актуальный узел из состояния, само состояние не трогаем
    });
  }, []);

  const setNote = (nodeId: string, text: string) =>
    setWebAppNotes((prev) => ({ ...prev, [nodeId]: text }));

  const insertPrompt = async (nodeId: string) => {
    if (currentId === null) return;
    const ok = await window.oblako.insertGraphWebAppPrompt(currentId, nodeId);
    setNote(nodeId, ok
      ? 'Промпт вставлен — отправьте его сами'
      : 'Не нашёл поле ввода. Дождитесь загрузки страницы или вставьте текст вручную');
  };

  const captureAnswer = async (nodeId: string, mode: 'selection' | 'last') => {
    if (currentId === null) return;
    const text = await window.oblako.captureGraphWebAppAnswer(currentId, nodeId, mode);
    if (text) { setNote(nodeId, `Забрано ${text.length} символов — ответ лёг в узел`); return; }
    setNote(nodeId, mode === 'selection'
      ? 'Ничего не выделено — выделите ответ мышью и нажмите ещё раз'
      : 'Не нашёл последний ответ на этой странице — выделите его мышью');
  };

  // Клик по окну поднимает его над остальными — и React-рамку (последний в массиве),
  // и нативную вью (raiseGraphWebApp). Порядки обязаны совпадать.
  const focusWebApp = (nodeId: string) => {
    if (currentId !== null) void window.oblako.raiseGraphWebApp(currentId, nodeId);
    setWebApps((cur) => {
      if (cur[cur.length - 1]?.nodeId === nodeId) return cur; // уже сверху
      const target = cur.find((w) => w.nodeId === nodeId);
      return target ? [...cur.filter((w) => w.nodeId !== nodeId), target] : cur;
    });
  };

  const addNode = useCallback((kind: GraphNodeKind) => {
    setNodes((ns) => {
      // Каскадом от количества — новый узел не ложится ровно поверх предыдущего.
      const offset = ns.length * 34;
      return [...ns, {
        id: crypto.randomUUID(),
        type: 'oblako',
        position: { x: 80 + (offset % 340), y: 80 + offset * 0.6 },
        width: DEFAULT_NODE_SIZE[kind].w,
        height: DEFAULT_NODE_SIZE[kind].h,
        data: {
          kind,
          title: NODE_KINDS[kind].label,
          config: {},
          status: 'idle' as GraphNodeStatus,
          output: null,
          outputTitle: null,
          error: null,
          onPatch: () => {},
          onRun: () => {},
          onDelete: () => {},
          onOpenWebApp: () => {},
        },
      }];
    });
  }, []);

  // Колбэки вживляются на рендере, а в состоянии узлы лежат чистыми данными — иначе они
  // попали бы в автосейв и в сравнение состояний.
  const rfNodes = useMemo(
    () => nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        onPatch: (patch: { title?: string; config?: GraphNodeConfig }) => patchNode(n.id, patch),
        onRun: () => runNode(n.id),
        onDelete: () => deleteNode(n.id),
        onOpenWebApp: () => openWebApp(n.id),
      },
    })),
    [nodes, patchNode, runNode, deleteNode, openWebApp],
  );

  const commitRename = async () => {
    if (renamingId === null) return;
    const name = renameDraft.trim();
    const id = renamingId;
    setRenamingId(null);
    // Пустое имя — отказ от правки, а не «стереть название»: безымянный воркспейс в списке
    // не отличить от соседних.
    if (!name) return;
    await window.oblako.renameGraph(id, name);
    await refreshList();
  };

  const createWorkspace = async () => {
    const meta = await window.oblako.createGraph('Новый граф');
    if (!meta) return;
    await refreshList();
    await openGraph(meta.id);
  };

  const deleteWorkspace = async (graphId: number) => {
    await window.oblako.deleteGraph(graphId);
    const metas = await refreshList();
    if (graphId !== currentId) return;
    if (metas.length > 0) await openGraph(metas[0]!.id);
    else { setNodes([]); setEdges([]); setCurrentId(null); loadedIdRef.current = null; }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--app-bg)' }}>
      <aside
        style={{
          width: 208, flex: 'none', display: 'flex', flexDirection: 'column',
          borderRight: '1px solid var(--divider)', background: 'var(--surface-sunken)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 12px 8px' }}>
          <button
            type="button"
            onClick={onBack}
            title="Выйти из графов — к новой вкладке"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, flex: 'none',
              background: 'none', border: 0, padding: 0,
              borderRadius: 7, color: 'var(--text-body)', cursor: 'pointer',
            }}
          >
            <ArrowLeft size={16} />
          </button>
          <span
            style={{
              fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
              letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase', color: 'var(--text-muted)',
            }}
          >
            Графы
          </span>
          <button
            type="button"
            onClick={() => void createWorkspace()}
            title="Новый воркспейс"
            style={{
              marginLeft: 'auto', display: 'inline-flex', background: 'none', border: 0,
              padding: 4, borderRadius: 7, color: 'var(--text-body)', cursor: 'pointer',
            }}
          >
            <Plus size={15} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map((meta) => (
            <div
              key={meta.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
                background: meta.id === currentId ? 'var(--surface)' : 'transparent',
                color: meta.id === currentId ? 'var(--text-strong)' : 'var(--text-body)',
                fontSize: 'var(--fs-sm)',
                fontWeight: meta.id === currentId ? 'var(--fw-medium)' : 'var(--fw-regular)',
              }}
              onClick={() => { if (meta.id !== currentId) void openGraph(meta.id); }}
            >
              {renamingId === meta.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  style={{
                    flex: 1, minWidth: 0, background: 'var(--surface-sunken)',
                    border: '1px solid var(--accent)', borderRadius: 6, padding: '3px 6px',
                    color: 'var(--text-strong)', font: 'inherit',
                    fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)', outline: 'none',
                  }}
                />
              ) : (
                <span
                  // Двойной клик — привычный способ переименования списка; кнопка-карандаш
                  // рядом нужна, чтобы способ вообще было видно.
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenameDraft(meta.title);
                    setRenamingId(meta.id);
                  }}
                  style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {meta.title}
                </span>
              )}
              {renamingId !== meta.id && (
                <button
                  type="button"
                  title="Переименовать"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenameDraft(meta.title);
                    setRenamingId(meta.id);
                  }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 26, height: 26, flex: 'none',
                    background: 'none', border: 0, padding: 0,
                    borderRadius: 7, color: 'var(--text-faint)', cursor: 'pointer',
                  }}
                >
                  <Pencil size={13} />
                </button>
              )}
              <button
                type="button"
                title="Удалить воркспейс"
                onClick={(e) => { e.stopPropagation(); void deleteWorkspace(meta.id); }}
                // Цель клика 26×26, а не по размеру иконки: с прежними 17 пикселями в
                // корзину приходилось целиться, и промах читался как «кнопка не работает».
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 26, height: 26, flex: 'none',
                  background: 'none', border: 0, padding: 0,
                  borderRadius: 7, color: 'var(--text-faint)', cursor: 'pointer',
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
            padding: '10px 14px', borderBottom: '1px solid var(--divider)',
            background: 'var(--surface)',
          }}
        >
          {NODE_GROUPS.map((group, gi) => (
            <div key={group.title} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
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
                  onClick={() => addNode(kind)}
                  title={NODE_KINDS[kind].hint}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
                    borderRadius: 9, padding: '6px 11px', cursor: 'pointer',
                    color: 'var(--text-body)', font: 'inherit',
                    fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
                  }}
                >
                  <span style={{ fontSize: 14, lineHeight: 1 }}>{NODE_KINDS[kind].emoji}</span>
                  {NODE_KINDS[kind].label}
                </button>
              ))}
            </div>
          ))}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
            <button
              type="button"
              onClick={() => { if (currentId !== null) window.oblako.runGraph(currentId, null); }}
              disabled={running || currentId === null}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: running ? 'var(--surface-sunken)' : 'var(--accent)',
                color: running ? 'var(--text-muted)' : 'var(--text-on-accent)',
                border: 0, borderRadius: 9, padding: '7px 13px',
                cursor: running ? 'default' : 'pointer', font: 'inherit',
                fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)', fontFamily: 'var(--font-sans)',
              }}
            >
              <Play size={14} />
              Посчитать всё
            </button>
            {running && (
              <button
                type="button"
                onClick={() => { if (currentId !== null) void window.oblako.cancelGraphRun(currentId); }}
                title="Текущий узел досчитается — прервать генерацию модели нельзя"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
                  borderRadius: 9, padding: '7px 13px', cursor: 'pointer',
                  color: 'var(--text-body)', font: 'inherit',
                  fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
                }}
              >
                <Square size={13} />
                Остановить
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
          <ReactFlow
            nodes={rfNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            colorMode="system"
            proOptions={{ hideAttribution: false }}
            // Только Delete: Backspace на Windows слишком легко нажать по привычке правки
            // текста. React Flow сам не реагирует на клавиши внутри полей ввода, так что
            // печатать в узлах безопасно. Связь удаляется так же — выделить и нажать Delete.
            deleteKeyCode={['Delete']}
            fitView
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
          </div>

          {currentId !== null && webApps.map((app, i) => (
            <GraphWebAppWindow
              key={app.nodeId}
              graphId={currentId}
              nodeId={app.nodeId}
              url={app.url}
              title={app.title}
              hostLabel={app.hostLabel}
              note={webAppNotes[app.nodeId] ?? null}
              index={i}
              onFocus={() => focusWebApp(app.nodeId)}
              onClose={() => setWebApps((cur) => cur.filter((w) => w.nodeId !== app.nodeId))}
              onInsert={() => void insertPrompt(app.nodeId)}
              onCaptureSelection={() => void captureAnswer(app.nodeId, 'selection')}
              onCaptureLast={() => void captureAnswer(app.nodeId, 'last')}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
