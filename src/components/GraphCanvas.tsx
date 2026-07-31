import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  applyEdgeChanges, applyNodeChanges, addEdge,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Plus, Play, Square, Trash2, FileText, Globe, Sparkles, ArrowLeft, ArrowRight,
  AlignLeft, Network, BarChart3, ListChecks, MessagesSquare, X, ClipboardPaste, Download,
} from 'lucide-react';
import type {
  GraphDoc, GraphMeta, GraphNodeConfig, GraphNodeKind, GraphNodeStatus, GraphStructure,
} from '../../shared/graph';
import { NODE_KINDS } from '../../shared/graph';
import GraphNodeCard, { DEFAULT_NODE_SIZE, type GraphNodeData } from './graph/GraphNodeCard';
import { downstreamOf } from '../../shared/graph';

// Граф-воркспейс: холст рисует и складывает структуру, считает всё main (GraphEngine.ts).
// Логика прогона, обращения к модели и извлечение страниц сюда не переезжают — компонент
// только шлёт «посчитай» и слушает GRAPH_PROGRESS.
//
// Живые WebContentsView в узлы намеренно НЕ кладутся: нативные view нельзя ни отмасштабировать
// вместе с холстом, ни обрезать по его краю, ни увести под связи — они всегда рисуются поверх
// React-слоя. Веб-приложения приедут отдельным типом узла с панелью 1:1 (срез 3).

type RFNode = Node<GraphNodeData>;

const nodeTypes = { oblako: GraphNodeCard };

// Панель сгруппирована по роли узла, а не свалена в один ряд: восемь одинаковых кнопок
// подряд не читаются, а группы отвечают на вопрос «откуда взять — что сделать — что получить».
const NODE_GROUPS: { title: string; kinds: GraphNodeKind[] }[] = [
  { title: 'Откуда', kinds: ['source.url', 'source.note'] },
  { title: 'Обработка', kinds: ['qwen.transform', 'webapp.chat'] },
  { title: 'Артефакты', kinds: ['artifact.summary', 'artifact.mindmap', 'artifact.infographic', 'artifact.quiz'] },
  { title: 'Итог', kinds: ['output.text'] },
];

const NEW_NODE_ICONS: Record<GraphNodeKind, JSX.Element> = {
  'source.url': <Globe size={14} />,
  'source.note': <FileText size={14} />,
  'qwen.transform': <Sparkles size={14} />,
  'webapp.chat': <MessagesSquare size={14} />,
  'artifact.summary': <AlignLeft size={14} />,
  'artifact.mindmap': <Network size={14} />,
  'artifact.infographic': <BarChart3 size={14} />,
  'artifact.quiz': <ListChecks size={14} />,
  'output.text': <ArrowRight size={14} />,
};

const SAVE_DEBOUNCE_MS = 600;

const panelButton: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
  borderRadius: 9, padding: '6px 11px', cursor: 'pointer',
  color: 'var(--text-body)', font: 'inherit',
  fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
};

