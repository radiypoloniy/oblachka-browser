import { randomUUID } from 'node:crypto';
import type { MenuItemConstructorOptions } from 'electron';
import type { GraphStructureNode } from '../shared/graph';
import type { GraphStore } from './GraphStore';

// «Добавить в граф» из контекстных меню браузера: ссылка, вкладка, папка вкладок.
//
// Узлы дописываются В БАЗУ, а не в открытый холст, потому что чаще всего холста на экране
// нет — человек читает страницу. Открытый холст узнаёт о добавлении по событию и
// перечитывает граф; закрытый увидит новые узлы при следующем открытии.

const NODE_W = 268;
const NODE_H = 268;
const COL_GAP = 40;
const ROW_GAP = 28;
// Больше четырёх в столбец — и пачка уезжает далеко вниз; дальше идём вторым столбцом.
const PER_COLUMN = 4;

export interface InboxItem {
  url: string;
  title: string;
}

// Возвращает id графа, в который добавили (или null, если не вышло).
export function addItemsToGraph(
  store: GraphStore,
  graphId: number | null,
  items: InboxItem[],
  stickerText?: string,
): number | null {
  const clean = items.filter((i) => /^https?:\/\//i.test(i.url));
  if (clean.length === 0) return null;

  let target = graphId;
  if (target === null) {
    const created = store.create(stickerText?.trim() || 'Собрано из браузера');
    if (!created) return null;
    target = created.id;
  }

  // Ставим пачку правее всего, что уже есть: садиться поверх существующих узлов нельзя,
  // а автолейаута в проекте пока нет.
  const startX = store.rightEdge(target) + COL_GAP;
  const nodes: GraphStructureNode[] = [];

  // Стикер — над пачкой, чтобы сразу читалось, откуда она.
  if (stickerText?.trim()) {
    nodes.push({
      id: randomUUID(),
      kind: 'sticker',
      x: startX,
      y: -70,
      w: 300,
      h: 56,
      title: '',
      config: { text: stickerText.trim() },
    });
  }

  clean.forEach((item, i) => {
    const col = Math.floor(i / PER_COLUMN);
    const row = i % PER_COLUMN;
    nodes.push({
      id: randomUUID(),
      kind: 'source.url',
      x: startX + col * (NODE_W + COL_GAP),
      y: row * (NODE_H + ROW_GAP),
      w: null,
      h: null,
      // Заголовок вкладки — куда осмысленнее, чем «Страница» одиннадцать раз подряд.
      title: item.title.slice(0, 60) || 'Страница',
      config: { url: item.url },
    });
  });

  store.appendNodes(target, nodes);
  return target;
}

// Пункт меню с подменю «в какой граф». Строится на месте вызова, потому что список графов
// меняется, а меню в Electron собирается заново на каждый показ.
export function buildAddToGraphMenuItem(
  store: GraphStore,
  items: InboxItem[],
  stickerText: string | undefined,
  onAdded: (graphId: number) => void,
): MenuItemConstructorOptions | null {
  if (items.filter((i) => /^https?:\/\//i.test(i.url)).length === 0) return null;

  const graphs = store.list().slice(0, 8);
  const submenu: MenuItemConstructorOptions[] = graphs.map((g) => ({
    label: g.title || 'Без названия',
    click: () => {
      const id = addItemsToGraph(store, g.id, items, stickerText);
      if (id !== null) onAdded(id);
    },
  }));
  if (submenu.length > 0) submenu.push({ type: 'separator' });
  submenu.push({
    label: 'В новый граф…',
    click: () => {
      const id = addItemsToGraph(store, null, items, stickerText);
      if (id !== null) onAdded(id);
    },
  });

  return { label: 'Добавить в граф', submenu };
}
