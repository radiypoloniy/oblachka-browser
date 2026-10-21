import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import { firstUrlFromArgv } from './startUrlArgv';
import { secondInstanceAction } from '../shared/secondInstance';

// ── Повторный запуск при уже запущенном браузере ─────────────────────────────
//
// Решение — в shared/secondInstance.ts (там же разбор, почему «окон нет» раньше давало пустое
// окно). Здесь только исполнение.
// ⚠️ Отдельным файлом от main.ts: тот за порогом храповика структуры, место под новую работу в нём
// освобождается выносом.

interface InstanceContext {
  win: BrowserWindow;
  tabs: { createTab(url: string): unknown };
}

export function registerSecondInstance(deps: {
  preferredContext: () => InstanceContext | null | undefined;
  createWindow: () => InstanceContext;
  bringToFront: (win: BrowserWindow) => void;
  /** Сессия восстановлена и стартовый адрес уже разобран. */
  isRestored: () => boolean;
  /** Отложить адрес до восстановленных окон (тот же путь, что у open-url на macOS). */
  deferUrl: (url: string) => void;
}): void {
  // ⚠️ Перезапуск заказывается ОДИН раз: человек, которому «ничего не открылось», кликает по
  // ярлыку несколько раз подряд, и каждый клик не должен плодить по процессу.
  let relaunchScheduled = false;

  app.on('second-instance', (_e, argv) => {
    const url = firstUrlFromArgv(argv);
    const ctx = deps.preferredContext();
    const action = secondInstanceAction({ hasWindow: !!ctx, restored: deps.isRestored(), platform: process.platform });

    if (action === 'focus' && ctx) {
      deps.bringToFront(ctx.win);
      if (url) ctx.tabs.createTab(url);
      return;
    }
    if (action === 'defer') {
      if (url) deps.deferUrl(url);
      return;
    }
    if (action === 'relaunch') {
      if (relaunchScheduled) return;
      relaunchScheduled = true;
      // ⚠️ Новый процесс стартует ПОСЛЕ выхода этого: к тому времени сессия записана
      // (beginQuit), VPN остановлен и замок одного экземпляра свободен — запуск идёт обычным
      // путём, с восстановлением окон. Аргументы — того клика, который пришёл сейчас, вместе с
      // адресом, если он был.
      console.log('[startup] запуск во время выхода — перезапустимся после него');
      app.relaunch({ args: argv.slice(1) });
      // Выход уже идёт; повторный quit ничего не дублирует (см. AppShutdown.ts) и страхует случай,
      // если он ещё не начался.
      app.quit();
      return;
    }
    // revive: процесс без окон — штатное состояние (macOS). Молча терять ссылку нельзя.
    const revived = deps.createWindow();
    if (url) revived.tabs.createTab(url);
    deps.bringToFront(revived.win);
  });
}
