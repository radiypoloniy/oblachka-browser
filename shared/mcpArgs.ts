// Что именно просит чужая программа: разбор аргументов и тексты, которые видит человек.
//
// ⚠️ ОТДЕЛЬНО ОТ ПОЛИТИКИ НАМЕРЕННО, и это не «файл распух». Разные вопросы: mcpPolicy решает,
// КОМУ И ЧТО позволено (замок), а здесь — ЧТО ИМЕННО в этом вызове и как назвать это человеку.
// Первый меняется, когда меняются права; второй — когда у инструмента появляется новый аргумент.
// Пока они жили вместе, каждый новый инструмент упирал файл политики в порог структуры, и цена
// была не в строках, а в том, что ⚠️-разборы про доступ приходилось ужимать ради описаний схем.
//
// ⚠️ Значимых импортов нет — модуль под проверкой, она гоняется голым node (правило CLAUDE.md).
// Тип инструмента приходит типовым импортом: он стирается и прогону не мешает.

import type { McpTool } from './mcpPolicy';

/**
 * Адрес, который мы готовы открыть или прочитать по просьбе чужой программы.
 *
 * ⚠️ БЕЛЫЙ СПИСОК СХЕМ, а не чёрный, — тот же вывод, что и у гостевой навигации после аудита
 * 21.08 (shared/guestNavigation.ts). Чёрный список обходится записью, о которой мы не подумали:
 * `javascript:` с пробелом внутри, `data:text/html`, протокол-относительный `//host`, ведущие
 * управляющие символы. Здесь пропускаются только http и https — и ничего больше.
 *
 * ⚠️ `file://` закрыт НАМЕРЕННО, хотя человек и сам открывает такие ссылки. Открыть локальный
 * файл по просьбе чужой программы — это чтение диска чужими руками, а не навигация.
 */
export function safeOpenUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Управляющие символы и пробелы по краям: с ними перевод строки перед `javascript:` даёт
  // строку, которая глазом читается как обычный адрес.
  const s = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!s || s.length > 2000) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    // Хост обязателен: `http:///path` разбирается, но никуда не ведёт.
    return u.hostname ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Потолок текста страницы в одном ответе. Разбор — docs/architecture-mcp.md, «Про скорость». */
export const MCP_TEXT_LIMIT = 12_000;

/**
 * ⚠️ БЮДЖЕТ ОБЩИЙ, а не «лимит × число страниц»: иначе восемь адресов дают сотню тысяч знаков за
 * вызов, за которые платит человек. Но не мельче минимума — страница в пару абзацев бесполезна.
 */
export const MCP_BATCH_MAX = 8;
const MCP_BATCH_BUDGET = 24_000;
const MCP_BATCH_MIN_PER_PAGE = 3_000;

/** Знаков на страницу, когда их читают пачкой. */
export function batchTextLimit(count: number): number {
  if (count <= 1) return MCP_TEXT_LIMIT;
  return Math.max(MCP_BATCH_MIN_PER_PAGE, Math.floor(MCP_BATCH_BUDGET / count));
}

/**
 * ⚠️ Обрезаем ВСЛУХ — с пометкой в конце. Молча укороченная статья выглядит для агента как
 * статья, которая так и кончается: он ответит уверенно и неправильно, а человек не узнает.
 */
export function clampPageText(text: string): string {
  if (text.length <= MCP_TEXT_LIMIT) return text;
  return `${text.slice(0, MCP_TEXT_LIMIT)}\n\n[… обрезано: страница длиннее ${MCP_TEXT_LIMIT} знаков]`;
}

export type BatchTargets = { ok: true; urls: string[]; dropped: number } | { ok: false; error: string };

/**
 * ⚠️ Принимаем ОБА ВИДА аргумента — `url` строкой и `urls` списком: разные клиенты присылают
 * разное, и отказ «не то поле» человек прочитает как «браузер не работает».
 * ⚠️ Негодные адреса ОТСЕИВАЕМ ПОШТУЧНО и считаем вслух: одна битая ссылка из восьми — обычное
 * дело, и терять из-за неё семь прочитанных незачем.
 */
