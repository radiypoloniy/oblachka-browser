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

/**
 * Метки, по которым один и тот же товар выглядит десятью разными адресами.
 *
 * ⚠️ ЖИВОЙ СЛУЧАЙ: в выдаче Ozon каждая карточка несёт рекламные метки (`advert`, `avtc`, `avte`),
 * и они МЕНЯЮТСЯ ОТ ПОКАЗА К ПОКАЗУ. Без чистки один товар приезжает в списке ссылок несколько раз,
 * дедуп его не схлопывает, кеш промахивается — то есть человек платит за повторное чтение одной и
 * той же страницы. То же у маркетплейсов с `from`, `keywords`, `sh` и у всех с `utm_*`.
 *
 * ⚠️ СПИСОК ЗАКРЫТЫЙ, а не «всё, что похоже на мусор». Параметр — часть адреса, и лишняя чистка
 * ломает ровно то, ради чего он там стоит: `?page=2`, `?variant=`, `?id=` — разные страницы.
 * Сомневаешься — не трогай: цена ошибки здесь «прочитали не ту страницу».
 */
const TRACKING_PARAMS: readonly string[] = [
  'advert', 'advert_id', 'avtc', 'avte', 'avts', 'asb', 'asb2', 'sh', 'from', 'keywords',
  'gclid', 'yclid', 'ysclid', 'fbclid', '_openstat', 'wbracket', 'oos_search', 'miniapp',
];

/**
 * Адрес без меток слежения — ДЛЯ СРАВНЕНИЯ, а не для чтения.
 *
 * ⚠️ Читаем всегда по ОРИГИНАЛЬНОМУ адресу: часть сайтов без своих параметров отдаёт другую
 * страницу или редирект. Нормализованный вид нужен только чтобы понять «это одно и то же» —
 * в дедупе списка и в ключе кеша.
 */
export function trackingFreeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      const low = key.toLowerCase();
      if (low.startsWith('utm_') || TRACKING_PARAMS.includes(low)) u.searchParams.delete(key);
    }
    // Хвостовой «?» после чистки — тот же адрес, но строкой другой; убираем, иначе дедуп промахнётся.
    u.hash = '';
    return u.searchParams.toString() ? u.toString() : `${u.origin}${u.pathname}`;
  } catch {
    return url;
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
    // ⚠️ Дубликаты ищем по адресу БЕЗ МЕТОК СЛЕЖЕНИЯ, а читаем оригинал: в выдаче маркетплейса
    // один товар приходит несколькими ссылками, отличающимися только рекламной меткой.
    const key = trackingFreeUrl(safe);
    if (seen.has(key)) continue;
    seen.add(key);
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
  const here = trackingFreeUrl(pageUrl);
  const seen = new Set<string>();
  const out: McpLink[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as { url?: unknown; text?: unknown };
    const url = safeOpenUrl(o.url);
    if (!url) continue;
    // ⚠️ Сравниваем без меток слежения: у Ozon одна и та же карточка приходит в выдаче несколько
    // раз с разными `advert`/`avtc`, и без этого список ссылок наполовину состоит из повторов.
    const flat = trackingFreeUrl(url);
    if (flat === here || seen.has(flat)) continue;
    seen.add(flat);
    const text = typeof o.text === 'string' ? o.text.replace(/\s+/g, ' ').trim().slice(0, LINK_TEXT_MAX) : '';
    out.push({ url, text });
    if (out.length >= MCP_LINKS_MAX) break;
  }
  return out;
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
 * Сколько вкладок открываем за один вызов.
 *
 * ⚠️ Потолок про ПАМЯТЬ, а не про удобство: каждая вкладка — живой рендерер, и на маркетплейсе это
 * сотни мегабайт, а не наши 28 МБ из замера на пустых страницах. Десять — цена, которую человек
 * платит осознанно (он видит список в карточке); сотня по недосмотру модели положила бы машину.
 */
export const MCP_OPEN_MAX = 10;

export type OpenTargets =
  | { ok: true; urls: string[]; dropped: number }
  | { ok: false; error: string };

/**
 * Какие адреса просят открыть.
 *
 * ⚠️ Тот же разбор, что у чтения (`url` строкой или `urls` списком) и по той же причине: клиенты
 * присылают разное, а отказ «не то поле» человек читает как «браузер не работает».
 *
 * ⚠️ Дубликаты схлопываются БЕЗ МЕТОК СЛЕЖЕНИЯ: в выдаче маркетплейса один товар приходит
 * несколькими ссылками, и открыть его тремя вкладками — не помощь, а мусор в сайдбаре.
 */
export function openTargets(args: Record<string, unknown>): OpenTargets {
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
    const key = trackingFreeUrl(safe);
    if (seen.has(key)) continue;
    seen.add(key);
    if (urls.length < MCP_OPEN_MAX) urls.push(safe);
    else dropped++;
  }
  if (urls.length === 0) return { ok: false, error: 'Only http(s) addresses can be opened.' };
  return { ok: true, urls, dropped };
}

