import { app, dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import { preferredContext } from '../WindowRegistry';

// Ошибки диска нельзя прятать в консоли. Одно сообщение за запуск без повторов
// при каждом дебаунсе; при старте ждём интерфейс, чтобы не показывать бесхозный диалог.
export function sessionWarningReporter(): (detail: string) => void {
  let reported = false;
  return detail => {
    if (reported) return;
    reported = true;
    const show = (win: BrowserWindow) => {
      if (win.isDestroyed()) return;
      void dialog.showMessageBox(win, {
        type: 'warning', title: 'Сессия Oblako',
        message: 'Сохранение или восстановление вкладок требует внимания.',
        detail, buttons: ['Понятно'],
      });
    };
    const current = preferredContext()?.win;
    if (current?.isVisible()) show(current);
    else if (current) current.once('show', () => show(current));
    else app.once('browser-window-created', (_event, win) => win.once('show', () => show(win)));
  };
}