export function readUrlTargets(args: Record<string, unknown>): BatchTargets {
  const raw: unknown[] = Array.isArray(args.urls)
    ? [...args.urls]
    : args.urls !== undefined ? [args.urls] : [];
  if (args.url !== undefined) raw.unshift(args.url);

  const seen = new Set<string>();
  const urls: string[] = [];
  let dropped = 0;
  for (const item of raw) {
    const safe = safeOpenUrl(item);
    if (!safe) { dropped++; continue; }
    // Дубликаты в списке — не повод читать одно и то же дважды.
    if (seen.has(safe)) continue;
    seen.add(safe);
    if (urls.length < MCP_BATCH_MAX) urls.push(safe);
    else dropped++;
  }
  if (urls.length === 0) return { ok: false, error: 'Only http(s) addresses can be read.' };
  return { ok: true, urls, dropped };
}

/** ⚠️ Потолок: на ленте новостей ссылок под тысячу — это тысячи токенов ради пары нужных строк. */
export const MCP_LINKS_MAX = 100;
const LINK_TEXT_MAX = 120; // длиннее — уже не подпись, а абзац из карточки товара

export interface McpLink { url: string; text: string }

/**
 * ⚠️ ЧИСТИМ ЗДЕСЬ, А НЕ В СТРАНИЦЕ: скрипт в чужом DOM обязан быть простым — он бегает по любому
 * сайту мира. ⚠️ Ссылка на саму себя выбрасывается: своих якорей у страницы десятки.
 */
export function tidyLinks(raw: unknown, pageUrl: string): McpLink[] {
  if (!Array.isArray(raw)) return [];
  const here = stripHash(pageUrl);
  const seen = new Set<string>();
  const out: McpLink[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as { url?: unknown; text?: unknown };
    const url = safeOpenUrl(o.url);
    if (!url) continue;
    const flat = stripHash(url);
    if (flat === here || seen.has(flat)) continue;
    seen.add(flat);
    const text = typeof o.text === 'string' ? o.text.replace(/\s+/g, ' ').trim().slice(0, LINK_TEXT_MAX) : '';
    out.push({ url, text });
    if (out.length >= MCP_LINKS_MAX) break;
  }
  return out;
}

function stripHash(url: string): string {
  const cut = url.indexOf('#');
  return cut === -1 ? url : url.slice(0, cut);
}

/** ⚠️ Кадр УМЕНЬШАЕМ и жмём JPEG: снимок окна в PNG — мегабайты, которые лягут в контекст модели. */
export const MCP_SHOT_WIDTH = 1152;
export const MCP_SHOT_QUALITY = 70;

/** Сколько закладок кладём за один вызов. Больше — это уже не «сохрани найденное», а свалка. */
export const MCP_BOOKMARKS_MAX = 20;
/** Название папки длиннее этого в сайдбар не влезает и читается обрывком. */
const FOLDER_NAME_MAX = 60;

export interface McpBookmarkInput { url: string; title: string }
export type BookmarkTargets =
  | { ok: true; items: McpBookmarkInput[]; folder: string | null; dropped: number }
  | { ok: false; error: string };

/**
 * Что программа просит сохранить.
 *
 * ⚠️ Принимаем и одну закладку (`url` + `title`), и список (`items`): агент, нашедший восемь
 * товаров, обязан класть их ОДНИМ вызовом — иначе человек отвечает на восемь карточек подряд и
 * на третьей перестаёт читать, что в них написано.
 *
 * ⚠️ Название берём как прислали, но чистим пробелы и режем: заголовок карточки товара бывает в
 * двести знаков, и в сайдбаре от него видно первые три слова.
 *
 * ⚠️ Пустое название — не ошибка: адрес важнее подписи, и браузер сам подставит заголовок
 * страницы, когда её откроют.
 */
