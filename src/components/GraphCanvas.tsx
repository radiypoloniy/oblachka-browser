import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  applyNodeChanges,
  type Node, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphNodeConfig, GraphNodeKind, GraphNodeStatus } from '../../shared/graph';
import { NODE_KINDS } from '../../shared/graph';
import GraphNodeCard, { DEFAULT_NODE_SIZE, type GraphNodeData } from './graph/GraphNodeCard';
import NodeLibrary, { LibraryHandle } from './graph/NodeLibrary';
import RunBar from './graph/RunBar';
import { groundGrain } from '../styles/island';
import { documentIsDark } from '../newtab/gradients';
import { useGraphNodeActions } from './graph/useGraphNodeActions';
import { useGraphWebApps } from './graph/useGraphWebApps';
import { useGraphDoc } from './graph/useGraphDoc';
import GraphList from './graph/GraphList';
import GraphWebAppWindow, { type WebAppMode } from './graph/GraphWebAppWindow';
import ImagePresetEditor from './graph/ImagePresetEditor';
import TemplatePicker from './graph/TemplatePicker';
import NodeHistoryPanel from './graph/NodeHistoryPanel';
import NodeFullscreen from './graph/NodeFullscreen';
import type { GraphTemplate } from '../../shared/graphTemplates';
import { BUILT_IN_IMAGE_PRESETS } from '../../shared/imagePresets';
import type { ImagePreset } from '../../shared/imagePresets';

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

export default function GraphCanvas({ onBack }: { onBack: () => void }) {
  // Тема нужна только силе зерна. Читаем атрибут корня, а не тянем useChromeAppearance: тот
  // помимо признака темы правит землю окна и полосу системных кнопок — побочные действия,
  // которым на холсте графа делать нечего.
  const dark = documentIsDark();
  // Библиотека открыта по умолчанию: без неё на пустом холсте не видно, с чего начинать.
  const [libraryOpen, setLibraryOpen] = useState(true);
  // Документ: список холстов, открытый холст, его узлы и связи, ход прогона и автосейв
  // структуры — в useGraphDoc.
  const {
    list, currentId, setCurrentId, nodes, setNodes, edges, setEdges, rfEdges,
    running,
    loadedIdRef, nodesRef, edgesRef,
    refreshList, openGraph, onEdgesChange, onConnect,
  } = useGraphDoc({
    // ⚠️ useCallback обязателен: колбэк стоит в зависимостях эффекта первичной загрузки внутри
    // хука, и новая ссылка на каждый рендер запускала бы загрузку по кругу.
    onFirstRunEmpty: useCallback(() => setTemplatePickerOpen(true), []),
  });

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
  // Окна чужих AI-сайтов поверх холста — в useGraphWebApps.
  const { webApps, webAppNotes, openWebApp, setWebApps, setWebAppMode, focusWebApp,
    insertPrompt, captureAnswer, captureImage }
    = useGraphWebApps({ setNodes, nodesRef, currentId });

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

  // Действия над узлом (правка, прогон, удаление, файлы, дублирование + Ctrl+D) — в
  // useGraphNodeActions. Стоит ПОСЛЕ onNodesChange: тот уходит в хук параметром, потому что
  // удаление узла обязано идти через него (на remove висит закрытие живого сайта узла).
  const { patchNode, runNode, deleteNode, pickFile, pickImage, copyOutput, saveOutput, duplicateNodes }
    = useGraphNodeActions({ setNodes, setEdges, nodesRef, edgesRef, currentId, onNodesChange });
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
  // Что показывает полоса прогона. Считаем из статусов узлов, а не заводим второй счётчик в
  // main: статусы и так приезжают на каждый шаг, и другого источника правды тут быть не должно.
  const nowTitle = useMemo(() => {
    const now = nodes.find((n) => n.data.status === 'running');
    return now ? (now.data.title || NODE_KINDS[now.data.kind].label) : null;
  }, [nodes]);
  const queuedCount = useMemo(
    () => nodes.filter((n) => n.data.status === 'queued').length, [nodes],
  );

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
      <GraphList
        list={list} currentId={currentId} openGraph={openGraph}
        renamingId={renamingId} renameDraft={renameDraft}
        setRenamingId={setRenamingId} setRenameDraft={setRenameDraft}
        onBack={onBack} onNewGraph={() => setTemplatePickerOpen(true)}
        commitRename={commitRename} deleteWorkspace={deleteWorkspace}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', background: 'var(--surface-sunken)' }}>
          <div
            className="oblako-graph"
            style={{
              flex: 1, minWidth: 0, position: 'relative',
              // ⚠️ Зерно ЗЕМЛИ, тот же рецепт, что под островами окна (groundGrain в island.ts):
              // фрактальный шум калибра 0.65 в два октава, наложенный overlay. Холст — большая
              // пустая плоскость, и без фактуры она читается пластиком; тот же приём делает
              // землю окна бумагой, а не заливкой.
              // ⚠️ Слоем ФОНА, а не накладкой поверх: overlay поверх узлов положил бы крапины на
              // мелкий текст в карточках — ровно та жалоба, из-за которой в тёмной теме силу
              // зерна уменьшили втрое.
              backgroundImage: groundGrain(dark),
              backgroundBlendMode: 'overlay',
              backgroundRepeat: 'repeat',
              backgroundSize: '180px 180px',
            }}
          >
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
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
            {/* ⚠️ Шаг 22 и точка 1.4 вместо 18/1: при отдалении холста прежняя сетка сливалась
                в ровную серость и переставала быть опорой — ради которой она и нужна. */}
            <Background gap={22} size={1.4} />
            {/* ⚠️ Наверх справа: внизу слева, где библиотека React Flow ставит их по умолчанию,
                теперь стоит панель узлов, а внизу по центру — полоса прогона. */}
            <Controls showInteractive={false} position="top-right" />
            <MiniMap pannable zoomable />
          </ReactFlow>

          {libraryOpen
            ? <NodeLibrary onAdd={addNode} onClose={() => setLibraryOpen(false)} />
            : <LibraryHandle onOpen={() => setLibraryOpen(true)} />}

          <RunBar
            running={running}
            nowTitle={nowTitle}
            queued={queuedCount}
            canRun={!running && currentId !== null}
            onRun={() => { if (currentId !== null) window.oblako.runGraph(currentId, null); }}
            onStop={() => { if (currentId !== null) void window.oblako.cancelGraphRun(currentId); }}
          />
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
