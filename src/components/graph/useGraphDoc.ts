import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyEdgeChanges, addEdge } from '@xyflow/react';
import type { Connection, Edge, EdgeChange, Node } from '@xyflow/react';
import type { GraphDoc, GraphMeta, GraphNodeStatus, GraphStructure } from '../../../shared/graph';
import type { GraphNodeData } from './GraphNodeCard';
import { NODE_TONE, toneColor } from './nodeVisual';
import { DEFAULT_NODE_SIZE } from './GraphNodeCard';

type RFNode = Node<GraphNodeData>;

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
      onDuplicate: () => {},
      onShowHistory: () => {},
      onExpand: () => {},
      onPickFile: () => {},
      onPickImage: () => {},
      imagePresets: [],
      onEditPresets: () => {},
      onCopyOutput: () => {},
      onSaveOutput: () => {},
      onOpenWebApp: () => {},
      pullFromInput: null,
      inputLabels: [],
    },
  }));
}

/**
 * Как выглядит связь: цвет по узлу-ИСТОЧНИКУ, толщина по готовности, пунктир — пока цель считается.
 *
 * ⚠️ Цвет берётся у источника, а не у цели, потому что связь отвечает на вопрос «откуда это
 * пришло»: глядя на узел сборки, надо видеть, что в него втекает страница, а что — фактчек.
 * ⚠️ Бегущий пунктир — ЕДИНСТВЕННОЕ движение на холсте, и он отвечает ровно на «что происходит
 * прямо сейчас». Рисует его сама библиотека (`animated`), поэтому своих ключевых кадров нет и
 * системную настройку уменьшенного движения гасит одно правило в global.css.
 */
function decorateEdges(edges: Edge[], nodes: Node<GraphNodeData>[]): Edge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.map((e) => {
    const from = byId.get(e.source);
    const flowing = byId.get(e.target)?.data.status === 'running';
    const live = flowing || from?.data.status === 'done';
    return {
      ...e,
      animated: flowing,
      style: {
        stroke: live && from ? toneColor(NODE_TONE[from.data.kind]) : 'var(--divider-strong)',
        strokeWidth: live ? 2 : 1.4,
      },
    };
  });
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


/**
 * Жизненный цикл документа-графа: список холстов, открытый холст, его узлы и связи, ход прогона
 * из main и автосохранение структуры.
 *
 * ⚠️ Наверх шлём ТОЛЬКО структуру (узлы, позиции, конфиг, связи). Результаты узлов принадлежат
 * движку и пишутся им же (см. шапку electron/GraphStore.ts): затирай их холст своей копией — и
 * автосейв стирал бы свежий выхлоп узла устаревшим снимком.
 *
 * ⚠️ `onNodesChange` СЮДА НЕ ВХОДИТ и остаётся в компоненте. Он — мост между двумя мирами: на
 * remove ему нужно и убрать узел (setNodes отсюда), и закрыть живой сайт этого узла
 * (setWebApps из useGraphWebApps). Затащи его в любой из двух хуков, и второй пришлось бы
 * пробрасывать в него колбэком.
 */
export function useGraphDoc({ onFirstRunEmpty }: {
  /** Первый запуск: холст создан, но пуст — компонент показывает выбор схемы. */
  onFirstRunEmpty: () => void;
}) {
  const [list, setList] = useState<GraphMeta[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [nodes, setNodes] = useState<RFNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  // Открытые узлы-веб-приложения. Их может быть несколько: держать рядом ChatGPT и Gemini,
  // сравнивая ответы, — основной сценарий графа. Порядок в массиве = порядок наложения,
  // последний сверху (см. focusWebApp).
  // Переименование воркспейса прямо в списке: id строки в правке и текущий черновик.
  const loadedIdRef = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Связи нужны patchNode для пометки «устарел», но через замыкание они пересоздавали бы
  // колбэки на каждое движение мыши по холсту — держим их зеркалом в ref.
  const edgesRef = useRef<Edge[]>([]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  const nodesRef = useRef<RFNode[]>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

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
        // Первый запуск: пустой воркспейс заводим сразу (иначе холсту нечего показывать),
        // но следом открываем выбор схемы — это первое, что видит человек.
        const created = await window.oblako.createGraph('Мой первый граф');
        if (!alive || !created) { setLoading(false); return; }
        await refreshList();
        await openGraph(created.id);
        if (alive) onFirstRunEmpty();
      }
    })();
    return () => { alive = false; };
  }, [openGraph, refreshList, onFirstRunEmpty]);

  // Граф мог пополниться снаружи — из ПКМ «Добавить в граф» на странице или в сайдбаре.
  // Перечитываем целиком: узлы добавились в базу мимо холста, и локального состояния,
  // которое можно было бы подшить, у нас нет.
  useEffect(() => {
    return window.oblako.onGraphChanged((graphId) => {
      void refreshList();
      if (graphId === loadedIdRef.current) void openGraph(graphId);
    });
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

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );
  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, id: crypto.randomUUID() }, es)),
    [],
  );

  // Связи для отрисовки: те же данные плюс цвет и состояние. Живут отдельно от `edges`, потому
  // что в автосейв уезжает именно чистая структура — украшения в файл графа попасть не должны.
  const rfEdges = useMemo(() => decorateEdges(edges, nodes), [edges, nodes]);

  return {
    list, currentId, setCurrentId, nodes, setNodes, edges, setEdges, rfEdges,
    running, setRunning, loading,
    loadedIdRef, nodesRef, edgesRef,
    refreshList, openGraph, onEdgesChange, onConnect,
  };
}
