import { app, ipcMain } from 'electron';
import { IPC } from '../../shared/ipc';
import type { McpServerState } from '../../shared/ipc';
import { MCP_TOOLS, type McpStance } from '../../shared/mcpPolicy';
import { connectCommand, initMcp, mcpState, setMcpEnabled, stopMcp } from '../mcp';
import { recentCalls } from '../mcp/McpLog';
import { answer, setMcpPromptHeight } from '../McpPromptManager';
import { listClients, revokeClient, setStance } from '../mcp/McpClients';
import { forgetApprovals } from '../mcp/McpConfirm';
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
  // ⚠️ Свои маленькие каналы карточки (mcp-prompt:*), а не контракт хрома: вью задаёт один
  // вопрос и исчезает — тот же приём, что у поповера разрешений и findbar.
  ipcMain.on('mcp-prompt:respond', (_e, id: string, granted: boolean, remember: boolean) => {
    answer(String(id ?? ''), { granted: !!granted, remember: !!remember });
  });
  ipcMain.on('mcp-prompt:height', (e, px: number) => setMcpPromptHeight(e.sender, Number(px) || 0));
  // ⚠️ Отзыв гасит и выданные подтверждения на запись (см. McpClients.revokeClient): иначе
  // отключённая программа успела бы доиграть минуту чужого «разрешаю».
  ipcMain.handle(IPC.MCP_REVOKE, (_e, key: string) => {
    const key0 = String(key ?? '');
    revokeClient(key0);
    // ⚠️ И выданные подтверждения на запись: без этого отключённая программа успела бы доиграть
    // минуту чужого «разрешаю».
    forgetApprovals(key0);
    return state();
  });
  ipcMain.handle(IPC.MCP_TOOL_SET, (_e, key: string, tool: string, stance: McpStance) => {
    setStance(String(key ?? ''), String(tool ?? ''), stance);
    return state();
  });
}
