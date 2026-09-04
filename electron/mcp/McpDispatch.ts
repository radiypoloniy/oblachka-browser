import { app } from 'electron';
import {
  MCP_SUPPORTED_VERSIONS, MCP_TOOLS, MCP_VERSION,
  annotationsFor, canonicalToolName, clientKey, clientLabel, decide, mustAsk, pickVersion,
} from '../../shared/mcpPolicy';
import {
  activateTab, activePageLinks, activePageText, addBookmarks, closeTab, listTabs, openTab,
  readUrl,
  screenshotActiveTab, searchBookmarks, searchHistory, type McpShot,
} from './McpTools';
import {
  MCP_PROMPTS, findPrompt, missingArgs, promptArgs,
} from '../../shared/mcpPrompts';
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

/**
 * Кто на том конце соединения.
 *
 * ⚠️ Имя приходит ОДИН РАЗ — в `initialize` у старых клиентов и в `_meta` каждого запроса у
 * новых, — а решать «кто это» надо на каждом вызове. Значит соединение обязано его помнить:
 * иначе все выпущенные клиенты (а они шлют clientInfo только в рукопожатии) сливаются в одного
 * «неизвестного», и разрешение, выданное одному, действует для всех сразу. Это не косметика.
 */
export interface McpSession {
  label: string;
}

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
const UNKNOWN = clientLabel('');

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

/**
 * Ответ-картинка.
 *
 * ⚠️ Текстовая часть рядом с изображением ОБЯЗАТЕЛЬНА: модель должна знать, чью страницу ей
 * показали. Картинка без адреса — это «вот какой-то экран», и пересказ человеку получится
 * уверенным и безымянным.
 *
 * ⚠️ `structuredContent` здесь НЕ отдаём, хотя у остальных инструментов он есть: туда уехал бы
 * base64 целиком, то есть тот же снимок вторым экземпляром — и весь выигрыш от сжатия пропал бы.
 */
function imageContent(shot: McpShot) {
  const where = [shot.title, shot.url].filter(Boolean).join('\n');
  return {
    content: [
      { type: 'text', text: `${where}\n${shot.width}×${shot.height}, снимок видимой области.` },
      { type: 'image', data: shot.data, mimeType: shot.mime },
    ],
  };
}

/** Похоже ли на снимок: распознаём по форме, чтобы не заводить второй список имён инструментов. */
function asShot(value: unknown): McpShot | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as McpShot;
  return typeof v.data === 'string' && typeof v.mime === 'string' ? v : null;
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
export async function dispatch(
  req: JsonRpcRequest,
  deps: McpDeps,
  session: McpSession,
): Promise<object | null> {
  const method = typeof req.method === 'string' ? req.method : '';
  // Имя, названное в рукопожатии или в _meta, запоминаем на всё соединение.
  const named = clientName(req);
  if (named !== UNKNOWN) session.label = named;
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
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    // Новая эпоха: то же самое без рукопожатия — «кто ты и что умеешь».
    case 'server/discover':
      return ok(req.id, {
        supportedVersions: MCP_SUPPORTED_VERSIONS,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        _meta: { [`${META}serverInfo`]: SERVER_INFO },
      });

    case 'ping':
      return ok(req.id, {});

    case 'tools/list':
      return ok(req.id, toolList());

    // ⚠️ Промпты — ТЕКСТ для чата человека, а не действие: клиент показывает их списком (в Claude
    // Desktop — слэш-командами) и подставляет от его имени. Агентного цикла тут нет, каждый вызов
    // инструмента внутри сценария проходит те же разрешения (разбор — в shared/mcpPrompts.ts).
    case 'prompts/list':
      return ok(req.id, {
        prompts: MCP_PROMPTS.map((p) => ({
          name: p.name,
          title: p.title,
          description: p.description,
          ...(p.arguments ? { arguments: p.arguments } : {}),
        })),
      });

    case 'prompts/get': {
      const wanted = typeof req.params?.name === 'string' ? req.params.name : '';
      const spec = findPrompt(wanted);
      // ⚠️ Ошибка ПРОТОКОЛА, а не результата: промпт — это часть каталога сервера, и «нет такого
      // сценария» означает, что клиент спросил несуществующее, а не что задача не удалась.
      if (!spec) return fail(req.id, -32602, `Unknown prompt: ${wanted}`);
      const args = promptArgs(req.params?.arguments);
      const missing = missingArgs(spec, args);
      if (missing.length > 0) {
        return fail(req.id, -32602, `Missing required argument: ${missing.join(', ')}`);
      }
      return ok(req.id, {
        description: spec.description,
        messages: [{ role: 'user', content: { type: 'text', text: spec.build(args) } }],
      });
    }

    case 'tools/call':
      return callTool(req, deps, session);

    default:
      if (isNotification) return null;
      return fail(req.id, -32601, `Method not found: ${method}`);
  }
}

