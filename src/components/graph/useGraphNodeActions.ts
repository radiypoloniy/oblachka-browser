import { useCallback, useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Edge, Node, NodeChange } from '@xyflow/react';
import type { GraphNodeConfig, GraphNodeStatus } from '../../../shared/graph';
import { downstreamOf } from '../../../shared/graph';
import type { GraphNodeData } from './GraphNodeCard';

type RFNode = Node<GraphNodeData>;

/**
 * Всё, что человек делает С УЗЛОМ: правка, прогон, удаление, подстановка файла и картинки,
 * копирование и сохранение результата, дублирование (в том числе по Ctrl+D).
 *
 * ⚠️ Вынесено из GraphCanvas целиком, включая горячую клавишу: она читает тот же nodesRef и
 * зовёт тот же duplicateNodes, и оставь её снаружи — связь между ними держалась бы только
 * порядком строк в тысячестрочном компоненте.
 */
export function useGraphNodeActions({ setNodes, setEdges, nodesRef, edgesRef, currentId, onNodesChange }: {
  setNodes: Dispatch<SetStateAction<RFNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  nodesRef: MutableRefObject<RFNode[]>;
  edgesRef: MutableRefObject<Edge[]>;
  currentId: number | null;
  // ⚠️ Удаление узла идёт ЧЕРЕЗ него, а не через setNodes: у React Flow на remove висит своя
  // уборка (см. onNodesChange в GraphCanvas — там же закрывается живой сайт узла).
  onNodesChange: (changes: NodeChange<RFNode>[]) => void;
}) {
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

  return { patchNode, runNode, deleteNode, pickFile, pickImage, copyOutput, saveOutput, duplicateNodes };
}