const panelPrimary: React.CSSProperties = {
  ...panelButton,
  background: 'var(--accent)', color: 'var(--text-on-accent)',
  border: '1px solid transparent', fontWeight: 'var(--fw-medium)',
};

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
  // Открытый узел-веб-приложение. Панель одна и показывает ровно один сайт: нативная вью
  // не умеет ни масштабироваться с холстом, ни обрезаться по его краю (см. шапку файла).
  const [webApp, setWebApp] = useState<{ nodeId: string; url: string } | null>(null);
  const [webAppNote, setWebAppNote] = useState<string | null>(null);
  const webAppHoleRef = useRef<HTMLDivElement | null>(null);

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
        if (p.status === 'error') data.error = p.error ?? 'Не получилось';
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
        setWebApp((cur) => (cur?.nodeId === ch.id ? null : cur));
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

  const openWebApp = useCallback((id: string) => {
    setNodes((ns) => {
      const raw = (ns.find((n) => n.id === id)?.data.config.url ?? '').trim();
      if (raw) {
        setWebAppNote(null);
        setWebApp({ nodeId: id, url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` });
      }
      return ns; // читаем актуальный узел из состояния, само состояние не трогаем
    });
  }, []);

  // Панель меряет свою «дырку» и шлёт координаты в main — тот же приём, что у контента
  // вкладок в App.tsx: React рисует рамку, main кладёт в неё WebContentsView.
  useEffect(() => {
    const hole = webAppHoleRef.current;
    if (!webApp || !hole || currentId === null) return;
    const rectOf = () => {
      const r = hole.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    void window.oblako.showGraphWebApp(currentId, webApp.nodeId, webApp.url, rectOf());
    const push = () => { void window.oblako.setGraphWebAppBounds(rectOf()); };
    const ro = new ResizeObserver(push);
    ro.observe(hole);
    window.addEventListener('resize', push);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', push);
      // Нулевой прямоугольник — сентинел «панель закрыта». Срабатывает и при уходе с
      // граф-режима: компонент размонтируется, чужой сайт не должен остаться поверх вкладок.
      void window.oblako.setGraphWebAppBounds({ x: 0, y: 0, width: 0, height: 0 });
    };
  }, [webApp, currentId]);

  const insertPrompt = async () => {
    if (!webApp || currentId === null) return;
    const ok = await window.oblako.insertGraphWebAppPrompt(currentId, webApp.nodeId);
    setWebAppNote(ok
      ? 'Промпт вставлен — отправьте его сами'
      : 'Не нашёл поле ввода. Дождитесь загрузки страницы или вставьте текст вручную');
  };

  const captureAnswer = async (mode: 'selection' | 'last') => {
    if (!webApp || currentId === null) return;
    const text = await window.oblako.captureGraphWebAppAnswer(currentId, webApp.nodeId, mode);
    if (text) { setWebAppNote(`Забрано ${text.length} символов — ответ лёг в узел`); return; }
    setWebAppNote(mode === 'selection'
      ? 'Ничего не выделено — выделите ответ мышью и нажмите ещё раз'
      : 'Не нашёл последний ответ на этой странице — выделите его мышью');
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
        onOpenWebApp: () => openWebApp(n.id),
      },
    })),
    [nodes, patchNode, runNode, openWebApp],
  );

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
            title="К новой вкладке"
            style={{
              display: 'inline-flex', background: 'none', border: 0, padding: 4,
              borderRadius: 7, color: 'var(--text-body)', cursor: 'pointer',
            }}
          >
            <ArrowLeft size={15} />
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
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {meta.title}
              </span>
              <button
                type="button"
                title="Удалить воркспейс"
                onClick={(e) => { e.stopPropagation(); void deleteWorkspace(meta.id); }}
                style={{
                  display: 'inline-flex', background: 'none', border: 0, padding: 2,
                  borderRadius: 5, color: 'var(--text-faint)', cursor: 'pointer',
                }}
              >
                <Trash2 size={13} />
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
                  {NEW_NODE_ICONS[kind]}
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
            fitView
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
          </div>

          {webApp && (
            <aside
              style={{
                width: 'min(48%, 720px)', minWidth: 380, flex: 'none',
                display: 'flex', flexDirection: 'column',
                borderLeft: '1px solid var(--divider)', background: 'var(--surface)',
              }}
            >
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
                  padding: '9px 12px', borderBottom: '1px solid var(--divider)',
                }}
              >
                <button type="button" onClick={() => void insertPrompt()} style={panelPrimary}>
                  <ClipboardPaste size={13} />
                  Вставить промпт
                </button>
                <button type="button" onClick={() => void captureAnswer('selection')} style={panelButton}>
                  <Download size={13} />
                  Забрать выделенное
                </button>
                <button type="button" onClick={() => void captureAnswer('last')} style={panelButton}>
                  Последний ответ
                </button>
                <button
                  type="button"
                  onClick={() => { setWebApp(null); setWebAppNote(null); }}
                  title="Закрыть панель"
                  style={{
                    marginLeft: 'auto', display: 'inline-flex', background: 'none', border: 0,
                    padding: 5, borderRadius: 7, color: 'var(--text-body)', cursor: 'pointer',
                  }}
                >
                  <X size={15} />
                </button>
              </div>

              {/* Подсказка про ручной обмен — она же место для ответа кнопок. Текст постоянный,
                  потому что это главное правило узла, а не разовое уведомление. */}
              <div
                style={{
                  padding: '7px 12px', borderBottom: '1px solid var(--divider)',
                  fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-snug)',
                  color: webAppNote ? 'var(--text-strong)' : 'var(--text-muted)',
                  background: 'var(--surface-sunken)',
                }}
              >
                {webAppNote ?? 'Отправляете вы сами: граф вставит промпт, а ответ заберёт по кнопке.'}
              </div>

              {/* «Дырка» под нативную вью — сюда main кладёт WebContentsView по координатам,
                  которые меряет этот div. Своего содержимого у него нет и быть не должно. */}
              <div ref={webAppHoleRef} style={{ flex: 1, minHeight: 0 }} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
