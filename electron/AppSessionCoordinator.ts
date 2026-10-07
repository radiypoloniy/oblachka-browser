import { trimClosedWindows } from '../shared/appSession';
import type { AppSessionSnapshot, SavedClosedWindow, SavedWindow } from '../shared/session';
import { closedAtNow } from './closedAt';

interface SessionStore { save(snapshot: AppSessionSnapshot): boolean }
type Reader = () => SavedWindow | false | null;

// null означает сломанный инвариант и запрещает запись всего снимка; false —
// заведомо приватное/временное окно, которое намеренно не включается в сессию.
export class AppSessionCoordinator {
  #readers = new Map<string, Reader>();
  #cached = new Map<string, SavedWindow>();
  #closed: SavedClosedWindow[] = [];
  #lastWindows: SavedWindow[] = [];
  #quitCapture: AppSessionSnapshot | null = null;
  #enabled = false;
  #unsafeClosed = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #focused: string | undefined;

  constructor(private readonly store: SessionStore, restored: AppSessionSnapshot | null) {
    this.#closed = restored?.closedWindows ?? [];
    this.#focused = restored?.focusedWindowId;
  }

  register(id: string, read: Reader): void {
    this.#readers.set(id, read);
    this.#closed = this.#closed.filter(w => w.id !== id);
    // Снова открытое окно читается живым: его старый снимок не должен вернуться вместо него.
    this.#lastWindows = this.#lastWindows.filter(w => w.id !== id);
  }

  enable(): void { this.#enabled = true; this.scheduleSave(); }
  focus(id: string): void { this.#focused = id; this.scheduleSave(); }

  scheduleSave(): void {
    if (!this.#enabled || this.#quitCapture) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { this.#timer = null; this.saveNow(); }, 1500);
  }

  #snapshot(): AppSessionSnapshot | null {
    const windows: SavedWindow[] = [];
    for (const [id, read] of this.#readers) {
      const w = read();
      if (w === null) return null;
      if (w !== false) { windows.push(w); this.#cached.set(id, w); }
    }
    // Приватные окна остаются в реестре, но не должны вытеснять последнее обычное.
    if (windows.length === 0) windows.push(...this.#lastWindows);
    return {
      windows, closedWindows: trimClosedWindows(this.#closed.filter(w => !windows.some(open => open.id === w.id))),
      ...(windows.some(w => w.id === this.#focused) ? { focusedWindowId: this.#focused } : {}),
    };
  }

  saveNow(): boolean {
    if (!this.#enabled || this.#unsafeClosed) return false;
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
    const snapshot = this.#quitCapture ?? this.#snapshot();
    return snapshot !== null && this.store.save(snapshot);
  }

  beginQuit(): void {
    // Последнее closed само вызывает app.quit: не заменяем захваченный набор пустым.
    if (this.#readers.size > 0) this.#quitCapture = this.#snapshot();
    this.saveNow();
  }

  cancelQuit(): void { this.#quitCapture = null; this.saveNow(); }

  capture(id: string): SavedWindow | false | null { return this.#readers.get(id)?.() ?? null; }

  close(id: string, captured: SavedWindow | false | null, remember = true): void {
    const w = captured === null ? this.#cached.get(id) ?? null : captured;
    if (w === null) {
      // Без корректного дерева закрывшегося окна новая запись могла бы потерять его вкладки.
      this.#unsafeClosed = true;
      console.warn('[session] дерево закрытого окна недоступно; исходная сессия защищена от перезаписи');
    }
    this.#readers.delete(id);
    this.#cached.delete(id);
    if (w && remember) {
      this.#closed = trimClosedWindows([{ ...w, closedAt: closedAtNow() }, ...this.#closed.filter(old => old.id !== id)]);
      this.#lastWindows = [w];
    }
    this.saveNow();
  }

  closedWindows(): SavedClosedWindow[] { return this.#closed.map(w => structuredClone(w)); }
}

export function windowsToRestore(session: AppSessionSnapshot | null): SavedWindow[] {
  if (!session) return [];
  return [...session.windows, ...session.closedWindows.filter(w => w.snapshot.pinnedTabs.length > 0)];
}

export function windowToFocusOnRestore(session: AppSessionSnapshot | null): string | undefined {
  const windows = windowsToRestore(session);
  const focused = windows.find(w => w.id === session?.focusedWindowId) ?? windows[0];
  // Пустое вспомогательное окно не должно скрывать рабочее с закреплениями,
  // даже если человек закрыл его последним и оно стало стартовым окном.
  if (focused && (focused.snapshot.pinnedTabs.length || focused.snapshot.nodes.length)) return focused.id;
  return windows.find(w => w.snapshot.pinnedTabs.length > 0)?.id ?? focused?.id;
}
