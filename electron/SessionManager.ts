import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { TabState } from '../shared/ipc';

const SESSION_VERSION = 1;
const DEBOUNCE_MS = 1500;

interface SavedTab {
  url: string;
}

// Тип активной вкладки — из какого списка.
// Старые файлы без этого поля: activeTabIndex===-1 → hub, иначе → normal.
type ActiveTabType = 'hub' | 'pinned' | 'normal';

interface SessionData {
  version: 1;
  savedAt: string;
  activeTabIndex: number;        // индекс внутри списка, указанного activeTabType
  activeTabType?: ActiveTabType; // опционально — для обратной совместимости
  pinnedTabs?: SavedTab[];       // опционально — для обратной совместимости
  tabs: SavedTab[];
}

export interface RestoredSession {
  pinnedTabs: SavedTab[];
  tabs: SavedTab[];
  activeTabType: ActiveTabType;
  activeTabIndex: number; // индекс в соответствующем списке; -1 при hub
}

export class SessionManager {
  // Флаг: сохранение запрещено до завершения восстановления.
  // Без этого автосейв на старте затирает сессию пустым состоянием.
  #enabled = false;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #filePath: string;
  readonly #tmpPath: string;

  constructor() {
    const dir = app.getPath('userData');
    this.#filePath = path.join(dir, 'session.json');
    this.#tmpPath = path.join(dir, 'session.json.tmp');
  }

  load(): RestoredSession | null {
    try {
      const raw = fs.readFileSync(this.#filePath, 'utf8');
      const data = JSON.parse(raw) as unknown;
      if (!isValidSession(data)) return null;
      // Несовпадение версии — стартуем чисто, не рискуем неправильной миграцией.
      if (data.version !== SESSION_VERSION) return null;

      // Обратная совместимость: старые файлы без activeTabType.
      // activeTabIndex === -1 означало «активен хаб».
      let activeTabType: ActiveTabType;
      if (data.activeTabType === 'hub' || data.activeTabType === 'pinned' || data.activeTabType === 'normal') {
        activeTabType = data.activeTabType;
      } else {
        activeTabType = data.activeTabIndex === -1 ? 'hub' : 'normal';
      }

      return {
        pinnedTabs: data.pinnedTabs ?? [],
        tabs: data.tabs,
        activeTabType,
        activeTabIndex: data.activeTabIndex,
      };
    } catch {
      return null; // файл отсутствует, битый JSON или ошибка чтения — ok
    }
  }

  enable(): void {
    this.#enabled = true;
  }

  scheduleSave(getSnapshot: () => TabState[], getActiveId: () => string): void {
    if (!this.#enabled) return;
    if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      this.#write(getSnapshot(), getActiveId());
    }, DEBOUNCE_MS);
  }

  // Синхронный путь для before-quit: процесс завершается сразу после.
  // Никаких await — иначе Node не дождётся записи до выхода.
  saveNow(snapshot: TabState[], activeId: string): void {
    if (!this.#enabled) return;
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    this.#write(snapshot, activeId);
  }

  #write(snapshot: TabState[], activeId: string): void {
    // Сохраняем только вкладки с валидным http/https URL.
    const isReal = (t: TabState) => !t.isHub && /^https?:\/\//i.test(t.url);
    const pinnedSnap = snapshot.filter((t) => t.isPinned && isReal(t));
    const normalSnap = snapshot.filter((t) => !t.isPinned && isReal(t));

    const pinnedTabs: SavedTab[] = pinnedSnap.map((t) => ({ url: t.url }));
    const tabs: SavedTab[]       = normalSnap.map((t) => ({ url: t.url }));

    const activeTab = snapshot.find((t) => t.id === activeId);
    let activeTabType: ActiveTabType = 'hub';
    let activeTabIndex = -1;
    if (activeTab && !activeTab.isHub) {
      if (activeTab.isPinned) {
        activeTabType  = 'pinned';
        activeTabIndex = pinnedSnap.findIndex((t) => t.id === activeId);
      } else {
        activeTabType  = 'normal';
        activeTabIndex = normalSnap.findIndex((t) => t.id === activeId);
        // если активная не прошла фильтр (about:blank) — activeTabIndex=-1 → хаб при restore
      }
    }

    const data: SessionData = {
      version: SESSION_VERSION,
      savedAt: new Date().toISOString(),
      activeTabType,
      activeTabIndex,
      pinnedTabs,
      tabs,
    };

    try {
      fs.writeFileSync(this.#tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(this.#tmpPath, this.#filePath);
    } catch {
      // Ошибка диска не критична — следующий дебаунс попробует снова.
    }
  }
}

function isSavedTabArray(v: unknown): v is SavedTab[] {
  return Array.isArray(v) && (v as unknown[]).every(
    (t) => typeof t === 'object' && t !== null &&
      typeof (t as Record<string, unknown>)['url'] === 'string',
  );
}

function isValidSession(v: unknown): v is SessionData {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  if (
    typeof d['version'] !== 'number' ||
    typeof d['savedAt'] !== 'string' ||
    typeof d['activeTabIndex'] !== 'number' ||
    !isSavedTabArray(d['tabs'])
  ) return false;
  // pinnedTabs и activeTabType — опциональные поля (обратная совместимость).
  if (d['pinnedTabs'] !== undefined && !isSavedTabArray(d['pinnedTabs'])) return false;
  return true;
}
