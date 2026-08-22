// Дерево вкладок: сохранение в сессию и восстановление из неё — чистой логикой, без Electron.
//
// ⚠️ Зачем это отдельный файл. Это самое дорогое место проекта при поломке: здесь решается,
// какие вкладки человек увидит после перезапуска. Пока логика жила приватными методами внутри
// TabManager, проверить её было нечем — TabManager тянет WebContentsView, то есть поднимается
// только вместе с приложением и живым профилем. Вынесенная сюда, она проверяется round-trip'ом
// «дерево → сохранили → восстановили → то же дерево» за миллисекунды (scripts/session-roundtrip-check.mjs).
//
// TabManager остаётся владельцем состояния и передаёт сюда доступ к вкладкам (TabView) — здесь
// нет ни одного обращения к его полям.
// ⚠️ Значимых импортов тут быть НЕ должно, только типовые. Проверка гоняется голым node
// (--experimental-strip-types), а он требует расширения в пути; `tsc` с эмитом расширения не
// принимает. Типовые импорты стираются и этой проблемы не создают, а вот `import { X } from
// './layout'` сломал бы прогон. Отсюда же и место для констант ниже.
import type { SidebarNode } from './ipc';
import type { SavedNode, SavedSingleNode, SavedSplitPairNode } from './session';

// Пределы доли левой панели в split. Тем же зажимом пользуется и TabManager.setSplitRatio —
// здесь он нужен потому, что ratio приходит ИЗ ФАЙЛА: недоверенное число, которое без зажима
// увело бы панель за край окна.
export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;

// Всё, что нужно знать о вкладке, чтобы её сохранить. TabManager собирает это из ManagedTab.
export interface TabView {
  url: string;
  title?: string;
  faviconData?: string;
  /** Профиль вкладки. Пусто — вкладка из файла, записанного до появления профилей. */
  profileId?: string;
  // Короткоживущие (OAuth-попапы) и приватные вкладки в сессию не идут: воскрешать страницу
  // логина незачем, а приватная не «воскресает» по определению.
  savable: boolean;
}

export interface SerializeDeps {
  // null — вкладки нет в tabMap (узел осиротел).
  view(tabId: string): TabView | null;
  // Живой ratio показываемой или припаркованной пары; null — пары сейчас нет, берём из узла.
  liveRatio(leftTabId: string): number | null;
}

function toSavedSingle(v: TabView): SavedSingleNode {
  const node: SavedSingleNode = { type: 'single', url: v.url };
  if (v.title) node.title = v.title;
  if (v.faviconData) node.faviconData = v.faviconData;
  if (v.profileId) node.profileId = v.profileId;
  return node;
}

// Рекурсивная сериализация узлов с деградацией split-pair при отсутствии сохраняемых вкладок.
export function serializeNodes(nodes: SidebarNode[], d: SerializeDeps): SavedNode[] {
  const result: SavedNode[] = [];
  for (const node of nodes) {
    if (node.type === 'single') {
      const v = d.view(node.tabId);
      if (!v) continue;
      if (v.savable) result.push(toSavedSingle(v));
    } else if (node.type === 'split-pair') {
      const left = d.view(node.leftTabId);
      const right = d.view(node.rightTabId);
      const leftOk = !!left && left.savable;
      const rightOk = !!right && right.savable;
      if (leftOk && rightOk) {
        // «Живой» ratio — если эта пара сейчас существует (показываемая или припаркованная,
        // неважно: ratio актуален в обоих случаях), иначе берём из узла.
        const ratio = d.liveRatio(node.leftTabId) ?? node.ratio;
        const pairNode: SavedSplitPairNode = {
          type: 'split-pair', leftUrl: left!.url, rightUrl: right!.url, ratio,
        };
        if (left!.title) pairNode.leftTitle = left!.title;
        if (right!.title) pairNode.rightTitle = right!.title;
        if (left!.faviconData) pairNode.leftFaviconData = left!.faviconData;
        if (right!.faviconData) pairNode.rightFaviconData = right!.faviconData;
        result.push(pairNode);
      } else if (leftOk) {
        result.push(toSavedSingle(left!));
      } else if (rightOk) {
        result.push(toSavedSingle(right!));
      }
    } else if (node.type === 'group') {
      const children = serializeNodes(node.children, d);
      // Пустая группа в сессию не идёт: после рестарта это была бы пустая полоса без вкладок.
      if (children.length > 0) {
        result.push({
          type: 'group', id: node.id, label: node.label,
          color: node.color, collapsed: node.collapsed, children,
        });
      }
    }
  }
  return result;
}

// Рекурсивный подсчёт вкладок в сериализованном дереве.
export function countSavedTabs(nodes: SavedNode[]): number {
  let count = 0;
  for (const n of nodes) {
    if (n.type === 'single') count++;
    else if (n.type === 'split-pair') count += 2;
    else if (n.type === 'group') count += countSavedTabs(n.children);
  }
  return count;
}

// Восстанавливает дерево узлов из сохранённой сессии.
// urlToIds: URL → очередь tabId (поддерживает дубликаты URL — две вкладки одного адреса).
// ⚠️ Очередь РАСХОДУЕТСЯ (shift): тот же URL во втором узле получит следующий id, а не первый.
export function buildNodesFromSaved(saved: SavedNode[], urlToIds: Map<string, string[]>): SidebarNode[] {
  const target: SidebarNode[] = [];
  for (const s of saved) {
    if (s.type === 'single') {
      const id = urlToIds.get(s.url)?.shift();
      if (id) target.push({ type: 'single', tabId: id });
    } else if (s.type === 'split-pair') {
      const leftId = urlToIds.get(s.leftUrl)?.shift();
      const rightId = urlToIds.get(s.rightUrl)?.shift();
      if (leftId && rightId) {
        const ratio = Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, s.ratio));
        target.push({ type: 'split-pair', leftTabId: leftId, rightTabId: rightId, ratio });
      }
    } else if (s.type === 'group') {
      target.push({
        type: 'group', id: s.id, label: s.label,
        color: s.color, collapsed: s.collapsed,
        children: buildNodesFromSaved(s.children, urlToIds),
      });
    }
  }
  return target;
}

export interface RestoredPair {
  leftId: string;
  rightId: string;
  ratio: number;
}

// Собирает КАЖДУЮ split-pair дерева (рекурсивно, включая группы) — не только первую. Какая из
// них окажется показываемой после restore, решает activate(targetId), а не порядок здесь.
export function collectSplitPairs(nodes: SidebarNode[]): RestoredPair[] {
  const out: RestoredPair[] = [];
  for (const node of nodes) {
    if (node.type === 'split-pair') {
      out.push({ leftId: node.leftTabId, rightId: node.rightTabId, ratio: node.ratio });
    } else if (node.type === 'group') {
      out.push(...collectSplitPairs(node.children));
    }
  }
  return out;
}
