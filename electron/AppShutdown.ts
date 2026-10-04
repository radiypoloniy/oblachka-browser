import type { App } from 'electron';

interface ShutdownTasks {
  saveSession: () => void;
  stopServices: () => Promise<void>;
  clearExitData: () => Promise<void>;
}

// before-quit ещё можно отменить закрытием окна. Не останавливаем общие сервисы и
// не стираем данные до will-quit: к этому моменту окна уже согласились закрыться.
export function registerAppShutdown(app: Pick<App, 'on' | 'quit'>, tasks: ShutdownTasks) {
  let started = false;
  let finished = false;
  app.on('before-quit', () => tasks.saveSession());
  app.on('will-quit', (event) => {
    if (finished) return;
    event.preventDefault();
    if (started) return;
    started = true;
    void (async () => {
      try {
        await tasks.stopServices();
      } catch (error) {
        console.warn('[shutdown] остановка сервисов не завершилась:', error);
      }
      try {
        await tasks.clearExitData();
      } catch (error) {
        console.warn('[shutdown] очистка данных при выходе не завершилась:', error);
      }
      // Повторный app.quit пропускает эту же обработку; асинхронные задачи выполняются один раз.
      finished = true;
      app.quit();
    })();
  });
  return { isShuttingDown: () => started };
}
