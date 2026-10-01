// Минимальный preload для карточки внешнего агента (src/mcpprompt.tsx).
//
// ⚠️ Свои маленькие каналы (mcp-prompt:*), а не контракт основного хрома: отдельное окно
// задаёт один вопрос и исчезает, не деля состояние с вкладками браузера.
import { contextBridge, ipcRenderer } from 'electron';
import { exposeUiLanguage } from './preload/uiLanguage';
import type { McpPromptRequest } from '../shared/ipc';

contextBridge.exposeInMainWorld('mcpPrompt', {
  respond: (id: string, granted: boolean, remember: boolean) =>
    ipcRenderer.send('mcp-prompt:respond', id, granted, remember),
  reportHeight: (px: number, requestId: string) => ipcRenderer.send('mcp-prompt:height', px, requestId),
  ready: () => ipcRenderer.send('mcp-prompt:ready'),

  // null — очередь опустела: вью ничего не рисует, её вот-вот открепят.
  onRequest: (cb: (req: McpPromptRequest | null) => void) => {
    const handler = (_e: unknown, req: McpPromptRequest | null) => cb(req);
    ipcRenderer.on('mcp-prompt:request', handler);
    return () => ipcRenderer.removeListener('mcp-prompt:request', handler);
  },
});
exposeUiLanguage();
