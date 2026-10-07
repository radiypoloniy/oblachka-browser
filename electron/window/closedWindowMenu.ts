import { BrowserWindow, dialog } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import type { AppSessionCoordinator } from '../AppSessionCoordinator';
import type { SavedNode, SavedWindow, SessionSnapshot } from '../../shared/session';
import { countSavedTabs } from '../../shared/sessionTree';
import { t, tf } from '../uiText';

// Подпись окна — его первая сохранённая страница. Раньше бралось только первое закрепление,
// и все окна без закреплений выглядели одинаково: «Закрытое окно (N)».
function firstPage(nodes: SavedNode[]): string | undefined {
  for (const node of nodes) {
    if (node.type === 'single') return node.title || node.url;
    if (node.type === 'split-pair') return node.leftTitle || node.leftUrl;
    const inGroup = firstPage(node.children);
    if (inGroup) return inGroup;
  }
  return undefined;
}

function windowLabel(snapshot: SessionSnapshot): string {
  const pin = snapshot.pinnedTabs[0];
  const name = pin?.title || pin?.url || firstPage(snapshot.nodes) || t('Закрытое окно');
  const count = snapshot.pinnedTabs.length + countSavedTabs(snapshot.nodes);
  return `${name.length > 60 ? `${name.slice(0, 59)}…` : name} (${count})`;
}

// Восстанавливаем целое дерево с прежним windowId: register удаляет его из истории,
// поэтому закрытое окно не появится ещё раз при следующем запуске.
export function closedWindowMenu(coordinator: AppSessionCoordinator | null, restore: (saved: SavedWindow) => void): MenuItemConstructorOptions[] {
  const closed = coordinator?.closedWindows() ?? [];
  const items: MenuItemConstructorOptions[] = closed.map(saved => ({
    label: windowLabel(saved.snapshot),
    click: () => {
      // Второй открытый экземпляр меню может содержать уже восстановленную запись.
      if (!coordinator?.closedWindows().some(w => w.id === saved.id)) return;
      restore(saved);
      coordinator.saveNow();
    },
  }));
  if (!coordinator || closed.length === 0) return items;
  items.push({ type: 'separator' }, {
    label: t('Убрать из списка'),
    submenu: closed.map(saved => ({
      label: windowLabel(saved.snapshot),
      click: () => { void forgetClosedWindow(coordinator, saved); },
    })),
  });
  return items;
}

// Окно с закреплениями возвращается при каждом запуске, поэтому его удаление — потеря набора,
// и о ней спрашиваем явно. Обычное закрытое окно просто уходит из истории.
async function forgetClosedWindow(coordinator: AppSessionCoordinator, saved: SavedWindow): Promise<void> {
  if (saved.snapshot.pinnedTabs.length > 0) {
    const parent = BrowserWindow.getFocusedWindow();
    const options = {
      type: 'warning' as const,
      message: t('Убрать окно с закреплёнными вкладками?'),
      detail: tf('Окно больше не вернётся при запуске, его вкладки ({n}) будут забыты.', { n: saved.snapshot.pinnedTabs.length + countSavedTabs(saved.snapshot.nodes) }),
      buttons: [t('Убрать'), t('Отмена')], defaultId: 1, cancelId: 1,
    };
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    if (response !== 0) return;
  }
  coordinator.forget(saved.id);
}
