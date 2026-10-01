import { Menu } from 'electron';
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron';
import type { AiAction } from '../shared/ipc';
import { getSearchEngine } from '../shared/searchEngines';
import type { TabManager } from './TabManager';
import type { SettingsManager } from './SettingsManager';
import { menuIcon } from './MenuIcons';
import { showTranslatePopover } from './TranslatePopoverManager';
import { t as tr, tf } from './uiText';

const SUMMARIZE_MIN_CHARS = 250; // тот же порог, что у выделения на странице

function truncate(text: string, max = 40): string {
  const value = text.trim().replace(/\s+/g, ' ');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Редактируемые поля хрома и выделение в них получают русские команды и те же группы действий. */
export function wireChromeContextMenu(
  win: BrowserWindow, wc: WebContents, settings: SettingsManager, tabs: () => TabManager | null,
): void {
  wc.on('context-menu', (_event, p: ContextMenuParams) => {
    if (!p.isEditable && !p.selectionText.trim()) return;
    const items: MenuItemConstructorOptions[] = [];
    const selection = p.formControlType === 'input-password' ? '' : p.selectionText.trim();

    if (p.isEditable) {
      items.push(
        { role: 'cut', label: tr('Вырезать'), icon: menuIcon('Scissors') },
        { role: 'copy', label: tr('Копировать'), icon: menuIcon('Copy') },
        { role: 'paste', label: tr('Вставить'), icon: menuIcon('ClipboardPaste') },
      );
    } else {
      items.push({ role: 'copy', label: tr('Копировать'), icon: menuIcon('Copy') });
    }

    if (selection) {
      const engine = getSearchEngine(settings.getSearchEngine());
      items.push({ type: 'separator' }, {
        label: tf('Поиск «{q}» в {engine}', { q: truncate(selection), engine: engine.name }),
        icon: menuIcon('Search'),
        click: () => {
          const t = tabs();
          if (!t) return;
          const incognito = t.snapshot().some((tab) => tab.isActive && tab.incognito);
          t.createTab(engine.buildUrl(selection), false, false, incognito);
        },
      });

      const rect = p.selectionRect.width > 0 && p.selectionRect.height > 0
        ? p.selectionRect : { x: p.x, y: p.y, width: 0, height: 0 };
      const ai = (label: string, icon: string, action: AiAction): MenuItemConstructorOptions => ({
        label: tr(label), icon: menuIcon(icon),
        click: () => showTranslatePopover(win, action, selection, rect, wc),
      });
      items.push(
        { type: 'separator' },
        ai('Перевести', 'Languages', 'translate'),
        ai('Пересказать проще', 'ListFilter', 'simplify'),
        ai('Объяснить', 'CircleHelp', 'explain'),
      );
      if (selection.length >= SUMMARIZE_MIN_CHARS) {
        items.push(ai('Краткая выжимка', 'FileText', 'summarize'));
      }
    }

    if (p.isEditable) {
      items.push({ type: 'separator' }, {
        role: 'selectAll', label: tr('Выделить всё'), icon: menuIcon('TextSelect'),
      });
    }
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}
