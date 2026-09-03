import { IPC } from '../../shared/ipc';
import type { McpCallLog } from '../../shared/ipc';
import { broadcastToChrome } from '../WindowRegistry';

// Журнал вызовов внешнего агента.
//
// ⚠️ Он существует не для отладки, а как ЕДИНСТВЕННЫЙ способ человеку узнать, что происходило с
// его браузером, пока он смотрел в другое окно. Индикатор говорит «сейчас», журнал — «что было»;
// без второго первый бесполезен ровно в том случае, ради которого он заведён.
//
// ⚠️ Только в памяти и только последние записи. Писать это на диск значило бы завести файл, где
// перечислены адреса, которые человек читал, — то есть вторую историю посещений рядом с той,
// которую он умеет чистить. Журнал живёт, пока живёт запущенный браузер.

const LIMIT = 200;

const entries: McpCallLog[] = [];

export function rememberCall(entry: McpCallLog): void {
  entries.unshift(entry);
  if (entries.length > LIMIT) entries.length = LIMIT;
  // ⚠️ Рассылка ВСЕМ окнам, а не окну-инициатору: инициатора здесь нет вовсе — вызов пришёл
  // снаружи браузера. Метка «сейчас тобой управляет внешний агент» обязана быть видна там, куда
  // человек смотрит, а какое это окно, мы не знаем.
  broadcastToChrome(IPC.MCP_ACTIVITY, entry);
}

export function recentCalls(): McpCallLog[] {
  return entries.slice(0, 50);
}

export function clearCalls(): void {
  entries.length = 0;
}
