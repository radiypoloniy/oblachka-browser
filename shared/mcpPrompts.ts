// Готовые сценарии, которые браузер предлагает внешнему агенту (MCP prompts).
//
// ⚠️ ЗАЧЕМ ЭТО ВООБЩЕ. Инструменты у нас есть, но человек про них не знает: он сидит в Claude
// Desktop или Cursor и должен сам догадаться, что браузер умеет читать его вкладки и обходить
// сайт за логином. Промпты решают ровно это — клиент показывает их списком (в Claude Desktop они
// видны как слэш-команды), и человеку не нужно угадывать формулировку.
//
// ⚠️ ЭТО НЕ АГЕНТНЫЙ ЦИКЛ. Мы не действуем за человека и не запускаем ничего сами: промпт — это
// ТЕКСТ, который клиент подставит в свой чат от имени человека. Решение и дальше принимает он, а
// каждый вызов инструмента проходит через те же разрешения, что и раньше.
//
// ⚠️ Тексты сценариев на АНГЛИЙСКОМ, как и описания инструментов: их читает модель, а не человек.
// Человек видит `title` и `description` — они по-русски, потому что показываются в его клиенте.
//
// ⚠️ Имена — через подчёркивание, как у инструментов: провайдерские API точку в имени не
// принимают (разбор — в shared/mcpPolicy.ts::findTool).
//
// Значимых импортов нет — модуль под проверкой, она гоняется голым node (правило CLAUDE.md).

export interface McpPromptArg {
  name: string;
  description: string;
  required?: boolean;
}

export interface McpPromptSpec {
  name: string;
  /** Что человек увидит в списке команд своего клиента. */
  title: string;
  description: string;
  arguments?: McpPromptArg[];
  /** Текст для модели. `fill` подставляет аргументы человека. */
  build: (args: Record<string, string>) => string;
}

/**
 * Каталог сценариев.
 *
 * ⚠️ ИХ МАЛО И БУДЕТ МАЛО. Список команд, в котором двадцать строк, человек не читает — он ищет в
 * нём глазами и не находит. Здесь только то, ради чего браузер отдают наружу: разобраться с тем,
 * что открыто; обойти сайт за логином; понять, что на экране; найти своё.
 *
 * ⚠️ Каждый сценарий НАЗЫВАЕТ ИНСТРУМЕНТЫ ПОИМЁННО. Без этого модель пойдёт своим web-поиском —
 * живой случай 04.09.2026: имена инструментов не совпали, и агент молча ушёл в обход, а человек
 * решил, что браузер не работает.
 */
export const MCP_PROMPTS: readonly McpPromptSpec[] = [
  {
    name: 'review_tabs',
    title: 'Разобрать открытые вкладки',
    description: 'Что у меня открыто, о чём это и что можно закрыть.',
    build: () =>
      'Call tabs_list to see what is open in the user\'s browser right now. For the tabs whose '
      + 'purpose is not obvious from the title, read them: pass their urls to page_read_url AS A '
      + 'LIST in one call, not one by one. Then tell the user, in the user\'s language: what they '
      + 'are working on judging by the tabs, which tabs are duplicates or leftovers they can '
      + 'close, and which deserve a bookmark. Do not close or open anything yourself — just say it.',
  },
  {
    name: 'walk_page',
    title: 'Собрать материал по ссылкам этой страницы',
    description: 'Обойти ссылки с текущей страницы и свести прочитанное вместе.',
    arguments: [
      { name: 'focus', description: 'Что именно искать в этих ссылках. Можно не указывать.' },
    ],
    build: (args) => {
      const focus = args.focus?.trim();
      return 'Call page_links on the tab the user is looking at, pick the links that matter'
        + (focus ? ` for: ${focus}` : '')
        + ', and read them with page_read_url — pass ALL of them as a list in ONE call, that is '
        + 'what the list argument is for. Then write a summary in the user\'s language, with a '
        + 'line per source and its address. Say plainly which links you skipped and why.';
    },
  },
  {
    name: 'explain_screen',
    title: 'Объясни, что на экране',
    description: 'Посмотреть на страницу глазами и объяснить, что происходит.',
    arguments: [
      { name: 'question', description: 'Что именно непонятно. Можно не указывать.' },
    ],
    build: (args) => {
      const q = args.question?.trim();
      return 'Call page_screenshot to SEE the tab the user is looking at, and page_text to read it. '
        + 'The screenshot matters here: the answer is often in the layout — a chart, a table, a '
        + 'form, an error banner — and plain text loses it. '
        + (q ? `Then answer this: ${q}` : 'Then explain what this page is and what the user can do on it.')
        + ' Answer in the user\'s language.';
    },
  },
  {
    name: 'find_saved',
    title: 'Найти у меня про…',
    description: 'Поискать в закладках и истории то, что человек уже видел.',
    arguments: [
      { name: 'topic', description: 'О чём была страница.', required: true },
    ],
    build: (args) => {
      const topic = args.topic?.trim() || 'the topic the user names';
      return `Look for what the user has already seen about: ${topic}. `
        + 'Call bookmarks_search FIRST — bookmarks are what they picked out on purpose — and then '
        + 'history_search for everything they merely visited. If a promising page needs its '
        + 'content checked, read the candidates with page_read_url in ONE call, passing the urls '
        + 'as a list. Answer in the user\'s language, and put bookmarks before history hits.';
    },
  },
];

export function findPrompt(name: string): McpPromptSpec | null {
  return MCP_PROMPTS.find((p) => p.name === name) ?? null;
}

/**
 * Аргументы от клиента — к строкам.
 *
 * ⚠️ Терпимо: клиент вправе прислать что угодно, включая ничего. Обязательный аргумент проверяет
 * вызывающий (McpDispatch), а здесь только приведение — падать на числе вместо строки незачем.
 */
export function promptArgs(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

/** Чего не хватает в вызове: имена обязательных аргументов, которых нет. */
export function missingArgs(spec: McpPromptSpec, args: Record<string, string>): string[] {
  return (spec.arguments ?? [])
    .filter((a) => a.required && !(args[a.name] ?? '').trim())
    .map((a) => a.name);
}
