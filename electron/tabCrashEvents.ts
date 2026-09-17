import type { WebContents } from 'electron';
import type { TabErrorState } from '../shared/ipc';

export interface TabCrashHost {
  mine(): boolean;
  notify(): void;
  onZoom(direction: 'in' | 'out'): void;
  isOnline(): boolean;
  isRussianCaCandidate(hostname: string): boolean;
  reportError(error: TabErrorState): void;
  windowDestroyed(): boolean;
  viewStillCurrent(): boolean;
  closeTab(): void;
}

export function wireTabCrashEvents(wc: WebContents, host: TabCrashHost): void {
  // Ctrl+колесо принадлежит браузеру; странице нативный зум Chromium не отдаём.
  wc.on('zoom-changed', (event, direction) => {
    if (!host.mine()) return;
    event.preventDefault();
    host.onZoom(direction);
  });

  wc.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
    if (!host.mine()) return;
    if (!isMainFrame || errorCode === -3) return; // ERR_ABORTED — не ошибка страницы
    const url = wc.getURL() || validatedURL;
    // Снимок сети нужен в момент сбоя, не позднее при рисовании экрана ошибки.
    let russianCa = false;
    try {
      russianCa = errorCode === -202 && host.isRussianCaCandidate(new URL(url).hostname);
    } catch { /* адрес не разбирается */ }
    host.reportError({ type: 'load', code: errorCode, url, offline: !host.isOnline(), russianCa });
    host.notify();
  });

  // Контент может вызвать window.close() сам. При обычном closeTab/sleepTab старая вью уже
  // отвязана; при выходе всё окно уничтожено, а сессия сохранена ранее в win.on('close').
  wc.on('destroyed', () => {
    if (!host.mine()) return;
    if (host.windowDestroyed()) return;
    if (!host.viewStillCurrent()) return;
    host.closeTab();
  });

  wc.on('render-process-gone', () => {
    // Исходный обработчик не проверял mine(): сохраняем это поведение при переносе вкладки.
    host.reportError({ type: 'crash', code: 0, url: wc.getURL(), offline: false });
    host.notify();
  });
}
