import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { TabState } from '../shared/ipc';

const SESSION_VERSION = 1;
const DEBOUNCE_MS = 1500;

interface SavedTab {
  url: string;
}

interface SessionData {
  version: 1;
  savedAt: string;
  activeTabIndex: number; // -1 = активен хаб
  tabs: SavedTab[];
}

export interface RestoredSession {
  tabs: SavedTab[];
  activeTabIndex: number;
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
      return { tabs: data.tabs, activeTabIndex: data.activeTabIndex };
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
    // about:blank, загружающиеся и упавшие вкладки не пишем.
    const realTabs = snapshot.filter(
      (t) => !t.isHub && /^https?:\/\//i.test(t.url),
    );
    const tabs: SavedTab[] = realTabs.map((t) => ({ url: t.url }));

    let activeTabIndex = -1; // -1 = хаб
    const activeTab = snapshot.find((t) => t.id === activeId);
    if (activeTab && !activeTab.isHub) {
      activeTabIndex = realTabs.findIndex((t) => t.id === activeId);
      // если активная вкладка не прошла фильтр (about:blank) — активируем хаб
    }

    const data: SessionData = {
      version: SESSION_VERSION,
      savedAt: new Date().toISOString(),
      activeTabIndex,
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

function isValidSession(v: unknown): v is SessionData {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d['version'] === 'number' &&
    typeof d['savedAt'] === 'string' &&
    typeof d['activeTabIndex'] === 'number' &&
    Array.isArray(d['tabs']) &&
    (d['tabs'] as unknown[]).every(
      (t) =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as Record<string, unknown>)['url'] === 'string',
    )
  );
}
