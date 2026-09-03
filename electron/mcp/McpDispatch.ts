import { app } from 'electron';
import {
  MCP_SUPPORTED_VERSIONS, MCP_TOOLS, MCP_VERSION,
  annotationsFor, clientKey, clientLabel, decide, mustAsk, pickVersion,
} from '../../shared/mcpPolicy';
import {
  activateTab, activePageText, closeTab, listTabs, openTab, searchHistory,
} from './McpTools';
import { askToConnect, isApproved, stancesFor, touchClient } from './McpClients';
import { confirmWrite } from './McpConfirm';
import type { HistoryManager } from '../HistoryManager';

// Разбор запросов MCP. Один вход, один выход, никакого состояния между вызовами.
//
// ⚠️ ПРОТОКОЛ ПИШЕМ САМИ, И ЭТО РЕШЕНИЕ, А НЕ ЛЕНЬ ПОСТАВИТЬ ЗАВИСИМОСТЬ. Официальный SDK,
// умеющий ревизию 2026-07-28, живёт в ветке 2.0.0 и в npm не выложен — `latest` там 1.30.0 со
// старой ревизией. То есть зависимость дала бы нам ровно ту эпоху, которую спека уже сменила,
// плюс свой слой транспорта, который нам не подходит (см. McpPipe.ts). Серверная часть, которая
// нужна для трёх инструментов на чтение, — это четыре метода и три десятка строк разбора.
//
// ⚠️ ОТВЕЧАЕМ ОБЕИМ ЭПОХАМ. Ревизия 2026-07-28 убрала рукопожатие `initialize` и сессии, но
// выпущенные клиенты ходят по-старому. Разница для нас невелика ровно потому, что мы и так без
// состояния: старому клиенту надо просто ответить на `initialize`, а дальше методы те же.
//
// ⚠️ ОШИБКА ИНСТРУМЕНТА — НЕ ОШИБКА ПРОТОКОЛА. Не смогли прочитать страницу — это результат с
// `isError: true`, который модель прочитает и объяснит человеку. JSON-RPC error оставлен для
// поломок разговора (неизвестный метод, неподдержанная версия): его клиент показывает как сбой
// сервера, и «страница ещё грузится» в этом виде выглядит как «браузер сломался».

export interface McpDeps {
  /**
   * История АКТИВНОГО профиля.
   *
   * ⚠️ Функция, а не объект: история живёт на профиль (см. ProfileData.ts), и захваченная по
   * ссылке она пережила бы переключение профиля — то есть агент искал бы в чужой истории.
   */
  history: () => HistoryManager;
  /** Работает ли сервер вообще. ⚠️ Спрашивается на КАЖДЫЙ вызов: его могли выключить секунду назад. */
  running: () => boolean;
  /** Журнал: кто, что и чем кончилось. Нужен интерфейсу следующего захода. */
  log?: (entry: McpLogEntry) => void;
}

export interface McpLogEntry {
  at: number;
  client: string;
  tool: string;
  ok: boolean;
  note?: string;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const META = 'io.modelcontextprotocol/';

function metaOf(req: JsonRpcRequest): Record<string, unknown> {
  const m = req.params?._meta;
  return typeof m === 'object' && m !== null ? m as Record<string, unknown> : {};
}

/** Как клиент себя назвал. ⚠️ Это ПРЕДСТАВЛЕНИЕ, а не удостоверение: проверить его нечем. */
function clientName(req: JsonRpcRequest): string {
  const info = metaOf(req)[`${META}clientInfo`] ?? req.params?.clientInfo;
  const name = typeof info === 'object' && info !== null
    ? (info as { name?: unknown }).name
    : undefined;
  return clientLabel(name);
}

function ok(id: JsonRpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function fail(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } };
}

/** Результат инструмента в форме, которую ждёт клиент: текст плюс машинная копия. */
function content(value: unknown, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : { structuredContent: value }),
  };
}

function toolList() {
  return {
    tools: MCP_TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.input,
      annotations: { title: t.title, ...annotationsFor(t) },
    })),
  };
}

const SERVER_INFO = { name: 'oblako-browser', title: 'Oblako', version: app.getVersion() };

/**
 * Обработать один запрос. `null` в ответ означает «отвечать нечего» — так устроены уведомления
 * (у них нет id), и слать на них ответ протокол запрещает.
 */
