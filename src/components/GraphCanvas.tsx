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
import GraphWebAppWindow, { type WebAppMode } from './graph/GraphWebAppWindow';
import ImagePresetEditor from './graph/ImagePresetEditor';
import TemplatePicker from './graph/TemplatePicker';
import NodeHistoryPanel from './graph/NodeHistoryPanel';
import NodeFullscreen from './graph/NodeFullscreen';
import type { GraphTemplate } from '../../shared/graphTemplates';
import { BUILT_IN_IMAGE_PRESETS } from '../../shared/imagePresets';
import type { ImagePreset } from '../../shared/imagePresets';
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
  { title: 'Откуда', kinds: ['source.url', 'source.file', 'source.note', 'source.image'] },
  { title: 'Обработка', kinds: ['qwen.transform', 'qwen.chat', 'image.prompt', 'webapp.chat'] },
  { title: 'Проверка', kinds: ['search.web', 'factcheck.gemini'] },
  { title: 'Артефакты', kinds: ['artifact.summary', 'artifact.mindmap', 'artifact.infographic', 'artifact.quiz'] },
  { title: 'Итог', kinds: ['draft.text', 'compose.doc', 'output.text'] },
  { title: 'Пометки', kinds: ['sticker'] },
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
    { nodeId: string; url: string; title: string; hostLabel: string; mode: WebAppMode }[]
  >([]);
  // Подсказка последнего действия — своя у каждого окна, иначе ответ одной кнопки
  // появлялся бы в чужом чате.
  const [webAppNotes, setWebAppNotes] = useState<Record<string, string>>({});
  // Переименование воркспейса прямо в списке: id строки в правке и текущий черновик.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Пресеты картинок: встроенные приходят из shared, пользовательские — из базы.
  const [userPresets, setUserPresets] = useState<ImagePreset[]>([]);
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  // Раскрытый узел — один на холст. Держим id, а не копию данных: узел продолжает считаться,
  // и раскрытый вид должен показывать тот же стрим, что и карточка.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<
    { nodeId: string; title: string; output: string | null } | null
  >(null);
  // Берём узел из состояния по id: пока он раскрыт, стрим Qwen продолжает докладывать
  // чанки, и раскрытый вид обязан их показывать так же, как карточка.
  const expandedNode = useMemo(
    () => (expandedId ? nodes.find((n) => n.id === expandedId) ?? null : null),
    [expandedId, nodes],
  );

  const allPresets = useMemo(
    () => [...BUILT_IN_IMAGE_PRESETS, ...userPresets],
    [userPresets],
  );

  const refreshPresets = useCallback(async () => {
    setUserPresets(await window.oblako.listImagePresets());
  }, []);
  useEffect(() => { void refreshPresets(); }, [refreshPresets]);

  // Пока идёт загрузка графа, автосейв обязан молчать: иначе пустое стартовое состояние
  // успело бы записаться поверх только что открытого воркспейса.
  const loadedIdRef = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Связи нужны patchNode для пометки «устарел», но через замыкание они пересоздавали бы
  // колбэки на каждое движение мыши по холсту — держим их зеркалом в ref.
  const edgesRef = useRef<Edge[]>([]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  const nodesRef = useRef<RFNode[]>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // Прямоугольник графа в координатах окна — плавающие окна веб-приложений позиционируются
  // относительно него, а не вьюпорта (иначе садятся поверх сайдбара браузера).
  const rootRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ x: 0, y: 0, w: 1200, h: 800 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setArea({ x: r.x, y: r.y, w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

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
        if (alive) setTemplatePickerOpen(true);
      }
    })();
    return () => { alive = false; };
  }, [openGraph, refreshList]);

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

  // Диалог открывает main; сюда возвращается только путь, чтобы показать имя файла
  // и положить его в конфиг. Читает документ всегда main (electron/FileExtract.ts).
  const pickFile = useCallback(async (id: string) => {
    const chosen = await window.oblako.pickGraphFile();
    if (!chosen) return;
    setNodes((ns) => ns.map((n) => (n.id === id
      ? { ...n, data: { ...n.data, config: { ...n.data.config, path: chosen } } }
      : n)));
  }, []);

  const pickImage = useCallback(async (id: string) => {
    const chosen = await window.oblako.pickGraphImage();
    if (!chosen) return;
    setNodes((ns) => ns.map((n) => (n.id === id
      ? { ...n, data: { ...n.data, config: { ...n.data.config, path: chosen } } }
      : n)));
  }, []);

  // Результат наружу. Обе операции читают актуальный узел из состояния через setNodes:
  // замыкание на nodes пересоздавало бы колбэки на каждое движение по холсту.
  const copyOutput = useCallback((id: string) => {
    setNodes((ns) => {
      const text = ns.find((n) => n.id === id)?.data.output;
      if (text) void navigator.clipboard.writeText(text);
      return ns;
    });
  }, []);

  const saveOutput = useCallback((id: string) => {
    setNodes((ns) => {
      const node = ns.find((n) => n.id === id);
      const text = node?.data.output;
      if (text) {
        const name = (node?.data.outputTitle || node?.data.title || 'результат').trim();
        void window.oblako.saveGraphOutput(name, text);
      }
      return ns;
    });
  }, []);

  // Дублирование. Копируем настройку узла (тип, заголовок, конфиг, размер), но НЕ результат:
  // у копии свои входы, и чужой выхлоп с чужим отпечатком выглядел бы как уже посчитанный.
  // Связи МЕЖДУ копируемыми узлами тоже дублируются — иначе копировать цепочку бессмысленно,
  // а связи наружу нет: к какому из двух одинаковых узлов их вести, решает человек.
  const duplicateNodes = useCallback((ids: string[]) => {
    const source = nodesRef.current.filter((n) => ids.includes(n.id));
    if (!source.length) return;
    const idMap = new Map(source.map((n) => [n.id, crypto.randomUUID()]));

    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      ...source.map((n) => ({
        ...n,
        id: idMap.get(n.id)!,
        position: { x: n.position.x + 48, y: n.position.y + 48 },
        selected: true,
        data: {
          ...n.data,
          status: 'idle' as GraphNodeStatus,
          output: null, outputTitle: null, error: null,
        },
      })),
    ]);
    setEdges((es) => [
      ...es,
      ...es
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({
          ...e,
          id: crypto.randomUUID(),
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
        })),
    ]);
  }, []);

  // Ctrl+D. Печать в полях узла не должна дублировать узел, поэтому пропускаем событие,
  // если фокус в поле ввода — тот же гвард, что React Flow ставит своим горячим клавишам.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key.toLowerCase() !== 'd') return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      const selected = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
      if (!selected.length) return;
      e.preventDefault();
      duplicateNodes(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duplicateNodes]);

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
            mode: 'floating' as WebAppMode,
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

  // Картинка из чата: main сохраняет файл, холст заводит рядом узел «Картинка». Узел, а не
  // поле у веб-чата: изображение — самостоятельный материал, его подключают куда нужно.
  const captureImage = async (nodeId: string) => {
    if (currentId === null) return;
    setNote(nodeId, 'Забираю картинку…');
    const res = await window.oblako.captureWebAppImage(currentId, nodeId);
    if (!res.ok || !res.path) {
      setNote(nodeId, res.error ?? 'Картинку забрать не вышло');
      return;
    }
    const from = nodesRef.current.find((n) => n.id === nodeId);
    const id = crypto.randomUUID();
    setNodes((ns) => [...ns, {
      id,
      type: 'oblako',
      position: { x: (from?.position.x ?? 0) + 360, y: (from?.position.y ?? 0) + 120 },
      width: DEFAULT_NODE_SIZE['source.image'].w,
      height: DEFAULT_NODE_SIZE['source.image'].h,
      data: {
        kind: 'source.image' as GraphNodeKind,
        title: 'Картинка из чата',
        config: { path: res.path },
        status: 'idle' as GraphNodeStatus,
        output: null, outputTitle: null, error: null,
        onPatch: () => {}, onRun: () => {}, onDelete: () => {}, onDuplicate: () => {},
        onShowHistory: () => {}, onExpand: () => {}, onPickFile: () => {}, onPickImage: () => {},
        imagePresets: [], onEditPresets: () => {},
        onCopyOutput: () => {}, onSaveOutput: () => {}, onOpenWebApp: () => {},
        pullFromInput: null, inputLabels: [],
      },
    }]);
    setNote(nodeId, 'Картинка забрана — узел появился на холсте');
  };

  const setWebAppMode = (nodeId: string, mode: WebAppMode) => {
    setWebApps((cur) => {
      const next = cur.map((w) => {
        if (w.nodeId === nodeId) return { ...w, mode };
        // Развёрнутый сайт ровно один: предыдущий возвращается в плавающий режим.
        if (mode === 'fullscreen' && w.mode === 'fullscreen') return { ...w, mode: 'floating' as WebAppMode };
        return w;
      });
      if (mode !== 'docked') return next;
      // В доке помещаются два. Третий вытесняет самый старый — он же самый дальний
      // в массиве, порядок которого совпадает с порядком открытия и подъёма.
      const docked = next.filter((w) => w.mode === 'docked');
      if (docked.length <= 2) return next;
      const evicted = docked.slice(0, docked.length - 2).map((w) => w.nodeId);
      return next.map((w) => (evicted.includes(w.nodeId) ? { ...w, mode: 'floating' as WebAppMode } : w));
    });
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
        onDuplicate: () => duplicateNodes([n.id]),
        onShowHistory: () => setHistoryFor({ nodeId: n.id, title: n.data.title || NODE_KINDS[n.data.kind].label, output: n.data.output }),
        onExpand: () => setExpandedId(n.id),
        onPickFile: () => void pickFile(n.id),
        onPickImage: () => void pickImage(n.id),
        imagePresets: allPresets,
        onEditPresets: () => setPresetEditorOpen(true),
        onCopyOutput: () => void copyOutput(n.id),
        onSaveOutput: () => void saveOutput(n.id),
        onOpenWebApp: () => openWebApp(n.id),
        // Черновик: подставить выхлоп питающих узлов. Считаем прямо здесь, потому что связи
        // и соседние узлы знает только холст. null — значит подставлять пока нечего, и
        // кнопка в карточке гаснет сама.
        pullFromInput: (() => {
          if (n.data.kind !== 'draft.text') return null;
          const feed = edges
            .filter((e) => e.target === n.id)
            .map((e) => nodes.find((x) => x.id === e.source)?.data.output)
            .filter((o): o is string => typeof o === 'string' && o.trim().length > 0);
          if (!feed.length) return null;
          const text = feed.join('\n\n');
          return () => patchNode(n.id, { config: { ...n.data.config, text } });
        })(),
        // Легенда шаблона сборки. Порядок — по связям, ровно как собирает движок; ready
        // отмечает узлы без результата, потому что их движок в нумерацию не берёт.
        inputLabels: n.data.kind !== 'compose.doc' ? [] : edges
          .filter((e) => e.target === n.id)
          .map((e) => {
            const from = nodes.find((x) => x.id === e.source);
            return {
              title: from?.data.title || (from ? NODE_KINDS[from.data.kind].label : ''),
              ready: typeof from?.data.output === 'string' && from.data.output.trim().length > 0,
            };
          }),
      },
    })),
    [nodes, edges, patchNode, runNode, deleteNode, duplicateNodes, pickFile, pickImage, openWebApp,
      allPresets, copyOutput, saveOutput],
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

  // Шаблон — чистые данные; свежие uuid раздаём здесь, иначе два графа из одной схемы
  // делили бы ключи узлов и правка одного ломала бы другой.
  // Развёрнутый сайт ровно один, и пока он есть — остальные прячутся: нативные вью
  // всплыли бы поверх него, React-слой их не перекрывает.
  const fullscreenAppId = webApps.find((w) => w.mode === 'fullscreen')?.nodeId ?? null;
  const dockedApps = webApps.filter((w) => w.mode === 'docked');

  const renderWebApp = (
    app: { nodeId: string; url: string; title: string; hostLabel: string; mode: WebAppMode },
    graphId: number,
  ) => (
    <GraphWebAppWindow
      key={app.nodeId}
      graphId={graphId}
      nodeId={app.nodeId}
      url={app.url}
      title={app.title}
      hostLabel={app.hostLabel}
      note={webAppNotes[app.nodeId] ?? null}
      index={webApps.findIndex((w) => w.nodeId === app.nodeId)}
      mode={app.mode}
      area={area}
      hidden={fullscreenAppId !== null && app.nodeId !== fullscreenAppId}
      onSetMode={(mode) => setWebAppMode(app.nodeId, mode)}
      onFocus={() => focusWebApp(app.nodeId)}
      onClose={() => setWebApps((cur) => cur.filter((w) => w.nodeId !== app.nodeId))}
      onInsert={() => void insertPrompt(app.nodeId)}
      onCaptureSelection={() => void captureAnswer(app.nodeId, 'selection')}
      onCaptureLast={() => void captureAnswer(app.nodeId, 'last')}
      onCaptureImage={() => void captureImage(app.nodeId)}
    />
  );

  const createWorkspace = async (template: GraphTemplate | null) => {
    const meta = await window.oblako.createGraph(template ? template.label : 'Новый граф');
    if (!meta) return;
    if (template) {
      const idMap = new Map(template.nodes.map((n) => [n.id, crypto.randomUUID()]));
      await window.oblako.saveGraph(meta.id, {
        nodes: template.nodes.map((n) => ({
          id: idMap.get(n.id)!,
          kind: n.kind,
          x: n.x, y: n.y, w: null, h: null,
          title: n.title,
          config: { ...n.config },
        })),
        edges: template.edges.map((e) => ({
          id: crypto.randomUUID(),
          fromNode: idMap.get(e.from)!,
          // Порт входа у всех типов один и тот же — 'context'; выход источников — 'text'.
          fromPort: 'text',
          toNode: idMap.get(e.to)!,
          toPort: 'context',
        })),
      });
    }
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
    // Граф — «страница», а не прозрачный экран хаба: Hub намеренно не получает островной
    // рамки (сквозь него просвечивает --canvas, см. TAB_FRAME_VISUAL в App.tsx), поэтому
    // плиту граф заводит себе сам. Без неё его непрозрачные подложки шли до краёв области
    // с прямыми углами и выбивались из системы.
    <div
      ref={rootRef}
      style={{
        position: 'absolute', inset: 0, display: 'flex', overflow: 'hidden',
        background: 'var(--surface-solid)',
        borderRadius: 'var(--radius-island)',
        boxShadow: 'var(--shadow-island)',
      }}
    >
      <aside
        style={{
          width: 208, flex: 'none', display: 'flex', flexDirection: 'column',
          // Тот же рецепт, что у навигации настроек (Settings.tsx): прозрачный рейл на плите
          // страницы и разделитель --divider-strong. Своей серой заливки он иметь не должен.
          borderRight: '1px solid var(--divider-strong)',
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
              borderRadius: '50%', color: 'var(--text-body)', cursor: 'pointer',
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
            onClick={() => setTemplatePickerOpen(true)}
            title="Новый воркспейс"
            style={{
              marginLeft: 'auto', display: 'inline-flex', background: 'none', border: 0,
              padding: 4, borderRadius: '50%', color: 'var(--text-body)', cursor: 'pointer',
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
                padding: '7px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: meta.id === currentId ? 'var(--surface)' : 'transparent',
                boxShadow: meta.id === currentId ? 'var(--shadow-card)' : 'none',
                color: meta.id === currentId ? 'var(--text-strong)' : 'var(--text-body)',
                fontSize: 'var(--fs-sm)',
                fontWeight: meta.id === currentId ? 'var(--fw-semibold)' : 'var(--fw-regular)',
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
                    border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', padding: '3px 6px',
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
                    borderRadius: '50%', color: 'var(--text-faint)', cursor: 'pointer',
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
                  borderRadius: '50%', color: 'var(--text-faint)', cursor: 'pointer',
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
            display: 'flex', alignItems: 'center', gap: 6, rowGap: 6, flexWrap: 'wrap',
            padding: '9px 12px', borderBottom: '1px solid var(--divider-strong)',
          }}
        >
          {NODE_GROUPS.map((group, gi) => (
            <div key={group.title} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                    borderRadius: 'var(--radius-chip)', padding: '5px 10px', cursor: 'pointer',
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
                border: 0, borderRadius: 'var(--radius-chip)', padding: '7px 13px',
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
                  borderRadius: 'var(--radius-chip)', padding: '7px 13px', cursor: 'pointer',
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

        <div style={{ flex: 1, minHeight: 0, display: 'flex', background: 'var(--surface-sunken)' }}>
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

          {expandedNode && currentId !== null && (
            <NodeFullscreen
              graphId={currentId}
              nodeId={expandedNode.id}
              kind={expandedNode.data.kind}
              title={expandedNode.data.title}
              status={expandedNode.data.status}
              output={expandedNode.data.output}
              outputTitle={expandedNode.data.outputTitle}
              error={expandedNode.data.error}
              onClose={() => setExpandedId(null)}
              onRun={() => runNode(expandedNode.id)}
              onCopyOutput={() => copyOutput(expandedNode.id)}
              onSaveOutput={() => void saveOutput(expandedNode.id)}
              onShowHistory={() => setHistoryFor({
                nodeId: expandedNode.id,
                title: expandedNode.data.title || NODE_KINDS[expandedNode.data.kind].label,
                output: expandedNode.data.output,
              })}
              config={expandedNode.data.config}
              onConfigChange={(config) => patchNode(expandedNode.id, { config })}
            />
          )}

          {templatePickerOpen && (
            <TemplatePicker
              onClose={() => setTemplatePickerOpen(false)}
              onPick={(template) => { setTemplatePickerOpen(false); void createWorkspace(template); }}
            />
          )}

          {historyFor && currentId !== null && (
            <NodeHistoryPanel
              graphId={currentId}
              nodeId={historyFor.nodeId}
              nodeTitle={historyFor.title}
              current={historyFor.output}
              onClose={() => setHistoryFor(null)}
            />
          )}

          {presetEditorOpen && (
            <ImagePresetEditor
              presets={userPresets}
              onClose={() => setPresetEditorOpen(false)}
              onSave={async (preset) => { await window.oblako.saveImagePreset(preset); await refreshPresets(); }}
              onDelete={async (id) => { await window.oblako.deleteImagePreset(id); await refreshPresets(); }}
            />
          )}

          {/* Все открытые сайты рисуются одним компонентом; раскладку задаёт режим.
              Закреплённые лежат в правом доке (он сжимает холст, как боковая панель
              браузера), остальные — поверх. */}
          {currentId !== null && dockedApps.length > 0 && (
            <aside
              style={{
                width: 'min(38%, 460px)', minWidth: 340, flex: 'none',
                display: 'flex', flexDirection: 'column', gap: 8, padding: 8,
                borderLeft: '1px solid var(--divider-strong)',
              }}
            >
              {dockedApps.map((app) => renderWebApp(app, currentId))}
            </aside>
          )}
          {currentId !== null && webApps
            .filter((app) => app.mode !== 'docked')
            .map((app) => renderWebApp(app, currentId))}
        </div>
      </div>
    </div>
  );
}
