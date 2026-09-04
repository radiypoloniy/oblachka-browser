// Наша запись в конфиге чужого MCP-клиента: как она выглядит и как попадает в чужой файл.
//
// ⚠️ Зачем это вообще. Подключение выглядело как команда на три сотни знаков, которую человек
// копирует в терминал. Для Claude Code это родной путь (у него свой CLI), для остальных — нет:
// Claude Desktop, Cursor и VS Code читают JSON-файл, и «подключить» там означает дописать в него
// один объект. Мы знаем путь к этому файлу и знаем, что дописать, — значит человек не должен
// делать это руками.
//
// ⚠️ ЧУЖОЙ ФАЙЛ — ГЛАВНЫЙ РИСК ЭТОЙ ФИЧИ, и он не в нашем блоке, а во всём остальном, что в файле
// уже лежит. Там чужие серверы, которые человек настраивал руками; потерять их — значит сломать
// ему рабочий инструмент молча. Отсюда два правила: мы меняем РОВНО СВОЙ ключ и не трогаем ничего
// больше, а при малейшем сомнении в разборе отказываемся писать вовсе.
//
// ⚠️ JSON С КОММЕНТАРИЯМИ (JSONC) — не выдумка: Cursor и VS Code его допускают, а человек,
// правивший конфиг руками, комментарии там оставляет. Строгий JSON.parse на таком файле падает —
// и это ЕДИНСТВЕННЫЙ правильный исход: переписав такой файл своим сериализованным JSON, мы молча
// съели бы и комментарии, и порядок ключей. Отказ с готовым блоком для ручной вставки честнее.
//
// Значимых импортов нет — модуль под проверкой (scripts/mcp-config-check.mjs), а она гоняется
// голым node (см. правило про shared/ в CLAUDE.md).

/** Под каким ключом клиент держит список серверов. Различие ровно в этом слове. */
export type McpSectionKey = 'mcpServers' | 'servers';

/** Имя нашей записи в чужом конфиге. Одно на все клиенты, чтобы человек узнавал её глазами. */
export const MCP_SERVER_NAME = 'oblako';

/**
 * Наша запись целиком.
 *
 * ⚠️ `type: 'stdio'` пишем всегда, хотя половина клиентов его не требует. У VS Code он
 * обязателен, у остальных — необязателен и безвреден; одна форма записи на всех дешевле трёх
 * почти одинаковых, каждая из которых сломается по-своему.
 */
export interface McpServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Клиент, которого мы умеем настроить сами. */
export interface McpClientSpec {
  id: string;
  label: string;
  section: McpSectionKey;
  /** Как назвать файл человеку — путь к нему знает только main (он платформенный). */
  fileLabel: string;
}

/**
 * ⚠️ Claude Code в списке НЕТ намеренно. Его конфиг — живое состояние на десятки килобайт с
 * привязкой серверов к проектам, и правильный способ добавить туда сервер один: его собственный
 * `claude mcp add`. Дописывать такой файл со стороны — лезть в чужую структуру, которую мы не
 * контролируем и которая меняется между версиями.
 */
export const MCP_CLIENT_SPECS: readonly McpClientSpec[] = [
  { id: 'claude-desktop', label: 'Claude Desktop', section: 'mcpServers', fileLabel: 'claude_desktop_config.json' },
  { id: 'cursor', label: 'Cursor', section: 'mcpServers', fileLabel: 'mcp.json' },
  { id: 'vscode', label: 'VS Code', section: 'servers', fileLabel: 'mcp.json' },
];

export function specById(id: string): McpClientSpec | null {
  return MCP_CLIENT_SPECS.find((s) => s.id === id) ?? null;
}

/** Что случится с файлом, если человек нажмёт «Настроить». */
export type McpMergePlan =
  | 'create'   // файла нет — создадим целиком
  | 'add'      // файл есть, нашей записи в нём нет — допишем
  | 'replace'  // наша запись есть, но отличается (переехал профиль или обновилось приложение)
  | 'same';    // всё уже прописано ровно так — писать нечего

export type McpMergeProblem =
  | 'not-json'          // строгим JSON не разбирается: JSONC, обрывок, чужой формат
  | 'not-object'        // корень не объект (массив, число, строка)
  | 'section-not-object'; // секция серверов занята чем-то другим

export type McpMergeResult =
  | { ok: true; plan: McpMergePlan; text: string }
  | { ok: false; problem: McpMergeProblem };

/**
 * Вписать нашу запись в текст чужого конфига.
 *
 * ⚠️ Возвращает ТЕКСТ, а не пишет файл: запись на диск — дело main, а решение «что получится» надо
 * уметь показать человеку до того, как что-то произошло. Карточка предпросмотра и сама запись
 * обязаны считать один и тот же результат, иначе показанное разойдётся с записанным.
 *
 * ⚠️ `null` в text означает «файла нет», а пустая строка — «файл есть, но пустой». Для нас это
 * один случай (создаём структуру с нуля), и различать их здесь не нужно; различает их main, когда
 * решает, делать ли резервную копию.
 */
export function mergeMcpServer(
  text: string | null,
  section: McpSectionKey,
  entry: McpServerEntry,
  name: string = MCP_SERVER_NAME,
): McpMergeResult {
  const raw = (text ?? '').trim();
  if (raw === '') {
    return { ok: true, plan: 'create', text: render({ [section]: { [name]: entry } }) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, problem: 'not-json' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problem: 'not-object' };
  }

  const root = parsed as Record<string, unknown>;
  const current = root[section];
  if (current !== undefined && (typeof current !== 'object' || current === null || Array.isArray(current))) {
    return { ok: false, problem: 'section-not-object' };
  }

  const servers = { ...(current as Record<string, unknown> | undefined) };
  const before = servers[name];
  // ⚠️ Сравниваем СЕРИАЛИЗОВАННЫМ видом, а не по ссылке: «уже настроено» должно означать «в файле
  // ровно то, что мы записали бы сейчас». Иначе переехавший профиль (у пути к каналу другое имя)
  // молча считался бы настроенным, а браузер для клиента остался бы недоступен.
  const plan: McpMergePlan = before === undefined
    ? 'add'
    : JSON.stringify(before) === JSON.stringify(entry) ? 'same' : 'replace';

  servers[name] = entry;
  return { ok: true, plan, text: render({ ...root, [section]: servers }) };
}

/**
 * Только наш блок — то, что человек вставит руками, если файл править нельзя.
 *
 * ⚠️ Показываем ИМЕННО ЭТОТ фрагмент, а не весь получившийся файл: в чужом конфиге лежат чужие
 * серверы, и показывать их человеку обратно в нашем окне незачем.
 */
export function serverBlockText(section: McpSectionKey, entry: McpServerEntry, name: string = MCP_SERVER_NAME): string {
  return render({ [section]: { [name]: entry } });
}

/**
 * ⚠️ Два пробела и перевод строки в конце — то, как эти файлы пишут все причастные инструменты.
 * Своё форматирование здесь означало бы, что после нашей записи чужой diff показывает весь файл
 * целиком, даже если мы изменили один ключ.
 */
function render(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
