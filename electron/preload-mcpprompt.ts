// Минимальный preload для карточки внешнего агента (src/mcpprompt.tsx).
//
// ⚠️ Свои маленькие каналы (mcp-prompt:*), а не контракт основного хрома, — как у поповера
// разрешений и findbar: эта вью не часть интерфейса окна, она задаёт один вопрос и исчезает.
import { contextBridge, ipcRenderer } from 'electron';
import type { McpPromptRequest } from '../shared/ipc';

contextBridge.exposeInMainWorld('mcpPrompt', {
  respond: (id: string, granted: boolean, remember: boolean) =>
    ipcRenderer.send('mcp-prompt:respond', id, granted, remember),
  reportHeight: (px: number) => ipcRenderer.send('mcp-prompt:height', px),

  // null — очередь опустела: вью ничего не рисует, её вот-вот открепят.
  onRequest: (cb: (req: McpPromptRequest | null) => void) => {
    const handler = (_e: unknown, req: McpPromptRequest | null) => cb(req);
    ipcRenderer.on('mcp-prompt:request', handler);
    return () => ipcRenderer.removeListener('mcp-prompt:request', handler);
  },
});
