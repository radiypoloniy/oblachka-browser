import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { ResourceSnapshot, ThemePrefs } from '../shared/ipc';

// Мост окна диспетчера задач (Shift+Esc).
//
// ⚠️ Своих обработчиков в main здесь ровно два — снимок и усыпление вкладки. Всё остальное берётся
// боевыми каналами, которые уже есть: тема тем же `THEME_GET`, что у всего интерфейса, выгрузка
// модели тем же `MODEL_UNLOAD`, который до сих пор был «заделом без потребителей». Тот же приём,
// что в preload-sitepopover: диспетчер не заводит параллельный мир, он собирает существующее.
//
// ⚠️ Снимок ЗАПРАШИВАЕТСЯ отсюда раз в секунду, а не приходит пушем. Пока окно закрыто, в main
// никто ничего не считает и никакой таймер не тикает — опрос умирает вместе с окном.
contextBridge.exposeInMainWorld('taskManager', {
  getSnapshot: () => ipcRenderer.invoke(IPC.RESOURCES_SNAPSHOT) as Promise<ResourceSnapshot>,

  // Усыпление идёт ЧЕРЕЗ TabManager, а не убийством процесса: снять рендерер мимо модели вкладок
  // значило бы оставить её в состоянии, которого не бывает. false — усыпить нельзя (активная,
  // хаб, уже спит).
  sleepTab: (tabId: string) => ipcRenderer.invoke(IPC.RESOURCES_SLEEP_TAB, tabId) as Promise<boolean>,

  // Тот самый канал, ради которого он и писался: до диспетчера у выгрузки модели не было ни одной
  // кнопки во всём приложении.
  unloadModel: () => ipcRenderer.invoke(IPC.MODEL_UNLOAD) as Promise<void>,

  getTheme: () => ipcRenderer.invoke(IPC.THEME_GET) as Promise<ThemePrefs>,
});