/** Сколько вкладок кладём в группу за вызов. Больше — это уже не «разложи», а «перетасуй всё». */
export const MCP_GROUP_MAX = 30;

export type GroupTargets =
  | { ok: true; tabIds: string[]; name: string }
  | { ok: false; error: string };

/**
 * Что программа просит сгруппировать.
 *
 * ⚠️ Имя группы ОБЯЗАТЕЛЬНО. Безымянная группа в сайдбаре называется «Новая группа», и человек,
 * вернувшийся к ней через час, видит ровно ноль информации о том, что там лежит и кто это сложил.
 *
 * ⚠️ Идентификаторы вкладок приходят от нас же (tabs_list) и проверяются при выполнении: здесь
 * только форма. Чужой id ничего не даст — вкладку с ним не найдут, а приватные и внутренние в
 * список вообще не попадают (см. visibleTabs в mcpPolicy).
 */
export function groupTargets(args: Record<string, unknown>): GroupTargets {
  const raw: unknown[] = Array.isArray(args.tabIds) ? [...args.tabIds] : [];
  if (typeof args.tabId === 'string') raw.unshift(args.tabId);

  const seen = new Set<string>();
  const tabIds: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (tabIds.length < MCP_GROUP_MAX) tabIds.push(id);
  }
  if (tabIds.length === 0) return { ok: false, error: 'Pass tab ids from tabs_list in `tabIds`.' };

  const name = typeof args.name === 'string' ? args.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  if (!name) return { ok: false, error: 'Argument "name" is required: a group without a name tells the user nothing.' };
  return { ok: true, tabIds, name };
}

/** Сколько товаров ставим на отслеживание за вызов: тот же порядок, что у открытия вкладок. */
export const MCP_TRACK_MAX = 10;

/**
 * Какие страницы просят поставить на отслеживание.
 *
 * ⚠️ Разбор тот же, что у открытия вкладок, и это не копипаста ради симметрии: агент получает эти
 * адреса из выдачи магазина, то есть с теми же рекламными метками и теми же дублями. Схлопывать их
 * надо здесь — иначе один товар встанет на отслеживание трижды и человек трижды получит
 * уведомление о падении одной и той же цены.
 */
export function trackTargets(args: Record<string, unknown>): OpenTargets {
  const picked = openTargets(args);
  if (!picked.ok) return { ok: false, error: 'Only http(s) product pages can be tracked.' };
  return { ok: true, urls: picked.urls.slice(0, MCP_TRACK_MAX), dropped: picked.dropped };
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
    case 'tracking_add': return 'Следить за ценой?';
    case 'tabs_group': return 'Собрать вкладки в группу?';
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
      const targets = openTargets(args);
      if (!targets.ok) {
        const raw = String(args.url ?? '').trim();
        return raw ? `Адрес не годится: ${raw.slice(0, 200)}` : 'Программа не назвала адрес.';
      }
      // ⚠️ Перечисляем ВСЕ адреса: «открыть 8 вкладок» — вопрос, на который нельзя ответить
      // осмысленно, а список читается за пару секунд. Про фон говорим прямо: человек должен
      // понимать, что работу ему не перебьют.
      if (targets.urls.length === 1) return targets.urls[0] as string;
      return `${targets.urls.join('\n')}\n\n${targets.urls.length} вкладок откроются в фоне — текущая останется на экране.`;
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
    case 'tabs_group': {
      const g = groupTargets(args);
      if (!g.ok) return 'Программа не назвала ни одной вкладки или имя группы.';
      // ⚠️ Число вкладок, а не их список: id человеку ничего не говорят, а заголовки сюда не
      // доедут — карточка собирается из аргументов вызова, без обращения к браузеру.
      const many = g.tabIds.length;
      return `Группа «${g.name}»

В неё уйдёт ${many} ${many === 1 ? 'вкладка' : 'вкладок'}. Разобрать группу можно в сайдбаре.`;
    }
    case 'tracking_add': {
      const t = trackTargets(args);
      if (!t.ok) return 'Программа не назвала пригодный адрес.';
      // ⚠️ Про «после того, как программа уйдёт» сказано ПРЯМО: человек соглашается не на разовое
      // действие, а на то, что браузер будет ходить на эти страницы сам — неделями. Это другое
      // решение, и молчать о нём нельзя.
      return `${t.urls.join('\n')}\n\nБраузер будет проверять цену сам и сообщит об изменении — `
        + 'в том числе когда эта программа давно закончит работу. Снять можно в разделе '
        + '«Отслеживание».';
    }
    case 'tabs_activate':
      return 'Браузер переключится на другую открытую вкладку.';
    case 'tabs_close':
      return 'Вкладка закроется. Отменить это из браузера нельзя.';
    default:
      return tool.description;
  }
}
