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
  /**
   * Чтение, которое всё равно спрашивают.
   *
   * ⚠️ Заведено ради `page_read_url`: он ничего не меняет, но читает ЛЮБОЙ адрес КУКАМИ ЧЕЛОВЕКА
   * — почту, банк, внутреннюю вики. `page_text` отдаёт страницу, которую человек и так видит,
   * этот — любую, какую выбрала программа. Молча такое отдавать нельзя.
   */
  sensitive?: boolean;
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

/**
 * Белый список сайтов, на которые программе позволено смотреть.
 *
 * ⚠️ ОБЕЩАНИЕ СИЛЬНОЕ И ПРОСТОЕ: «этой программе — только docs и github». Агенту нельзя в почту,
 * даже если он попросит и человек машинально нажмёт «разрешить», — потому что спрашивать его
 * никто не будет: адрес вне списка просто не существует для этого клиента.
 *
 * ⚠️ ПУСТОЙ СПИСОК ОЗНАЧАЕТ «БЕЗ ОГРАНИЧЕНИЙ», а не «ничего нельзя». Иначе включение фильтра
 * задним числом отняло бы доступ у всех, кто уже подключён, и человек прочитал бы это как
 * поломку. Ограничение — осознанный шаг, а не состояние по умолчанию.
 *
 * ⚠️ Правило = ДОМЕН, и оно покрывает поддомены: `github.com` пропускает `api.github.com`, но не
 * `github.com.evil.ru` — сравнение идёт по МЕТКАМ имени, а не по подстроке. Подстрочное сравнение
 * здесь и есть классическая дыра: `endsWith('github.com')` пропускает `nastoyashiy-github.com`.
 *
 * ⚠️ Шаблонов вида `docs.*` НЕТ намеренно, хотя просить их будут. Такое правило совпадает с
 * `docs.любой-сайт.ru` — то есть выглядит ограничением, а работает как дыра. Нужен доступ к
 * нескольким доменам — они перечисляются.
 */
export function normalizeDomainRule(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  // Человек копирует адрес целиком — принимаем и его: «https://github.com/user» → «github.com».
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0] ?? '';
  s = s.split('?')[0] ?? '';
  s = s.split(':')[0] ?? '';       // порт правилу не нужен
  s = s.replace(/^\*\./, '');       // «*.github.com» — то же, что «github.com»
  if (!s || s.includes('*') || s.includes(' ')) return null;
  // Домен обязан состоять хотя бы из двух меток: «com» правилом быть не может.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}

/** Разрешён ли адрес белым списком. Пустой список — без ограничений. */
export function domainAllowed(url: string, rules: readonly string[]): boolean {
  if (rules.length === 0) return true;
  const host = hostOfUrl(url);
  if (!host) return false;
  return rules.some((rule) => host === rule || host.endsWith(`.${rule}`));
}

function hostOfUrl(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    return null;
  }
}

/** Сколько записей истории отдаём максимум и сколько по умолчанию. */
export const MCP_HISTORY_MAX = 50;
export const MCP_HISTORY_DEFAULT = 10;

/**
 * Каталог.
 *
 * ⚠️ ЗАПИСЬ ПОЯВИЛАСЬ ВМЕСТЕ С ПОДТВЕРЖДЕНИЕМ, а не раньше него, и порядок здесь не случайный:
 * инструмент, меняющий чужой браузер без спроса, не должен существовать даже один заход — иначе
 * «пока без карточки, потом добавим» доживает до релиза. Каждый вызов с mode: 'write' проходит
 * через вопрос человеку (см. needsConfirmation и electron/mcp/McpConfirm.ts).
 */
