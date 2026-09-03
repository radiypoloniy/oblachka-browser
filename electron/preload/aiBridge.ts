// Мост renderer ↔ main для доступа к моделям: ключи и подключения.
//
// ⚠️ Вынесено из preload.ts не ради красоты. Этот файл — единственная дверь между интерфейсом и
// main, и он давно перерос порог: три захода подряд любая новая функция упиралась в него, а
// «просто добавить строчку» в дверь на девятьсот строк означает, что дверь никто уже не читает.
// Доступ к моделям — связная и обособленная часть: ключи, подключения, маршруты и проба.
//
// ⚠️ КЛЮЧ ЗДЕСЬ ТОЛЬКО УХОДИТ. Ни один метод не возвращает секрет: наружу приезжает статус
// («подключено») и список подключений, у которых ключ на месте. Разбор — в electron/ai/KeyStore.ts.
//
// ⚠️ Относительный импорт тут законен: preload окна хрома НЕ песочный. У гостевых страниц
// (preload-content.ts) он песочный, и там строки каналов дублируются руками — см. CLAUDE.md.
import { ipcRenderer } from 'electron';
import { IPC } from '../../shared/ipc';
import type { AiConnection, AiConnectionsState, AiConnectionTest } from '../../shared/ipc';
import type { AiUsage } from '../../shared/aiUsage';

export const aiBridge = {
  getAiKeyStatus: () => ipcRenderer.invoke(IPC.AI_GET_KEY_STATUS) as Promise<boolean>,
  saveAiKey:      (key: string) => ipcRenderer.invoke(IPC.AI_SAVE_KEY, key) as Promise<boolean>,
  deleteAiKey:    () => ipcRenderer.invoke(IPC.AI_DELETE_KEY) as Promise<void>,
  onAiKeyStatusChanged: (cb: (connected: boolean) => void) => {
    const handler = (_e: unknown, connected: boolean) => cb(connected);
    ipcRenderer.on(IPC.AI_KEY_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.AI_KEY_STATUS_CHANGED, handler);
  },

  aiConnections: () => ipcRenderer.invoke(IPC.AI_CONN_LIST) as Promise<AiConnectionsState>,
  saveAiConnection: (conn: AiConnection, key: string | null) =>
    ipcRenderer.invoke(IPC.AI_CONN_SAVE, conn, key) as Promise<boolean>,
  deleteAiConnection: (id: string) => ipcRenderer.invoke(IPC.AI_CONN_DELETE, id) as Promise<boolean>,
  testAiConnection: (conn: AiConnection, key: string | null) =>
    ipcRenderer.invoke(IPC.AI_CONN_TEST, conn, key) as Promise<AiConnectionTest>,
  setAiRoute: (role: string, connectionId: string | null) =>
    ipcRenderer.invoke(IPC.AI_SET_ROUTE, role, connectionId) as Promise<boolean>,
  aiUsage: () => ipcRenderer.invoke(IPC.AI_USAGE) as Promise<Record<string, AiUsage>>,
  resetAiUsage: (connectionId?: string) => ipcRenderer.invoke(IPC.AI_USAGE_RESET, connectionId) as Promise<void>,
  aiFileData: (id: string) => ipcRenderer.invoke(IPC.AI_FILE_DATA, id) as Promise<string | null>,
  aiFileSave: (id: string) => ipcRenderer.invoke(IPC.AI_FILE_SAVE, id) as Promise<boolean>,
  aiTextSave: (name: string, text: string) =>
    ipcRenderer.invoke(IPC.AI_TEXT_SAVE, name, text) as Promise<boolean>,
  onAiConnectionsChanged: (cb: (state: AiConnectionsState) => void) => {
    const h = (_e: unknown, state: AiConnectionsState) => cb(state);
    ipcRenderer.on(IPC.AI_CONN_CHANGED, h);
    return () => { ipcRenderer.off(IPC.AI_CONN_CHANGED, h); };
  },
};
