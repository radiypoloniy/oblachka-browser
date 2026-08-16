// Форма сохранённой сессии (session.json, сейчас версия 5).
//
// ⚠️ Типы живут в shared/, а не рядом с electron/SessionManager.ts, по одной причине: тот тянет
// `electron`, а значит непригоден для проверок, которые гоняются голым node. Формат сессии — это
// открытые вкладки человека; его поломка стоит пользователю потерянной работы, и покрыть его
// тестом важнее, чем держать типы поближе к читателю файла. SessionManager их реэкспортирует,
// поэтому существующие импорты не изменились.
//
// История версий (миграции — в SessionManager.ts):
//   5: + title?/faviconData? в SavedTab/SavedSingleNode/SavedSplitPairNode — кэш для мгновенного
//      показа названия и иконки спящей вкладки без пробуждения.
//   4: nodes[] рекурсивно поддерживает group; activeRef использует type:'url'.
//   3: nodes[] с split-pair; activeRef type:'normal'|'split'.
//   2: nodes[] только single; activeTabType+activeTabIndex.
//   1: tabs[] (плоский список).

export interface SavedTab {
  url: string;
  // Кэш названия/иконки (base64 data:) — опционально, для мгновенной отрисовки без пробуждения/
  // загрузки. Отсутствуют в файлах v4 и старше — читающий код обязан фоллбэчить сам.
  title?: string;
  faviconData?: string;
}

export interface SavedSingleNode {
  type: 'single';
  url: string;
  title?: string;
  faviconData?: string;
}

export interface SavedSplitPairNode {
  type: 'split-pair';
  leftUrl: string;
  rightUrl: string;
  ratio: number;
  leftTitle?: string;
  rightTitle?: string;
  leftFaviconData?: string;
  rightFaviconData?: string;
}

export interface SavedGroupNode {
  type: 'group';
  id: string;
  label: string;
  color: string | null;
  collapsed: boolean;
  children: SavedNode[];
}

export type SavedNode = SavedSingleNode | SavedSplitPairNode | SavedGroupNode;

// activeRef v4: 'url' вместо 'normal'/'split' (проще с вложенными группами).
// 'normal'/'split' оставлены в типе для чтения старых v3-сессий в main.ts.
export type SavedActiveRef =
  | { type: 'hub' }
  | { type: 'pinned'; index: number }
  | { type: 'url'; url: string }
  // v3-формат — только для чтения при миграции, TabManager больше не пишет их:
  | { type: 'normal'; nodeIndex: number }
  | { type: 'split';  nodeIndex: number; side: 'left' | 'right' };

export interface SessionSnapshot {
  pinnedTabs: SavedTab[];
  nodes: SavedNode[];
  activeRef: SavedActiveRef;
}
