import path from 'node:path';
import { app } from 'electron';
import { endpointPath, mcpRunning, startMcpServer, stopMcpServer } from './McpPipe';
import { rememberCall } from './McpLog';
import { forgetApprovals } from './McpConfirm';
import { dropMcpPrompts } from '../McpPromptManager';
import type { HistoryManager } from '../HistoryManager';

// Подъём и остановка MCP-сервера — единственная точка, через которую его включают.
//
// ⚠️ СЕРВЕР НЕ ПОДНИМАЕТСЯ САМ. Ни при старте, ни после обновления, ни «раз уж настройка была
// включена в прошлой версии» — только по действию человека и только пока настройка включена.
// Это доступ чужой программы к живому профилю: состояние по умолчанию у такой двери одно.

let deps: { history: () => HistoryManager } | null = null;

export function initMcp(d: { history: () => HistoryManager; enabled: boolean }): void {
  deps = { history: d.history };
  setMcpEnabled(d.enabled);
}

export function setMcpEnabled(on: boolean): void {
  if (!on || !deps) {
    stopMcpServer();
    // ⚠️ Выданные подтверждения на запись гасим вместе с сервером: включив его через час, человек
    // не должен обнаружить, что чьё-то «разрешаю» ещё в силе. Висящие вопросы снимаем тем же
    // движением — отвечать на них уже некому.
    forgetApprovals();
    dropMcpPrompts();
    return;
  }
  startMcpServer({
    history: deps.history,
    // ⚠️ Спрашивается на КАЖДЫЙ вызов, а не запоминается при подъёме: человек мог выключить
    // сервер секунду назад, и уже открытое соединение обязано это почувствовать.
    running: mcpRunning,
    log: rememberCall,
  });
}

export function mcpState(): boolean {
  return mcpRunning();
}

export function stopMcp(): void {
  stopMcpServer();
}

/**
 * Команда подключения для чужого клиента — готовой строкой.
 *
 * ⚠️ Собирается ЗДЕСЬ, а не в интерфейсе, потому что только main знает настоящие пути: в сборке
 * шим лежит рядом с приложением (resources/mcp/shim.mjs), в разработке — в дереве проекта.
 * Человек должен получить строку, которую можно вставить как есть.
 *
 * ⚠️ Запускается наш же бинарник в режиме Node (ELECTRON_RUN_AS_NODE): отдельного .exe нет и не
 * нужно, а требовать установленный node у человека мы не вправе.
 */
export function connectCommand(): string {
  const shim = app.isPackaged
    ? path.join(process.resourcesPath, 'mcp', 'shim.mjs')
    : path.join(app.getAppPath(), 'resources', 'mcp', 'shim.mjs');
  return `claude mcp add oblako --env ELECTRON_RUN_AS_NODE=1 -- "${process.execPath}" "${shim}" --endpoint "${endpointPath()}"`;
}
