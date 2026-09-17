import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../../shared/ipc';
import type { UiLanguage } from '../../shared/uiLanguage';

/**
 * Язык интерфейса для изолированных chrome-вью (поповеры, панель, оверлеи).
 *
 * ⚠️ broadcastToChrome до них не доезжает, а localStorage между WebContentsView
 * в Electron не всегда шлёт storage. Без своего get поповер прогревается раньше хрома
 * и остаётся на языке по умолчанию.
 */
export function exposeUiLanguage(): void {
  contextBridge.exposeInMainWorld('uiLanguage', {
    get: () => ipcRenderer.invoke(IPC.UI_LANGUAGE_GET) as Promise<UiLanguage>,
    onChanged: (cb: (language: UiLanguage) => void) => {
      const handler = (_e: unknown, language: UiLanguage) => cb(language);
      ipcRenderer.on(IPC.UI_LANGUAGE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC.UI_LANGUAGE_CHANGED, handler);
    },
  });
}