export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: 'tabs_list',
    mode: 'read',
    title: 'Открытые вкладки',
    description:
      'List the tabs open in the user\'s browser right now: title, URL and which one is active. '
      + 'Private tabs are never included.',
    input: { type: 'object', properties: {} },
  },
  {
    name: 'page_text',
    mode: 'read',
    title: 'Текст страницы',
    description:
      'Read the main text of the tab the user is looking at right now, without ads, menus or '
      + 'navigation. Takes no arguments: it always reads the ACTIVE tab. To read a DIFFERENT open '
      + 'tab, take its url from tabs_list and pass it to page_read_url — that reuses the already '
      + 'open tab instead of switching the user away from their work.',
    // ⚠️ Аргумента tabId здесь НЕТ намеренно, и это не забывчивость. Чтение произвольной вкладки
    // по номеру — это уже управление чужим браузером вслепую: агент выбирает, во что заглянуть, а
    // человек об этом не знает. Пока нет карточек подтверждения (следующий заход), наружу отдаётся
    // ровно то, что человек и так видит на экране.
    input: { type: 'object', properties: {} },
  },
  {
    name: 'page_screenshot',
    mode: 'read',
    title: 'Снимок страницы',
    description:
      'Screenshot the tab the user is looking at right now, as an image. Use it when the ANSWER '
      + 'IS IN THE LAYOUT, not the text: charts, dashboards, maps, tables, a form they are stuck '
      + 'on, or a page whose text extraction came back empty. It goes through their logged-in '
      + 'session — something your own web fetching cannot reach at all. No arguments: ACTIVE tab, '
      + 'visible area only.',
    // ⚠️ tabId нет по той же причине, что у page_text: это разглядывание браузера вслепую.
    input: { type: 'object', properties: {} },
  },
  {
    name: 'page_links',
    mode: 'read',
    title: 'Ссылки со страницы',
    description:
      'List the links on the tab the user is looking at right now: address plus anchor text. Use '
      + 'it to WALK a site they are logged into — take the links you need and pass them to '
      + 'page_read_url as a list, which reads them all in one call. No arguments: ACTIVE tab. '
      + 'Self-links and non-http addresses are left out.',
    input: { type: 'object', properties: {} },
  },
  {
    name: 'history_search',
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
  {
    name: 'bookmarks_search',
    mode: 'read',
    title: 'Поиск по закладкам',
    description:
      'Search the pages the user SAVED as bookmarks, by title and address. History is everything '
      + 'they happened to visit; bookmarks are what they picked on purpose — the better source '
      + 'for "that article I saved about X".',
    input: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for in titles and addresses.' },
        limit: { type: 'number', description: 'How many to return, 1..100. Default 20.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'page_read_url',
    mode: 'read',
    sensitive: true,
    title: 'Прочитать страницу по адресу',
    description:
      "Open a URL in the user's browser session and return its readable text. "
      + 'PREFER THIS over your own web fetching whenever the page needs the user to be logged in, '
      + 'blocks bots or datacenter IPs, or when the user asked you to use their browser: the '
      + "request goes through the user's profile, cookies, ad blocker and VPN. "
      + 'Pass SEVERAL addresses at once in `urls` when you need more than one page: they are read '
      + 'in parallel and cost the user one confirmation and one round trip instead of many. '
      + 'The user is asked to confirm the first time.',
    input: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Single address to read, http(s) only.' },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Several addresses to read in one call, http(s) only. Prefer this over repeated calls.',
        },
      },
    },
  },
  {
    name: 'bookmarks_add',
    mode: 'write',
    title: 'Сохранить в закладки',
    description:
      'Save pages to the user\'s bookmarks, optionally into a folder by name (created if missing). '
      + 'Pass SEVERAL at once in `items` — a list of {url, title} — when you found several things '
      + 'worth keeping: one confirmation instead of many. Use it to close the loop after a search: '
      + 'you found the right pages, put them where the user will find them later.',
    input: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Single address to save, http(s) only.' },
        title: { type: 'string', description: 'Name for that single bookmark.' },
        items: {
          type: 'array',
          description: 'Several bookmarks at once. Prefer this over repeated calls.',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              title: { type: 'string' },
            },
            required: ['url'],
          },
        },
        folder: { type: 'string', description: 'Folder name. Created if it does not exist yet.' },
      },
    },
  },
  {
    name: 'tabs_open',
    mode: 'write',
    title: 'Открыть вкладку',
    description:
      'Open a URL in a new tab of the browser. The user is asked to confirm every call; '
      + 'only http and https addresses are accepted.',
    input: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Address to open, http(s) only.' },
        background: { type: 'boolean', description: 'Open without switching to it. Default false.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'tabs_group',
    mode: 'write',
    title: 'Собрать вкладки в группу',
    description:
      'Put open tabs into a named group in the browser sidebar, creating the group if it does not '
      + 'exist. Take the ids from tabs_list and pass them in `tabIds`. This is how you TIDY UP for '
      + 'the user: after reviewing what is open, collect the tabs that belong together instead of '
      + 'listing them in chat. The group and its name are visible in the sidebar, and the user can '
      + 'disband it in one move.',
    input: {
      type: 'object',
      properties: {
        tabIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tab ids from tabs_list.',
        },
        name: { type: 'string', description: 'Group name the user will see in the sidebar.' },
      },
      required: ['tabIds', 'name'],
    },
  },
  {
    name: 'tabs_activate',
    mode: 'write',
    title: 'Переключить вкладку',
    description:
      'Switch the browser to an already open tab, by id from tabs_list. Use it before page_text '
      + 'to read a tab other than the active one. The user is asked to confirm.',
    input: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Tab id from tabs_list.' } },
      required: ['id'],
    },
  },
  {
    name: 'tabs_close',
    mode: 'write',
    title: 'Закрыть вкладку',
    description:
      'Close an open tab, by id from tabs_list. The user is asked to confirm; closing cannot be '
      + 'undone from here.',
    input: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Tab id from tabs_list.' } },
      required: ['id'],
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

/**
 * ⚠️ Разделитель имени приводим к ОДНОМУ виду прежде, чем сравнивать: `downloads.file` и
 * `downloads_file` — одно и то же имя, и закрытая категория обязана ловить оба. Иначе запрет
 * обходится сменой одного символа.
 */
export function isClosedName(name: string): boolean {
  const flat = name.toLowerCase().replace(/\./g, '_');
  const root = flat.split('_')[0] ?? '';
  return MCP_CLOSED_PREFIXES.some((p) => {
    const pf = p.toLowerCase().replace(/\./g, '_');
    return flat.startsWith(pf) || pf === root;
  });
}

/**
 * Имя инструмента в том виде, в каком его знает браузер.
 *
 * ⚠️ ИМЕНА ЖИВУТ ЧЕРЕЗ ПОДЧЁРКИВАНИЕ, А НЕ ЧЕРЕЗ ТОЧКУ, и это не стиль. Спецификация MCP точку
 * допускает, а провайдерские API — нет: и Anthropic, и OpenAI требуют от имени инструмента
 * `^[a-zA-Z0-9_-]{1,64}$`. Клиент, который ведёт разговор через такую модель, заменяет точку на
 * подчёркивание у себя и зовёт сервер уже изменённым именем — обратно не переводит никто.
 * Живой случай 04.09.2026: Cursor звал `tabs_open`, браузер отвечал «такого инструмента нет»,
 * человек видел в журнале три `unknown` подряд и ни одной карточки, а страницу Cursor открывал
 * своими средствами.
 *
 * ⚠️ Точечное написание принимаем как СИНОНИМ и будем принимать дальше: под ним выданы права в
 * уже существующих профилях (`mcp-clients.json`), и клиенты, запомнившие старый каталог, никуда
 * не делись. Отвечаем при этом всегда каноническим именем.
 */
export function findTool(name: string): McpTool | null {
  const exact = MCP_TOOLS.find((t) => t.name === name);
  if (exact) return exact;
  const dotted = name.replace(/\./g, '_');
  return MCP_TOOLS.find((t) => t.name === dotted) ?? null;
}

/** Каноническое имя для записи в права и журнал: `tabs.open` и `tabs_open` — один инструмент. */
export function canonicalToolName(name: string): string {
  return findTool(name)?.name ?? name;
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

/**
 * Как браузер поступает с этим инструментом у этой программы.
 *
 * ⚠️ ТРИ СОСТОЯНИЯ, А НЕ ДВА, и это починка по живой жалобе: «требуется подтверждение на каждый
 * чих». Вопрос на каждый вызов выглядит заботой о безопасности ровно один день; на второй человек
 * перестаёт читать карточку и жмёт «разрешить» рефлексом — то есть защита превращается в помеху и
 * при этом перестаёт защищать. Поэтому решение принимается ОДИН РАЗ на инструмент, а не на вызов.
 */
export type McpStance = 'ask' | 'allow' | 'deny';

/**
 * Что стоит по умолчанию, пока человек не решил иначе.
 *
 * ⚠️ Чтение — 'allow', и это не послабление: согласие на чтение человек уже дал, подключив
 * программу, и карточка подключения прямо перечисляет, что она сможет видеть. Спрашивать ещё раз
 * на каждый `tabs_list` значит спрашивать про то, о чём уже договорились.
 *
 * ⚠️ Запись — 'ask', ВКЛЮЧАЯ ту, что кажется безобидной. Открытая вкладка меняет то, что человек
 * видит на экране, а не только состояние программы.
 */
export function defaultStance(tool: McpTool): McpStance {
  if (tool.mode === 'write' || tool.sensitive) return 'ask';
  return 'allow';
}

export function stanceFor(tool: McpTool, saved: Readonly<Record<string, McpStance>>): McpStance {
  const s = saved[tool.name];
  return s === 'ask' || s === 'allow' || s === 'deny' ? s : defaultStance(tool);
}

/**
 * Можно ли запомнить ответ «разрешать всегда» для этого инструмента.
 *
 * ⚠️ У необратимого — НЕЛЬЗЯ. Закрытие вкладки отменить из браузера невозможно, и «всегда» здесь
 * означало бы, что человек однажды разрешил закрывать всё, что программа сочтёт нужным. Кнопки
 * «всегда» у такого вопроса просто нет — это надёжнее уговоров в подписи.
 */
export function canRemember(tool: McpTool): boolean {
  return !annotationsFor(tool).destructiveHint;
}

export type McpDecision =
  | { ok: true; tool: McpTool }
  // 'unknown' — такого инструмента нет; 'disabled' — человек выключил его тумблером;
  // 'not-connected' — клиент ещё не подтверждён человеком (карточка подключения).
  | { ok: false; reason: 'unknown' | 'disabled' | 'not-connected'; message: string };

export interface McpGrant {
  /** Подтвердил ли человек этого клиента вообще. */
  connected: boolean;
  /** Решения человека по инструментам. Пустая запись означает «как по умолчанию». */
  stances: Readonly<Record<string, McpStance>>;
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
  if (stanceFor(tool, grant.stances) === 'deny') {
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

// ── Заход 2: запись ──────────────────────────────────────────────────────────

/**
 * Сколько живёт разрешение, выданное на один вызов.
 *
 * ⚠️ Секунды, а не минуты, и это не перестраховка. Человек подтверждает КОНКРЕТНОЕ действие,
 * которое агент собирается сделать сейчас; окно в четверть часа означало бы, что он подписался
 * под всем, что тот придумает за это время.
 */
export const MCP_CONFIRM_TTL_MS = 60_000;

export interface McpApproval {
  tool: string;
  /** Слепок аргументов: подтверждение на один адрес не годится для другого. */
  digest: string;
  at: number;
}

/**
 * Годится ли выданное подтверждение для этого вызова.
 *
 * ⚠️ Проверяются ВСЕ ТРИ вещи разом — инструмент, аргументы и срок, — и ни одну нельзя убрать.
 * Без слепка аргументов подтверждённое «открыть habr.ru» открывает что угодно; без срока оно
 * живёт до перезапуска; без имени инструмента подтверждение на «открыть» закрывает вкладку.
 */
export function approvalFits(
  approval: McpApproval | null,
  call: { tool: string; digest: string },
  now: number,
): boolean {
  if (!approval) return false;
  if (approval.tool !== call.tool) return false;
  if (approval.digest !== call.digest) return false;
  return now - approval.at >= 0 && now - approval.at <= MCP_CONFIRM_TTL_MS;
}

/**
 * Как называть клиента в интерфейсе.
 *
 * ⚠️ Имя приходит от самого клиента (`clientInfo`) и НИЧЕМ не подтверждено. Мы приводим его к
 * безопасному виду и на этом останавливаемся: карточка говорит «программа представилась так»,
 * а не «это Claude Desktop». Врать про личность собеседника хуже, чем не знать её.
 */
export function clientLabel(raw: unknown): string {
  const s = typeof raw === 'string'
    ? raw.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
    : '';
  return s ? s.slice(0, 60) : 'неизвестный клиент';
}

/**
 * Ключ, под которым помним решение человека о клиенте.
 *
 * ⚠️ Ключ — это имя, и другого у нас нет: чужой процесс не предъявляет ничего проверяемого.
 * Отсюда прямое следствие, которое надо понимать: подтверждённым именем может назваться другая
 * программа на этой же машине. Барьер здесь не «кто ты», а «человек знает, что кто-то подключён»
 * — карточка, журнал и метка в окне; сам канал закрыт токеном (см. McpPipe.ts).
 */
export function clientKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Спрашивать ли человека перед этим вызовом.
 *
 * ⚠️ Отдельная функция, а не поле у инструмента: одно и то же действие у одной программы идёт
 * молча, а у другой — с вопросом, потому что решение принимал человек, а не мы.
 */
export function mustAsk(tool: McpTool, saved: Readonly<Record<string, McpStance>>): boolean {
  return stanceFor(tool, saved) === 'ask';
}
