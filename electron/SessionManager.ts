import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Версия 5: + title?/faviconData? (опционально) в SavedTab/SavedSingleNode/SavedSplitPairNode —
//           кэш для мгновенного показа названия/иконки спящей вкладки без пробуждения (заход C).
// Версия 4: nodes[] рекурсивно поддерживает group; activeRef использует type:'url'.
// Версия 3: nodes[] с split-pair; activeRef type:'normal'|'split'.
// Версия 2: nodes[] только single; activeTabType+activeTabIndex.
// Версия 1: tabs[] (плоский список).
const SESSION_VERSION = 5;
const DEBOUNCE_MS = 1500;

interface SavedTab {
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

type UnknownNode = { type: string; [k: string]: unknown };

interface SessionDataV5 {
  version: 5;
  savedAt: string;
  activeRef: SavedActiveRef;
  pinnedTabs: SavedTab[];
  nodes: SavedNode[];
}

interface SessionDataV4 {
  version: 4;
  savedAt: string;
  activeRef: SavedActiveRef;
  pinnedTabs: SavedTab[];
  nodes: SavedNode[];
}

interface SessionDataV3 {
  version: 3;
  savedAt: string;
  activeRef: SavedActiveRef;
  pinnedTabs: SavedTab[];
  nodes: (SavedSingleNode | SavedSplitPairNode | UnknownNode)[];
}

interface SessionDataV2 {
  version: 2;
  savedAt: string;
  activeTabIndex: number;
  activeTabType?: string;
  pinnedTabs: SavedTab[];
  nodes: unknown[];
}

interface SessionDataV1 {
  version: 1;
  savedAt: string;
  activeTabIndex: number;
  activeTabType?: string;
  pinnedTabs?: SavedTab[];
  tabs: SavedTab[];
}

export class SessionManager {
  #enabled = false;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #filePath: string;
  readonly #tmpPath: string;

  constructor() {
    const dir = app.getPath('userData');
    this.#filePath = path.join(dir, 'session.json');
    this.#tmpPath  = path.join(dir, 'session.json.tmp');
  }

  load(): SessionSnapshot | null {
    try {
      const raw = fs.readFileSync(this.#filePath, 'utf8');
      const data = JSON.parse(raw) as unknown;
      if (typeof data !== 'object' || data === null) return null;
      const d = data as Record<string, unknown>;

      if (d['version'] === 5) return this.#loadV5(d);
      if (d['version'] === 4) return this.#loadV4(d);
      if (d['version'] === 3) return this.#loadV3(d);
      if (d['version'] === 2) return this.#migrateV2(d as unknown as SessionDataV2);
      if (d['version'] === 1) return this.#migrateV1(d as unknown as SessionDataV1);
      return null;
    } catch {
      return null;
    }
  }

  // v5 структурно = v4 + опциональные title/faviconData на узлах/пинах (см. SavedTab/SavedSingleNode/
  // SavedSplitPairNode выше) — отдельный загрузчик только чтобы не трогать #loadV4 (читает старые
  // v4-файлы как есть, без единой правки, см. заход C).
  #loadV5(d: Record<string, unknown>): SessionSnapshot | null {
    if (
      typeof d['savedAt'] !== 'string' ||
      !isSavedTabArray(d['pinnedTabs']) ||
      !Array.isArray(d['nodes']) ||
      !isActiveRef(d['activeRef'])
    ) return null;

    return {
      pinnedTabs: d['pinnedTabs'] as SavedTab[],
      nodes: filterKnownNodes(d['nodes'] as unknown[]),
      activeRef: d['activeRef'] as SavedActiveRef,
    };
  }

  #loadV4(d: Record<string, unknown>): SessionSnapshot | null {
    if (
      typeof d['savedAt'] !== 'string' ||
      !isSavedTabArray(d['pinnedTabs']) ||
      !Array.isArray(d['nodes']) ||
      !isActiveRef(d['activeRef'])
    ) return null;

    return {
      pinnedTabs: d['pinnedTabs'] as SavedTab[],
      nodes: filterKnownNodes(d['nodes'] as unknown[]),
      activeRef: d['activeRef'] as SavedActiveRef,
    };
  }

  #loadV3(d: Record<string, unknown>): SessionSnapshot | null {
    if (
      typeof d['savedAt'] !== 'string' ||
      !isSavedTabArray(d['pinnedTabs']) ||
      !Array.isArray(d['nodes']) ||
      !isActiveRef(d['activeRef'])
    ) return null;

