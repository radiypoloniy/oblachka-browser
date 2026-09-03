// Что браузер отдаёт наружу внешнему агенту и на каких условиях — фаза 3.
//
// ⚠️ ЭТО ЗАМОК, А НЕ ОПИСЬ. Здесь решается, какой чужой агент что может сделать с ЖИВЫМ профилем
// человека: с его вкладками, историей и логинами. Ошибка в этом файле — не «функция работает
// хуже», а посторонний, читающий чужую почту. Поэтому:
//   • список инструментов ЗАКРЫТЫЙ и объявлен здесь целиком; фасад в electron/mcp/ ничего своего
//     добавить не может — он спрашивает у этого модуля;
//   • закрытые категории (пароли, куки, автозаполнение, приватные вкладки) — не выключенный
//     тумблер, а ОТСУТСТВИЕ инструмента: тумблер можно включить по ошибке или уговорами, а того,
//     чего нет, не позовёшь;
//   • всё, что здесь решается, проверяется машиной (scripts/mcp-policy-check.mjs).
//
// ⚠️ РЕЖИМ ИНСТРУМЕНТА ДЕРЖИМ МЫ, а не подсказки протокола. У MCP есть аннотации readOnlyHint /
// destructiveHint, но это именно hint — заявление сервера о себе для чужого интерфейса, а не
// ограничение. Клиент вправе их игнорировать. Значит запрет обязан жить на нашей стороне, а
// аннотации мы отдаём вежливостью — чтобы чужой клиент показал человеку правильную карточку.
//
// ⚠️ Значимых импортов нет — модуль под проверкой, она гоняется голым node (правило CLAUDE.md).

/** Ревизия протокола, на которой мы говорим. */
export const MCP_VERSION = '2026-07-28';

/**
 * Ревизии, которые мы понимаем.
 *
 * ⚠️ Старые здесь не для полноты, а потому что НА НИХ ГОВОРЯТ ЖИВЫЕ КЛИЕНТЫ. Ревизия 2026-07-28
 * убрала рукопожатие `initialize` и сессии, но выпущенные Claude Desktop, Cursor и прочие ещё
 * ходят по-старому. Сервер, понимающий только новое, для человека выглядит просто сломанным.
 */
export const MCP_SUPPORTED_VERSIONS: readonly string[] = [
  '2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26',
];

/**
 * Эпоха протокола, по которой отвечаем.
 *
 * ⚠️ Различие ровно одно и оно жёсткое: до 2026-07-28 разговор начинался с `initialize` и
 * держал сессию, после — каждый запрос сам несёт версию в `_meta`. Смешивать эпохи в одном
 * ответе нельзя, поэтому решение принимается один раз и здесь.
 */
export type McpEra = 'modern' | 'legacy';

export function eraOf(version: string): McpEra {
  return version >= '2026-07-28' ? 'modern' : 'legacy';
}

/** Что инструмент делает с браузером. Третьего значения нет и не будет. */
export type McpMode = 'read' | 'write';

