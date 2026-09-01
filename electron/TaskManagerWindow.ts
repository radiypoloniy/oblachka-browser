import { BrowserWindow } from 'electron';
import path from 'node:path';

// Окно диспетчера задач (Shift+Esc).
//
// ⚠️ ОТДЕЛЬНОЕ ОКНО, а не раздел настроек и не вкладка — и это не вкус, а требование задачи.
// Диспетчер нужен, чтобы смотреть на память, ПОКА пользуешься браузером: вкладка настроек для
// этого не годится вовсе (её надо держать активной, и она сама влияет на замер). Chrome по той же
// причине держит свой диспетчер отдельным окном на той же клавише.
//
// ⚠️ Окно ОДНО на приложение, а не на окно браузера: диспетчер показывает процессы всего
// приложения. Повторный Shift+Esc поднимает уже открытое, а не плодит копии.
//
// ⚠️ `skipTaskbar` НЕ ставим, в отличие от заставки: диспетчер живёт долго, и человек должен уметь
// вернуться к нему с панели задач, а не искать под окном браузера.

let win: BrowserWindow | null = null;

export function toggleTaskManager(): void {
  if (win && !win.isDestroyed()) {
    // Повторное нажатие закрывает — так же, как F12 закрывает DevTools. Иначе клавиша работает
    // «в одну сторону», и окно приходится ловить мышью.
    if (win.isFocused()) { win.close(); return; }
    win.show();
    win.focus();
    return;
  }

  win = new BrowserWindow({
    width: 960,
    height: 620,
    minWidth: 620,
    minHeight: 380,
    title: 'Диспетчер задач',
    // Ровно --app-bg светлой темы: иначе окно моргает белым до первого кадра React.
    backgroundColor: '#E9EAEF',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-taskmanager.js'),
      contextIsolation: true,
      sandbox: false, // preload ходит в ipcRenderer
    },
  });

  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });
  void win.loadURL('oblako-chrome://localhost/taskmanager.html');
}

/** Закрыть при выходе из приложения — иначе окно удержит процесс живым. */
export function closeTaskManager(): void {
  if (win && !win.isDestroyed()) win.close();
  win = null;
}