    // v3 узлы не содержат групп — filterKnownNodes корректно их пропустит.
    return {
      pinnedTabs: d['pinnedTabs'] as SavedTab[],
      nodes: filterKnownNodes(d['nodes'] as unknown[]),
      activeRef: d['activeRef'] as SavedActiveRef,
      // v3-формат activeRef ('normal'/'split') передаётся как есть в main.ts,
      // который умеет оба формата при restore.
    };
  }

  #migrateV2(d: SessionDataV2): SessionSnapshot | null {
    if (
      typeof d.savedAt !== 'string' ||
      typeof d.activeTabIndex !== 'number' ||
      !isSavedTabArray(d.pinnedTabs) ||
      !Array.isArray(d.nodes)
    ) return null;

    const rawType = d.activeTabType;
    const tabType: 'hub' | 'pinned' | 'normal' =
      rawType === 'hub' || rawType === 'pinned' || rawType === 'normal' ? rawType : 'hub';

    let activeRef: SavedActiveRef;
    if (tabType === 'hub') {
      activeRef = { type: 'hub' };
    } else if (tabType === 'pinned') {
      activeRef = { type: 'pinned', index: d.activeTabIndex };
    } else {
      activeRef = { type: 'normal', nodeIndex: d.activeTabIndex };
    }

    return {
      pinnedTabs: d.pinnedTabs,
      nodes: filterKnownNodes(d.nodes),
      activeRef,
    };
  }

  #migrateV1(d: SessionDataV1): SessionSnapshot | null {
    if (
      typeof d.savedAt !== 'string' ||
      typeof d.activeTabIndex !== 'number' ||
      !isSavedTabArray(d.tabs)
    ) return null;

    const rawType = d.activeTabType;
    let tabType: 'hub' | 'pinned' | 'normal';
    if (rawType === 'hub' || rawType === 'pinned' || rawType === 'normal') {
      tabType = rawType;
    } else {
      tabType = d.activeTabIndex === -1 ? 'hub' : 'normal';
    }

    let activeRef: SavedActiveRef;
    if (tabType === 'hub') {
      activeRef = { type: 'hub' };
    } else if (tabType === 'pinned') {
      activeRef = { type: 'pinned', index: d.activeTabIndex };
    } else {
      activeRef = { type: 'normal', nodeIndex: d.activeTabIndex };
    }

    const pinnedTabs: SavedTab[] = isSavedTabArray(d.pinnedTabs) ? d.pinnedTabs : [];
    const nodes: SavedSingleNode[] = d.tabs.map((t) => ({ type: 'single', url: t.url }));

    return { pinnedTabs, nodes, activeRef };
  }

  enable(): void {
    this.#enabled = true;
  }

  scheduleSave(getSnapshot: () => SessionSnapshot | null): void {
    if (!this.#enabled) return;
    if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      const snap = getSnapshot();
      if (snap) this.#write(snap);
    }, DEBOUNCE_MS);
  }

  saveNow(snapshot: SessionSnapshot | null): void {
    if (!this.#enabled || !snapshot) return;
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    this.#write(snapshot);
  }

  #write(snapshot: SessionSnapshot): void {
    const data: SessionDataV5 = {
      version: SESSION_VERSION as 5,
      savedAt: new Date().toISOString(),
      activeRef: snapshot.activeRef,
      pinnedTabs: snapshot.pinnedTabs,
      nodes: snapshot.nodes,
    };

    try {
      fs.writeFileSync(this.#tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(this.#tmpPath, this.#filePath);
    } catch {
      // Ошибка диска — следующий дебаунс повторит попытку.
    }
  }
}

function isSavedTabArray(v: unknown): v is SavedTab[] {
  return Array.isArray(v) && (v as unknown[]).every((t) => {
    if (typeof t !== 'object' || t === null) return false;
    const r = t as Record<string, unknown>;
    if (typeof r['url'] !== 'string') return false;
    // title/faviconData — опциональны (отсутствуют в v4 и старше): отсутствие ПОЛЯ допустимо,
    // но если поле есть — оно должно быть строкой (битый тип не должен молча пролезть).
    if (r['title'] !== undefined && typeof r['title'] !== 'string') return false;
    if (r['faviconData'] !== undefined && typeof r['faviconData'] !== 'string') return false;
    return true;
  });
}

function isActiveRef(v: unknown): v is SavedActiveRef {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r['type'] === 'hub') return true;
  if (r['type'] === 'pinned') return typeof r['index'] === 'number';
  if (r['type'] === 'url')    return typeof r['url'] === 'string';
  // v3-форматы: принимаем при чтении старых сессий
  if (r['type'] === 'normal') return typeof r['nodeIndex'] === 'number';
  if (r['type'] === 'split')  return typeof r['nodeIndex'] === 'number'
    && (r['side'] === 'left' || r['side'] === 'right');
  return false;
}

// Рекурсивно фильтрует узлы, пропуская неизвестные/битые типы.
// Поддерживает single, split-pair и group (с вложенными children).
function filterKnownNodes(arr: unknown[]): SavedNode[] {
  const result: SavedNode[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const n = item as Record<string, unknown>;

    if (n['type'] === 'single' && typeof n['url'] === 'string') {
      const node: SavedSingleNode = { type: 'single', url: n['url'] as string };
      if (typeof n['title'] === 'string') node.title = n['title'];
      if (typeof n['faviconData'] === 'string') node.faviconData = n['faviconData'];
      result.push(node);

    } else if (
      n['type'] === 'split-pair' &&
      typeof n['leftUrl'] === 'string' &&
      typeof n['rightUrl'] === 'string' &&
      typeof n['ratio'] === 'number'
    ) {
      const node: SavedSplitPairNode = {
        type: 'split-pair',
        leftUrl:  n['leftUrl']  as string,
        rightUrl: n['rightUrl'] as string,
        ratio:    n['ratio']    as number,
      };
      if (typeof n['leftTitle'] === 'string') node.leftTitle = n['leftTitle'];
      if (typeof n['rightTitle'] === 'string') node.rightTitle = n['rightTitle'];
      if (typeof n['leftFaviconData'] === 'string') node.leftFaviconData = n['leftFaviconData'];
      if (typeof n['rightFaviconData'] === 'string') node.rightFaviconData = n['rightFaviconData'];
      result.push(node);

    } else if (
      n['type'] === 'group' &&
      typeof n['id'] === 'string' &&
      typeof n['label'] === 'string' &&
      typeof n['collapsed'] === 'boolean' &&
      Array.isArray(n['children'])
    ) {
      const color = typeof n['color'] === 'string' ? n['color'] : null;
      result.push({
        type: 'group',
        id:        n['id']        as string,
        label:     n['label']     as string,
        color,
        collapsed: n['collapsed'] as boolean,
        children:  filterKnownNodes(n['children'] as unknown[]),
      });
    }
    // Неизвестные типы пропускаем молча.
  }
  return result;
}
