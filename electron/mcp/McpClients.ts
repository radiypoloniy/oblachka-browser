import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { MCP_TOOLS, type McpStance } from '../../shared/mcpPolicy';
import { askMcp, dropMcpPrompts } from '../McpPromptManager';

// Кто подключён к браузеру и что ему позволено.
//
// ⚠️ ВКЛЮЧЁННЫЙ СЕРВЕР — НЕ СОГЛАСИЕ НА КОНКРЕТНУЮ ПРОГРАММУ. В первом заходе это было одно и то
// же, и это была временная неправда: человек включал «браузер как инструмент», а получал доступ
// для любого процесса, узнавшего токен. Теперь у каждого клиента своя карточка, и отзывается он
// отдельно от сервера.
//
// ⚠️ ЛИЧНОСТЬ КЛИЕНТА НЕПРОВЕРЯЕМА, и запись на диске этого не меняет: ключ — это имя, которым
// программа сама себя назвала. Отсюда честная граница: карточка спрашивает не «вы доверяете
// Claude Desktop?», а «что-то представилось так и просит доступ». Настоящий барьер — токен канала
// (McpPipe.ts) и то, что человек видит подключение и журнал.
//
// ⚠️ ОТКАЗ ЗАПОМИНАЕТСЯ НА ВРЕМЯ. Программа, которой отказали, обычно повторяет вызов сразу же:
// без паузы человек получил бы то же окно снова и снова и в конце концов нажал бы «Разрешить»,
// чтобы оно отстало. Это не гипотеза, а известный способ выбить согласие измором.

const FILE = 'mcp-clients.json';
const DENY_COOLDOWN_MS = 5 * 60_000;
/** Сколько ждём ответа человека, прежде чем ответить программе «нет». */
const WAIT_MS = 60_000;

export interface McpClientRecord {
  key: string;
  label: string;
  approvedAt: number;
  lastSeen: number;
  /**
   * Решения человека по инструментам: 'ask' | 'allow' | 'deny'.
   *
   * ⚠️ Пришло на смену списку выключенных, и это не переименование: раньше выбора было два
   * («спрашивать» или «нельзя»), а нужного третьего — «делай молча» — не существовало, отчего
   * каждый вызов и превращался в вопрос.
   */
  stances: Record<string, McpStance>;
}

let clients: McpClientRecord[] = [];
let loaded = false;

const denied = new Map<string, number>();
const asking = new Map<string, Promise<boolean>>();

function file(): string {
  return path.join(app.getPath('userData'), FILE);
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as unknown;
    if (!Array.isArray(raw)) return;
    clients = raw.filter((c): c is McpClientRecord =>
      typeof c === 'object' && c !== null
      && typeof (c as McpClientRecord).key === 'string'
      && typeof (c as McpClientRecord).label === 'string');
    for (const c of clients) {
      // ⚠️ Записи прошлой версии несли список выключенных инструментов. Переводим их, а не
      // выбрасываем: человек уже принимал эти решения, и терять их при обновлении нельзя.
      const old = (c as unknown as { disabled?: unknown }).disabled;
      if (!c.stances || typeof c.stances !== 'object') c.stances = {};
      if (Array.isArray(old)) {
        for (const t of old) if (typeof t === 'string') c.stances[t] = 'deny';
        delete (c as unknown as { disabled?: unknown }).disabled;
      }
    }
  } catch { /* файла ещё нет — это чистая установка, а не поломка */ }
}

function save(): void {
  try {
    fs.writeFileSync(file(), JSON.stringify(clients, null, 2), 'utf8');
  } catch (e) {
    console.warn('[mcp] не удалось записать список клиентов:', (e as Error).message);
  }
}

export function listClients(): McpClientRecord[] {
  load();
  return clients.map((c) => ({ ...c, stances: { ...c.stances } }));
}

export function isApproved(key: string): boolean {
  load();
  return clients.some((c) => c.key === key);
}

export function stancesFor(key: string): Record<string, McpStance> {
  load();
  return clients.find((c) => c.key === key)?.stances ?? {};
}

export function touchClient(key: string): void {
  load();
  const c = clients.find((x) => x.key === key);
  if (!c) return;
  c.lastSeen = Date.now();
  save();
}

/**
 * Отозвать доступ.
 *
 * ⚠️ Выданные подтверждения на запись гасит ВЫЗЫВАЮЩИЙ (electron/ipc/mcp.ts), а не этот модуль,
 * и это не мелочь стиля: обратный порядок делал бы McpClients и McpConfirm взаимно
 * импортирующими друг друга. Цикл в main-процессе живёт тихо ровно до дня, когда в одном из
 * модулей появится работа на верхнем уровне.
 */
export function revokeClient(key: string): void {
  load();
  clients = clients.filter((c) => c.key !== key);
  denied.delete(key);
  // Висящий вопрос отключённой программы отвечать некому — снимаем.
  dropMcpPrompts();
  save();
}

/** Как поступать с инструментом у этой программы: спрашивать, разрешать молча или не давать. */
export function setStance(key: string, tool: string, stance: McpStance): void {
  load();
  const c = clients.find((x) => x.key === key);
  if (!c || !MCP_TOOLS.some((t) => t.name === tool)) return;
  c.stances = { ...c.stances, [tool]: stance };
  save();
}

/**
 * Спросить человека про НОВУЮ программу.
 *
 * ⚠️ Один вопрос на клиента за раз и пауза после отказа — см. разбор в шапке. Здесь же
 * единственное место, где запись о клиенте появляется на диске: без нажатия «Подключить» её нет.
 */
export async function askToConnect(key: string, label: string): Promise<boolean> {
  load();
  if (isApproved(key)) return true;

  const until = denied.get(key) ?? 0;
  if (Date.now() < until) return false;

  let ask = asking.get(key);
  if (!ask) {
    ask = prompt(label).then((yes) => {
      asking.delete(key);
      if (!yes) {
        denied.set(key, Date.now() + DENY_COOLDOWN_MS);
        return false;
      }
      clients = [
        ...clients.filter((c) => c.key !== key),
        { key, label, approvedAt: Date.now(), lastSeen: Date.now(), stances: {} },
      ];
      save();
      return true;
    });
    asking.set(key, ask);
  }

  // ⚠️ Таймаут решает, что ответить программе, и НЕ закрывает окно (разбор — в McpConfirm.ts):
  // человек, подошедший к машине через пять минут, всё равно подключит клиента, а тот пройдёт
  // со следующей попытки. Без ответа вызов висел бы, пока не оборвётся сам клиент.
  const timeout = new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), WAIT_MS); });
  return Promise.race([ask, timeout]);
}

async function prompt(label: string): Promise<boolean> {
  const read = MCP_TOOLS.filter((t) => t.mode === 'read').map((t) => `• ${t.title}`).join('\n');
  const res = await askMcp({
    kind: 'connect',
    client: label,
    title: 'Подключить программу?',
    detail:
      `Сможет без отдельного вопроса:\n${read}\n\n`
      + 'Изменения — открыть, переключить или закрыть вкладку — спрашиваются отдельно. '
      + 'Пароли, куки и приватные вкладки не отдаются вовсе.',
    // ⚠️ У подключения «всегда» нет: сам ответ «Подключить» и есть решение навсегда, а вторая
    // кнопка с тем же смыслом читалась бы как «а эта — ещё сильнее?».
    canRemember: false,
  });
  return res.granted;
}
