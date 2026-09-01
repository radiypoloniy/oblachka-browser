import type { OblakoApi, ResourceSnapshot, ThemePrefs } from '../shared/ipc';

declare global {
  interface Window {
    oblako: OblakoApi;
    /**
     * Мост окна диспетчера задач (см. electron/preload-taskmanager.ts). ⚠️ Отдельно от
     * `oblako`: у диспетчера своё окно и свой preload, и давать ему весь API браузера незачем.
     * Есть только в этом окне — на остальных страницах обращение к нему упадёт.
     */
    taskManager: {
      getSnapshot(): Promise<ResourceSnapshot>;
      sleepTab(tabId: string): Promise<boolean>;
      unloadModel(): Promise<void>;
      getTheme(): Promise<ThemePrefs>;
    };
  }
}

export {};
