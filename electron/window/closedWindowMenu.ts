import type { MenuItemConstructorOptions } from 'electron';
import type { AppSessionCoordinator } from '../AppSessionCoordinator';
import type { SavedWindow } from '../../shared/session';
import { countSavedTabs } from '../../shared/sessionTree';
import { t } from '../uiText';

// Восстанавливаем целое дерево с прежним windowId: register удаляет его из истории,
// поэтому закрытое окно не появится ещё раз при следующем запуске.
export function closedWindowMenu(coordinator: AppSessionCoordinator | null, restore: (saved: SavedWindow) => void): MenuItemConstructorOptions[] {
  return (coordinator?.closedWindows() ?? []).map(saved => {
    const first = saved.snapshot.pinnedTabs[0];
    const count = saved.snapshot.pinnedTabs.length + countSavedTabs(saved.snapshot.nodes);
    return {
      label: `${first?.title || first?.url || t('Закрытое окно')} (${count})`,
      click: () => {
        // Второй открытый экземпляр меню может содержать уже восстановленную запись.
        if (!coordinator?.closedWindows().some(w => w.id === saved.id)) return;
        restore(saved);
        coordinator.saveNow();
      },
    };
  });
}
