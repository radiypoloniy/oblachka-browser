import { useCallback, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import type { GraphNodeKind, GraphNodeStatus } from '../../../shared/graph';
import type { GraphNodeData } from './GraphNodeCard';
import { DEFAULT_NODE_SIZE } from './GraphNodeCard';
import type { WebAppMode } from './GraphWebAppWindow';

type RFNode = Node<GraphNodeData>;

/**
 * Окна чужих AI-сайтов поверх холста: какие открыты, в каком режиме, кто сверху и что написано
 * в подписи под окном.
 *
 * ⚠️ Обмен с сайтом идёт ЧЕРЕЗ РУКУ ЧЕЛОВЕКА и остаётся таким: мы вставляем промпт в поле и
 * забираем ответ по кнопке, но отправляет сообщение он сам. Автоматизацией чужого интерфейса
 * это не является — см. разбор узла webapp.chat в docs/architecture-ai.md.
 *
 * ⚠️ Порядок наложения синхронизируется вручную и в двух местах сразу: React-рамки стыкуются по
 * DOM, нативные вью — по порядку addChildView. Отсюда focusWebApp, который поднимает разом обе.
 */
export function useGraphWebApps({ setNodes, nodesRef, currentId }: {
  setNodes: Dispatch<SetStateAction<RFNode[]>>;
  nodesRef: MutableRefObject<RFNode[]>;
  currentId: number | null;
}) {
  const [webApps, setWebApps] = useState<
    { nodeId: string; url: string; title: string; hostLabel: string; mode: WebAppMode }[]
  >([]);
  // Подсказка последнего действия — своя у каждого окна, иначе ответ одной кнопки
  // появлялся бы в чужом чате.
  const [webAppNotes, setWebAppNotes] = useState<Record<string, string>>({});

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

  return {
    webApps, webAppNotes, setWebApps, setWebAppMode, focusWebApp,
    openWebApp, insertPrompt, captureAnswer, captureImage,
  };
}
