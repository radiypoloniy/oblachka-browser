import { app, ipcMain } from 'electron';
import { IPC } from '../../shared/ipc';
import type { McpServerState } from '../../shared/ipc';
import { MCP_TOOLS } from '../../shared/mcpPolicy';
import { connectCommand, initMcp, mcpState, setMcpEnabled, stopMcp } from '../mcp';
import { recentCalls } from '../mcp/McpLog';
import { listClients, revokeClient, setToolEnabled } from '../mcp/McpClients';
import type { IpcDeps } from './deps';

// Браузер как инструмент внешнего агента — три канала на весь раздел настроек.
//
// ⚠️ Свой файл, а не строки в чужом: остальные модули ipc/ нарезаны непрерывными кусками из
// прежнего main.ts (см. deps.ts), и дописывать новый домен в середину такого куска значило бы
// смешать историческую нарезку с доменной. Новое живёт отдельно.

export function registerMcpIpc(d: IpcDeps): void {
  const { history, settings } = d;

  // ⚠️ Жизненный цикл сервера живёт ЗДЕСЬ, а не в main.ts, и это не только правило храповика.
  // Включение сервера и канал, которым его включают, — одно и то же решение; разъехавшись по
  // файлам, они однажды разойдутся и по смыслу (настройка включена, сервер не поднят).
  initMcp({ history, enabled: settings.getMcpEnabled() });
  // Канал закрываем явно: иначе он переживёт окно и останется висеть вместе с процессом.
  app.once('before-quit', stopMcp);

  const state = (): McpServerState => ({
    enabled: settings.getMcpEnabled(),
    running: mcpState(),
    command: connectCommand(),
    tools: MCP_TOOLS.map((t) => ({ name: t.name, title: t.title, mode: t.mode })),
    clients: listClients(),
  });

  ipcMain.handle(IPC.MCP_STATE, () => state());
  // ⚠️ Тумблер меняет ДВЕ вещи разом — настройку и живой сервер, — и порядок здесь важен:
  // сначала записали решение человека, потом привели сервер в соответствие. Обратный порядок
  // при падении подъёма канала оставил бы «включено» в настройках и молчащий сервер на деле.
  ipcMain.handle(IPC.MCP_SET, (_e, enabled: boolean) => {
    settings.setMcpEnabled(!!enabled);
    setMcpEnabled(settings.getMcpEnabled());
    return state();
  });
  ipcMain.handle(IPC.MCP_CALLS, () => recentCalls());
  // ⚠️ Отзыв гасит и выданные подтверждения на запись (см. McpClients.revokeClient): иначе
  // отключённая программа успела бы доиграть минуту чужого «разрешаю».
  ipcMain.handle(IPC.MCP_REVOKE, (_e, key: string) => {
    revokeClient(String(key ?? ''));
    return state();
  });
  ipcMain.handle(IPC.MCP_TOOL_SET, (_e, key: string, tool: string, on: boolean) => {
    setToolEnabled(String(key ?? ''), String(tool ?? ''), !!on);
    return state();
  });
}
