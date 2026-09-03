// Мост renderer ↔ main для MCP-сервера: включение и то, что о нём видно в настройках.
//
// ⚠️ Тот же приём и та же причина, что у preload/aiBridge.ts: preload — единственная дверь между
// интерфейсом и main, и она давно за порогом храповика. Новая связная часть заезжает своим
// файлом, а не тремя строчками в дверь на девятьсот строк.
//
// ⚠️ Наружу отдаётся СОСТОЯНИЕ, а не управление каналом: поднять или закрыть его может только
// main, и только по записанной настройке. Токен подключения через эту дверь не ходит вовсе —
// его знает шим, читающий файл в userData (см. electron/mcp/McpPipe.ts).
import { ipcRenderer } from 'electron';
import { IPC } from '../../shared/ipc';
import type { McpCallLog, McpServerState } from '../../shared/ipc';

export const mcpBridge = {
  getMcpState: () => ipcRenderer.invoke(IPC.MCP_STATE) as Promise<McpServerState>,
  setMcpEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.MCP_SET, enabled) as Promise<McpServerState>,
  getMcpCalls: () => ipcRenderer.invoke(IPC.MCP_CALLS) as Promise<McpCallLog[]>,
  revokeMcpClient: (key: string) =>
    ipcRenderer.invoke(IPC.MCP_REVOKE, key) as Promise<McpServerState>,
  setMcpToolEnabled: (key: string, tool: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.MCP_TOOL_SET, key, tool, enabled) as Promise<McpServerState>,
  onMcpActivity: (cb: (call: McpCallLog) => void) => {
    const handler = (_e: unknown, call: McpCallLog) => cb(call);
    ipcRenderer.on(IPC.MCP_ACTIVITY, handler);
    return () => ipcRenderer.removeListener(IPC.MCP_ACTIVITY, handler);
  },
};
