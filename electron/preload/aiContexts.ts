// Мост редактора наборов контекста (shared/aiContexts.ts) для настроек. Своим файлом по той же
// причине, что insights.ts: фича целиком, каналы не из shared/ipc, а preload.ts на храповике.
import { ipcRenderer } from 'electron';
import { AI_CONTEXTS, type AiContextsApi, type AiContextsState } from '../../shared/aiContexts';

export const aiContextsBridge: AiContextsApi = {
  aiContexts: () => ipcRenderer.invoke(AI_CONTEXTS.list),
  saveAiContext: (input) => ipcRenderer.invoke(AI_CONTEXTS.save, input),
  removeAiContext: (id) => ipcRenderer.invoke(AI_CONTEXTS.remove, id),
  setDefaultAiContext: (id) => ipcRenderer.invoke(AI_CONTEXTS.setDefault, id),
  onAiContextsChanged: (cb) => {
    const h = (_event: unknown, state: AiContextsState) => cb(state);
    ipcRenderer.on(AI_CONTEXTS.changed, h);
    return () => { ipcRenderer.removeListener(AI_CONTEXTS.changed, h); };
  },
};