export interface McpTool {
  name: string;
  mode: McpMode;
  /** Короткая строка для чужого интерфейса. Пишется для ЧЕЛОВЕКА, который увидит её в карточке. */
  title: string;
  description: string;
  /** JSON Schema аргументов. Пустой объект — аргументов нет. */
  input: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Потолок текста страницы в одном ответе. */
export const MCP_TEXT_LIMIT = 40_000;
/** Сколько записей истории отдаём максимум и сколько по умолчанию. */
export const MCP_HISTORY_MAX = 50;
export const MCP_HISTORY_DEFAULT = 10;

/**
 * Каталог. ⚠️ ПЕРВЫЙ ЗАХОД — ТОЛЬКО ЧТЕНИЕ, ни одного инструмента с mode: 'write'.
 *
 * Запись (открыть вкладку, увести страницу по адресу) приходит следующим заходом ВМЕСТЕ с
 * карточками подтверждения через MRTR: инструмент, меняющий чужой браузер без спроса, не должен
 * существовать даже один заход — иначе «временно без подтверждения» доживёт до релиза.
 */
export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: 'tabs.list',
    mode: 'read',
    title: 'Открытые вкладки',
    description:
      'List the tabs open in the user\'s browser right now: title, URL and which one is active. '
      + 'Private tabs are never included.',
    input: { type: 'object', properties: {} },
  },
  {
    name: 'page.text',
    mode: 'read',
    title: 'Текст страницы',
    description:
      'Read the main text of the tab the user is looking at right now, without ads, menus or '
      + 'navigation. Takes no arguments: it always reads the ACTIVE tab. To read another one, ask '
      + 'the user to switch to it.',
    // ⚠️ Аргумента tabId здесь НЕТ намеренно, и это не забывчивость. Чтение произвольной вкладки
    // по номеру — это уже управление чужим браузером вслепую: агент выбирает, во что заглянуть, а
    // человек об этом не знает. Пока нет карточек подтверждения (следующий заход), наружу отдаётся
    // ровно то, что человек и так видит на экране.
    input: { type: 'object', properties: {} },
  },
  {
    name: 'history.search',
    mode: 'read',
    title: 'Поиск по истории',
    description:
      'Search the pages the user has visited, by page title and address. Answers questions like '
      + '"what was that article about Bergamot I read in June".',
    input: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for in titles and page text.' },
        limit: { type: 'number', description: `How many results, 1..${MCP_HISTORY_MAX}.` },
      },
      required: ['query'],
    },
  },
];

/**
 * Чего снаружи нет вовсе.
 *
 * ⚠️ Список нужен не для проверки входящих запросов — незнакомое имя и так не найдётся в
 * каталоге. Он нужен как ЗАМОК НА БУДУЩЕЕ: проверка следит, чтобы ни один инструмент с таким
 * корнем не появился в каталоге, даже если однажды покажется, что «ну это же просто чтение».
 * Пароль и кука — не данные страницы, а ключи от чужих аккаунтов.
 */
export const MCP_CLOSED_PREFIXES: readonly string[] = [
  'passwords', 'vault', 'cookies', 'autofill', 'forms', 'session', 'downloads.file', 'private',
];

export function isClosedName(name: string): boolean {
  const root = name.toLowerCase().split('.')[0] ?? '';
  return MCP_CLOSED_PREFIXES.some((p) => name.toLowerCase().startsWith(p) || p === root);
}

export function findTool(name: string): McpTool | null {
  return MCP_TOOLS.find((t) => t.name === name) ?? null;
}

/**
 * Аннотации протокола для чужого клиента.
 *
 * ⚠️ `openWorldHint` у нас ВЕЗДЕ true, и это не копипаст: любой наш инструмент смотрит в живой
 * веб через профиль человека, то есть его ответ зависит от внешнего мира и повторный вызов даст
 * другое. Соврать здесь «закрытый мир» значило бы подсказать чужому клиенту кэшировать ответ.
 */
export function annotationsFor(tool: McpTool): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
} {
  const read = tool.mode === 'read';
  return {
    readOnlyHint: read,
    // Разрушительным считаем только то, что нельзя вернуть назад. Открыть вкладку — добавление.
    destructiveHint: !read && /close|remove|delete|clear/.test(tool.name),
    idempotentHint: read,
    openWorldHint: true,
  };
}

/** Требует ли вызов подтверждения человеком (MRTR) прямо сейчас. */
export function needsConfirmation(tool: McpTool): boolean {
  return tool.mode === 'write';
}

export type McpDecision =
  | { ok: true; tool: McpTool }
  // 'unknown' — такого инструмента нет; 'disabled' — человек выключил его тумблером;
  // 'not-connected' — клиент ещё не подтверждён человеком (карточка подключения).
  | { ok: false; reason: 'unknown' | 'disabled' | 'not-connected'; message: string };

export interface McpGrant {
  /** Подтвердил ли человек этого клиента вообще. */
  connected: boolean;
  /** Выключенные вручную инструменты. Отсутствие имени здесь означает «разрешён». */
  disabled: readonly string[];
}

