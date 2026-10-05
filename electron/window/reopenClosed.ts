import type { TabManager } from '../TabManager';
import type { AppSessionCoordinator } from '../AppSessionCoordinator';
import type { SavedClosedWindow, SavedWindow } from '../../shared/session';
import { hasSavedTabs } from '../../shared/appSession';

type ClosedTabs = Pick<TabManager, 'closedSnapshot' | 'reopenLastClosedTab'>;
type ReopenTarget = { kind: 'window'; saved: SavedClosedWindow } | { kind: 'tab' };

export function reopenTarget(tabs: ClosedTabs, coordinator: AppSessionCoordinator | null): ReopenTarget | null {
  // Старые технические закрытия уже могли сохраниться: пустое дерево хоткей пропускает.
  const saved = coordinator?.closedWindows().find(w => hasSavedTabs(w.snapshot));
  const tab = tabs.closedSnapshot()[0];
  if (saved && (!tab || saved.closedAt >= tab.closedAt)) return { kind: 'window', saved };
  return tab ? { kind: 'tab' } : null;
}

export function reopenLastClosed(tabs: ClosedTabs, coordinator: AppSessionCoordinator | null, restore: (saved: SavedWindow) => void): void {
  const target = reopenTarget(tabs, coordinator);
  if (!target) return;
  if (target.kind === 'tab') tabs.reopenLastClosedTab();
  else {
    // createWindow регистрирует прежний id только после восстановления дерева.
    restore(target.saved);
    coordinator?.saveNow();
  }
}