export function bookmarkTargets(args: Record<string, unknown>): BookmarkTargets {
  const raw: unknown[] = Array.isArray(args.items) ? [...args.items] : [];
  if (args.url !== undefined) raw.unshift({ url: args.url, title: args.title });

  const seen = new Set<string>();
  const items: McpBookmarkInput[] = [];
  let dropped = 0;
  for (const entry of raw) {
    const o = typeof entry === 'object' && entry !== null
      ? entry as { url?: unknown; title?: unknown }
      : { url: entry, title: undefined };
    const url = safeOpenUrl(o.url);
    if (!url) { dropped++; continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    if (items.length >= MCP_BOOKMARKS_MAX) { dropped++; continue; }
    items.push({ url, title: cleanTitle(o.title) });
  }
  if (items.length === 0) return { ok: false, error: 'Only http(s) addresses can be bookmarked.' };
  return { ok: true, items, folder: cleanFolder(args.folder), dropped };
}

function cleanTitle(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

/**
 * ⚠️ Имя папки, а не её номер: у агента нет и не будет доступа к внутренним id сайдбара. Пустое
 * имя означает «в корень» — это не отказ, а обычный случай «просто сохрани».
 */
function cleanFolder(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX);
  return name || null;
}

/**
 * Заголовок карточки — ВОПРОС, а не название действия.
 *
 * ⚠️ Тот же закон, что у карточки разрешений сайта: «Открытие вкладки» — это ярлык раздела
 * настроек, а здесь у человека спрашивают. Названием карточка читается как сообщение, которое
 * можно не заметить, — а их и не замечают.
 */
export function confirmTitle(tool: McpTool): string {
  switch (tool.name) {
    case 'page_read_url': return 'Прочитать страницу?';
    case 'tabs_open': return 'Открыть вкладку?';
    case 'tabs_activate': return 'Переключить вкладку?';
    case 'tabs_close': return 'Закрыть вкладку?';
    case 'bookmarks_add': return 'Сохранить в закладки?';
    default: return `Разрешить «${tool.title}»?`;
  }
}

/**
 * Предмет вопроса: то, на что человек смотрит, принимая решение.
 *
 * ⚠️ Адрес отдаётся ЦЕЛИКОМ и проверенным (safeOpenUrl), а не как его прислали: человек должен
 * увидеть ровно то, что откроется. Строка собирается здесь, а не в карточке, потому что вопрос
 * обязан называть настоящий аргумент.
 */
export function confirmSubject(tool: McpTool, args: Record<string, unknown>): string {
  switch (tool.name) {
    case 'page_read_url': {
      const targets = readUrlTargets(args);
      if (!targets.ok) return 'Программа не назвала пригодный адрес.';
      // ⚠️ Показываем ВСЕ адреса, а не «5 страниц»: разница между списком документации и списком,
      // куда затесалась почта, видна только в самих адресах. ⚠️ Про куки сказано прямо — человек
      // решает не «дать почитать сайт», а «дать почитать сайт от моего имени».
      const many = targets.urls.length > 1;
      return `${targets.urls.join('\n')}\n\n${many ? 'Страницы будут открыты' : 'Страница будет открыта'} вашим профилем — с вашими логинами.`;
    }
    case 'tabs_open': {
      // ⚠️ Пустого предмета не бывает: карточка без адреса — вопрос ни о чём, и человек ответит
      // «да» просто потому, что читать нечего. Негодный адрес показываем как есть и словами.
      const safe = safeOpenUrl(args.url);
      if (safe) return safe;
      const raw = String(args.url ?? '').trim();
      return raw ? `Адрес не годится: ${raw.slice(0, 200)}` : 'Программа не назвала адрес.';
    }
    case 'bookmarks_add': {
      const targets = bookmarkTargets(args);
      if (!targets.ok) return 'Программа не назвала пригодный адрес.';
      // ⚠️ Перечисляем ЧТО ИМЕННО и КУДА: «сохранить 8 закладок» — это вопрос, на который нельзя
      // ответить осмысленно, а список названий с адресами читается за пару секунд.
      const list = targets.items
        .map((i) => (i.title ? `${i.title}\n${i.url}` : i.url))
        .join('\n\n');
      const where = targets.folder ? `Папка «${targets.folder}»` : 'В корень закладок';
      return `${where}\n\n${list}`;
    }
    case 'tabs_activate':
      return 'Браузер переключится на другую открытую вкладку.';
    case 'tabs_close':
      return 'Вкладка закроется. Отменить это из браузера нельзя.';
    default:
      return tool.description;
  }
}