/**
 * Можно ли выполнить вызов.
 *
 * ⚠️ Порядок проверок обратный привычному — сперва подключение, потом существование инструмента.
 * Иначе неподтверждённый клиент перебором имён узнавал бы, что у нас вообще есть: отказ обязан
 * выглядеть одинаково для всех имён, пока человек не сказал «да» самому клиенту.
 */
export function decide(name: string, grant: McpGrant): McpDecision {
  if (!grant.connected) {
    return {
      ok: false,
      reason: 'not-connected',
      message: 'Oblako has not been connected to this client yet. Confirm the connection in the browser window.',
    };
  }
  const tool = findTool(name);
  if (!tool) {
    return { ok: false, reason: 'unknown', message: `Unknown tool: ${name}` };
  }
  if (grant.disabled.includes(tool.name)) {
    return {
      ok: false,
      reason: 'disabled',
      message: `The user turned "${tool.title}" off for this client.`,
    };
  }
  return { ok: true, tool };
}

/**
 * Какие вкладки видны снаружи.
 *
 * ⚠️ ПРИВАТНАЯ ВКЛАДКА НЕ ВИДНА ДАЖЕ СПИСКОМ. Не «текст не отдаём, а заголовок можно»: человек
 * открыл её именно для того, чтобы её не было видно, и адрес с заголовком — это ровно то, что он
 * прятал. По той же причине фильтр живёт ЗДЕСЬ, в одном месте, а не в каждом инструменте.
 *
 * ⚠️ Схемы браузера (`oblako-chrome://`, `about:`) наружу тоже не идут: это наш интерфейс, а не
 * страницы человека, и внешнему агенту в нём делать нечего.
 */
export function visibleTabs<T extends { url: string; private?: boolean; incognito?: boolean }>(
  tabs: readonly T[],
): T[] {
  return tabs.filter((t) => {
    // ⚠️ Оба написания признака, и это не перестраховка: внутри вкладка называется `incognito`
    // (shared/ipc/core.ts), а снаружи привычнее `private`. Фильтр, знающий одно имя, при
    // переименовании поля начнёт молча пропускать приватные вкладки наружу — то есть сломается
    // ровно в ту сторону, в которую ломаться нельзя.
    if (t.private || t.incognito) return false;
    const u = t.url.trim().toLowerCase();
    if (!u) return false;
    return u.startsWith('http://') || u.startsWith('https://') || u.startsWith('file://');
  });
}

/** Зажим числа записей истории: чужой клиент просит сколько хочет, отдаём сколько можно. */
export function clampHistoryLimit(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : MCP_HISTORY_DEFAULT;
  return Math.min(MCP_HISTORY_MAX, Math.max(1, n));
}

/**
 * Обрезка длинного текста страницы.
 *
 * ⚠️ Обрезаем ВСЛУХ — с пометкой в конце. Молча укороченная статья выглядит для агента как
 * статья, которая так и кончается: он ответит уверенно и неправильно, а человек не узнает.
 */
export function clampPageText(text: string): string {
  if (text.length <= MCP_TEXT_LIMIT) return text;
  return `${text.slice(0, MCP_TEXT_LIMIT)}\n\n[… обрезано: страница длиннее ${MCP_TEXT_LIMIT} знаков]`;
}

export type VersionPick =
  | { ok: true; version: string; era: McpEra }
  | { ok: false; supported: readonly string[] };

/**
 * На какой версии отвечаем.
 *
 * ⚠️ Версии НЕТ — это законный случай, а не ошибка: до 2025-06-18 её не передавали вовсе, и по
 * спеке такой запрос трактуется как 2025-03-26. Отвечать отказом значило бы отрезать старых
 * клиентов, ради которых список поддержки и заведён.
 */
export function pickVersion(requested: unknown): VersionPick {
  if (requested === undefined || requested === null || requested === '') {
    return { ok: true, version: '2025-03-26', era: 'legacy' };
  }
  if (typeof requested !== 'string' || !MCP_SUPPORTED_VERSIONS.includes(requested)) {
    return { ok: false, supported: MCP_SUPPORTED_VERSIONS };
  }
  return { ok: true, version: requested, era: eraOf(requested) };
}
