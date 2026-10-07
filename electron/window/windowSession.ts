import { screen } from 'electron';
import type { BrowserWindow } from 'electron';
import type { TabManager } from '../TabManager';
import type { AppSessionCoordinator } from '../AppSessionCoordinator';
import type { SavedWindow } from '../../shared/session';
import { allContexts } from '../WindowRegistry';

const technicalClosures = new WeakSet<BrowserWindow>();

// Уборка пустого окна после переноса не является действием «закрыть мои вкладки».
export function closeWindowWithoutHistory(win: BrowserWindow): void {
  technicalClosures.add(win);
  try { win.close(); }
  catch (error) { technicalClosures.delete(win); throw error; }
}

export function focusRestoredWindow(id: string | undefined): void {
  const contexts = allContexts();
  const target = contexts.find(c => c.sessionId === id);
  if (!target) return;
  // Окна показываются после готовности разных renderer: последний show не должен
  // случайно заменить фокус окна, с которым человек закончил предыдущую сессию.
  for (const context of contexts) context.win.once('show', () => {
    // show() и focusActiveView() завершают свою активацию после события show.
    // Возвращаем фокус после них, иначе поздно показанный пустой хаб забирает его.
    setImmediate(() => {
      if (!target.win.isDestroyed() && target.win.isVisible()) target.win.focus();
    });
  });
}

export function restoredWindowBounds(saved: SavedWindow | undefined) {
  if (!saved?.bounds) return { width: 1280, height: 800 };
  const work = screen.getDisplayMatching(saved.bounds).workArea;
  const width = Math.min(work.width, Math.max(900, Math.round(saved.bounds.width)));
  const height = Math.min(work.height, Math.max(600, Math.round(saved.bounds.height)));
  return {
    width, height,
    x: Math.max(work.x, Math.min(Math.round(saved.bounds.x), work.x + work.width - width)),
    y: Math.max(work.y, Math.min(Math.round(saved.bounds.y), work.y + work.height - height)),
  };
}

export function registerWindowSession(coordinator: AppSessionCoordinator, id: string, win: BrowserWindow, tabs: TabManager): void {
  coordinator.register(id, () => {
    const snapshot = tabs.getSessionSnapshot();
    if (!snapshot) return null;
    // Хаб пустого обычного окна можно вернуть, окно только с приватными/OAuth — нельзя.
    if (!snapshot.pinnedTabs.length && !snapshot.nodes.length && tabs.snapshot().some(t => !t.isHub)) return false;
    return { id, snapshot, bounds: win.getNormalBounds(), maximized: win.isMaximized() };
  });
  let captured: SavedWindow | false | null = null;
  win.on('close', event => {
    captured = coordinator.capture(id);
    // Другие обработчики могут отменить close после нашего. Проверяем итог события,
    // чтобы отменённый выход не заморозил автосейв оставшихся окон.
    queueMicrotask(() => {
      if (event.defaultPrevented) {
        technicalClosures.delete(win);
        coordinator.cancelQuit();
      }
    });
  });
  win.on('closed', () => coordinator.close(id, captured, !technicalClosures.has(win)));
  win.on('focus', () => coordinator.focus(id));
  win.on('move', () => coordinator.scheduleSave());
  win.on('resize', () => coordinator.scheduleSave());
}