async function callTool(req: JsonRpcRequest, deps: McpDeps, session: McpSession): Promise<object> {
  // ⚠️ Имя приводим к каноническому СРАЗУ: клиент мог прислать прежнее написание через точку
  // (или своё, с заменой точки на подчёркивание — так делает Cursor). Дальше по коду имя участвует
  // в правах, журнале и ответах, и два написания одного инструмента там разъедутся молча.
  const name = canonicalToolName(typeof req.params?.name === 'string' ? req.params.name : '');
  const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
  // ⚠️ Имя берём у СОЕДИНЕНИЯ, а не из вызова: в `tools/call` его нет вовсе у старых клиентов.
  const who = session.label;
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
    // ⚠️ Говорим, ЧТО СДЕЛАТЬ, а не только что случилось. Прежний текст («карточка показана в
    // окне браузера») агент честно пересказывал человеку, а тот не знал, куда смотреть: карточка
    // висит в окне Oblako, которое в этот момент за спиной у той самой программы, из которой он
    // спрашивает. Живой случай — «не работает, какие вкладки у меня открыты».
    return ok(req.id, content(
      'The user has not connected this client to the browser yet. Ask the user to switch to the '
      + 'Oblako browser window: a card is waiting there in the top-left corner. They can also '
      + 'connect this client afterwards from the browser: Library → Agents → the call log. '
      + 'Once connected, call this tool again.',
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
    const outcome = await confirmWrite({ clientKey: key, clientLabel: who, tool: verdict.tool, args });
    // ⚠️ «Отказал» и «не ответил» — РАЗНЫЕ новости для агента, и путать их дорого. Пока оба
    // отвечали «The user refused», агент читал отказ и уходил в обход: «MCP-вызов вкладки не
    // проходит, открою напрямую» (живая жалоба 04.09.2026). А человек в этот момент просто не
    // подошёл к браузеру: карточка висит и ждёт одного нажатия.
    if (outcome === 'waiting') {
      note(false, 'waiting');
      return ok(req.id, content(
        'The user has not answered yet. A card is waiting in the Oblako browser window (top-left '
        + 'corner). Ask the user to switch to Oblako and confirm it, then call this tool again — '
        + 'the card stays open, and once confirmed the repeat goes through without asking. '
        + 'To stop being asked every time, the user can set this tool to "Можно" in the browser: '
        + 'Library → Agents → pick this program.',
        true,
      ));
    }
    if (outcome === 'refused') {
      note(false, 'refused');
      return ok(req.id, content('The user refused this action in the browser.', true));
    }
  }

  try {
    const result = await run(verdict.tool.name, args, deps);
    note(true);
    // ⚠️ Снимок уходит КАРТИНКОЙ протокола, а не JSON'ом с base64 внутри текста. Разница
    // принципиальная: в первом случае модель видит изображение, во втором получает полмегабайта
    // мусорных символов, за которые платит человек, и ничего на них не разглядит.
    const shot = asShot(result);
    if (shot) return ok(req.id, imageContent(shot));
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
    case 'tabs_list': {
      const tabs = listTabs();
      return { tabs, count: tabs.length };
    }
    case 'page_text': {
      const page = await activePageText();
      // Не «пусто», а причина словами — см. разбор в McpTools.ts.
      if (!page.ok) throw new Error(page.error ?? 'unavailable');
      return { title: page.title, url: page.url, text: page.text };
    }
    case 'page_read_url': {
      const batch = await readUrl(args);
      if (batch.error) throw new Error(batch.error);
      // ⚠️ Одиночный вызов отвечает ТАК ЖЕ, как отвечал раньше, — плоским объектом. Клиенты и
      // промпты, написанные под прежний ответ, никуда не делись, и заворачивать одну страницу в
      // список ради единообразия значило бы сломать их без всякой пользы.
      const only = batch.pages.length === 1 ? batch.pages[0] : null;
      if (only) {
        if (!only.ok) throw new Error(only.error ?? 'unavailable');
        return { title: only.title, url: only.url, text: only.text, cached: only.cached };
      }
      // ⚠️ Неудача ОДНОГО адреса не роняет пачку: в списке из восьми ссылок одна битая — обычное
      // дело, и терять из-за неё семь прочитанных страниц незачем. Ошибка едет рядом со своим
      // адресом, чтобы агент мог сказать человеку, что именно не открылось.
      return {
        pages: batch.pages,
        read: batch.pages.filter((p) => p.ok).length,
        failed: batch.pages.filter((p) => !p.ok).length,
        ...(batch.dropped > 0 ? { droppedAddresses: batch.dropped } : {}),
      };
    }
    case 'page_screenshot': {
      const shot = await screenshotActiveTab();
      if (!shot.ok) throw new Error(shot.error ?? 'unavailable');
      return shot;
    }
    case 'page_links': {
      const found = await activePageLinks();
      if (!found.ok) throw new Error(found.error ?? 'unavailable');
      return { url: found.url, title: found.title, links: found.links, count: found.links?.length ?? 0 };
    }
    case 'bookmarks_search': {
      const query = typeof args.query === 'string' ? args.query : '';
      if (!query.trim()) throw new Error('Argument "query" is required.');
      const hits = searchBookmarks(query, args.limit);
      return { query, hits, count: hits.length };
    }
    case 'history_search': {
      const query = typeof args.query === 'string' ? args.query : '';
      if (!query.trim()) throw new Error('Argument "query" is required.');
      const hits = searchHistory(deps.history(), query, args.limit);
      return { query, hits, count: hits.length };
    }
    case 'bookmarks_add':
      return addBookmarks(args);
    case 'tabs_open': {
      const res = openTab(args.url, args.background);
      if (!res.ok) throw new Error(res.note);
      return { opened: true, note: res.note };
    }
    case 'tabs_activate': {
      const res = activateTab(args.id);
      if (!res.ok) throw new Error(res.note);
      return { switched: true, note: res.note };
    }
    case 'tabs_close': {
      const res = closeTab(args.id);
      if (!res.ok) throw new Error(res.note);
      return { closed: true, note: res.note };
    }
    default:
      // Недостижимо: имя уже прошло decide(). Оставлено как явный отказ, а не молчание.
      throw new Error(`Tool ${name} has no implementation.`);
  }
}
