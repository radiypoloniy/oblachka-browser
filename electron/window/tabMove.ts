import type { TabManager } from '../TabManager';
import type { DetachedTab } from '../tabTransfer';
import type { WindowContext } from '../WindowRegistry';
import { closeWindowWithoutHistory } from './windowSession';

// Перенос целиком синхронен: между снятием и принятием не может сработать debounce
// сохранения. Любой отказ приёмника возвращает исходное дерево до следующего тика.
export function moveTab(
  from: TabManager, id: string, targetOf: () => WindowContext,
  closeEmptySource: (from: TabManager) => void, newWindow = false,
): boolean {
  let ticket: DetachedTab | null = null;
  let target: WindowContext | null = null;
  try {
    ticket = from.detachTabForMove(id);
    if (!ticket) return false;
    target = targetOf();
    if (newWindow) {
      const seed = from.contentBounds;
      if (seed.width > 0 && seed.height > 0) target.tabs.setContentBounds(seed);
    }
    if (!target.tabs.adoptTab(ticket)) return false;
  } catch (e) {
    console.error('[TabTransfer] перенос отменён:', e);
    return false;
  } finally {
    if (ticket?.pending) {
      ticket.restore();
      // Только новое окно, созданное для неудавшегося переноса, можно убрать.
      if (newWindow && target && !target.win.isDestroyed() && !target.tabs.hasTabs()) {
        closeWindowWithoutHistory(target.win);
      }
    }
  }
  // Фокус и уборка источника выполняются уже после завершения транзакции.
  if (!target.win.isDestroyed()) {
    if (target.win.isMinimized()) target.win.restore();
    target.win.focus();
  }
  closeEmptySource(from);
  return true;
}