export async function dispatch(req: JsonRpcRequest, deps: McpDeps): Promise<object | null> {
  const method = typeof req.method === 'string' ? req.method : '';
  const isNotification = req.id === undefined || req.id === null;

  if (method.startsWith('notifications/')) return null;

  // Версия: у новой эпохи — в _meta каждого запроса, у старой — в параметрах initialize.
  const asked = metaOf(req)[`${META}protocolVersion`] ?? req.params?.protocolVersion;
  const picked = pickVersion(method === 'initialize' ? asked : (asked ?? MCP_VERSION));
  if (!picked.ok) {
    return fail(req.id, -32602, 'Unsupported protocol version', { supported: picked.supported });
  }

  switch (method) {
    // Старая эпоха: рукопожатие. Отвечаем ТОЙ версией, о которой попросили, если она нам знакома.
    case 'initialize':
      return ok(req.id, {
        protocolVersion: picked.version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    // Новая эпоха: то же самое без рукопожатия — «кто ты и что умеешь».
    case 'server/discover':
      return ok(req.id, {
        supportedVersions: MCP_SUPPORTED_VERSIONS,
        capabilities: { tools: { listChanged: false } },
        _meta: { [`${META}serverInfo`]: SERVER_INFO },
      });

    case 'ping':
      return ok(req.id, {});

    case 'tools/list':
      return ok(req.id, toolList());

    case 'tools/call':
      return callTool(req, deps);

    default:
      if (isNotification) return null;
      return fail(req.id, -32601, `Method not found: ${method}`);
  }
}

async function callTool(req: JsonRpcRequest, deps: McpDeps): Promise<object> {
  const name = typeof req.params?.name === 'string' ? req.params.name : '';
  const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
  const who = clientName(req);
  const key = clientKey(who);
  const note = (ok: boolean, text?: string) => {
    deps.log?.({ at: Date.now(), client: who, tool: name, ok, note: text });
  };

  // ⚠️ Сервер выключили — отвечаем отказом, не спрашивая ничего у человека. Иначе выключенный
  // тумблер поднимал бы диалоги.
  if (!deps.running()) {
    note(false, 'off');
    return ok(req.id, content('The MCP server is turned off in the browser.', true));
  }

  // ⚠️ ПОДКЛЮЧЕНИЕ КЛИЕНТА — ОТДЕЛЬНОЕ РЕШЕНИЕ ЧЕЛОВЕКА, а не следствие включённого сервера.
  // Незнакомая программа спрашивает разрешение один раз; отказ запоминается на несколько минут,
  // чтобы повторными вызовами нельзя было выбить согласие измором (см. McpClients.ts).
  if (!isApproved(key) && !(await askToConnect(key, who))) {
    note(false, 'not-connected');
    return ok(req.id, content(
      'The user has not connected this client to the browser. A card was shown in the browser window.',
      true,
    ));
  }
  touchClient(key);

  const verdict = decide(name, { connected: true, stances: stancesFor(key) });
  if (!verdict.ok) {
    note(false, verdict.reason);
    // ⚠️ Отказ по разрешению — тоже РЕЗУЛЬТАТ, а не ошибка протокола: модель должна прочитать
    // его словами и передать человеку («включите инструмент в браузере»), а не показать сбой.
    return ok(req.id, content(verdict.message, true));
  }

  // ⚠️ Вопрос задаётся ПЕРЕД действием и ждёт человека. Разбор, почему карточка наша, а не
  // клиентская (то есть почему не MRTR), — в шапке McpConfirm.ts.
  if (mustAsk(verdict.tool, stancesFor(key))) {
    const allowed = await confirmWrite({ clientKey: key, clientLabel: who, tool: verdict.tool, args });
    if (!allowed) {
      note(false, 'refused');
      return ok(req.id, content('The user refused this action in the browser.', true));
    }
  }

  try {
    const result = await run(verdict.tool.name, args, deps);
    note(true);
    return ok(req.id, content(result));
  } catch (e) {
    const message = (e as Error).message || String(e);
    console.warn('[mcp] инструмент упал:', name, message);
    note(false, message);
    return ok(req.id, content(`Tool failed: ${message}`, true));
  }
}

async function run(name: string, args: Record<string, unknown>, deps: McpDeps): Promise<unknown> {
  switch (name) {
    case 'tabs.list': {
      const tabs = listTabs();
      return { tabs, count: tabs.length };
    }
    case 'page.text': {
      const page = await activePageText();
      // Не «пусто», а причина словами — см. разбор в McpTools.ts.
      if (!page.ok) throw new Error(page.error ?? 'unavailable');
      return { title: page.title, url: page.url, text: page.text };
    }
    case 'history.search': {
      const query = typeof args.query === 'string' ? args.query : '';
      if (!query.trim()) throw new Error('Argument "query" is required.');
      const hits = searchHistory(deps.history(), query, args.limit);
      return { query, hits, count: hits.length };
    }
    case 'tabs.open': {
      const res = openTab(args.url, args.background);
      if (!res.ok) throw new Error(res.note);
      return { opened: true, note: res.note };
    }
    case 'tabs.activate': {
      const res = activateTab(args.id);
      if (!res.ok) throw new Error(res.note);
      return { switched: true, note: res.note };
    }
    case 'tabs.close': {
      const res = closeTab(args.id);
      if (!res.ok) throw new Error(res.note);
      return { closed: true, note: res.note };
    }
    default:
      // Недостижимо: имя уже прошло decide(). Оставлено как явный отказ, а не молчание.
      throw new Error(`Tool ${name} has no implementation.`);
  }
}
