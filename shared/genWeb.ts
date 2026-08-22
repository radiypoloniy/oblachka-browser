// Виджет по ссылке человека: разбор фида, путь в JSON и проверка адреса.
//
// ⚠️ Ссылку даёт ЧЕЛОВЕК, а не модель. Модель адресов не знает и, если её попросить, выдумает
// правдоподобный — ровно как выдумывала историю посещений. Её работа здесь начинается после
// того, как хост уже сходил по ссылке и показал, что там лежит.
//
// ⚠️ Тянет ХОСТ через net.fetch (сессия Electron), то есть запрос уважает VPN, kill switch и
// адблок. Из этого следует и то, чего здесь нет: ни скриптов, ни HTML со стороны сайта — только
// текст и числа. Класс дыр, ради которого жила песочница, сюда не возвращается.
//
// ⚠️ Значимых импортов здесь НЕТ и быть не может: проверка гоняет модуль голым node, а он
// требует расширения в пути импорта, которого tsc с эмитом не примет (то же правило, что у
// sessionTree.ts). Поэтому проверка адреса живёт в genSpec.ts, хотя по смыслу её место здесь:
// её зовёт validateGenSpec, а два модуля из shared/ ссылаться друг на друга не могут.

/** Сколько байт готовы прочитать по ссылке. Виджету хватает с большим запасом. */
export const GEN_WEB_MAX_BYTES = 512 * 1024;
/** Не чаще одного запроса в эти миллисекунды на один адрес. */
export const GEN_WEB_MIN_INTERVAL_MS = 5 * 60_000;
export const GEN_WEB_TIMEOUT_MS = 12_000;
export const GEN_FEED_MAX_ITEMS = 20;

export interface GenFeedItem {
  title: string;
  link?: string;
  /** Unix ms, если сайт её сообщил. */
  at?: number;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function tagText(block: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (!m) return '';
  return decodeEntities(m[1] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Заголовки из RSS или Atom.
 *
 * ⚠️ Свой разбор, а не зависимость: нужны ровно три поля из двух форматов, оба описаны
 * спецификацией и не меняются. Это и есть причина, по которой фид надёжнее страницы — там
 * структуру гарантирует стандарт, а не вёрстка, которую завтра перепишут.
 */
export function parseFeedItems(xml: string): GenFeedItem[] {
  if (typeof xml !== 'string' || !xml) return [];
  const out: GenFeedItem[] = [];
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  for (const block of blocks) {
    const title = tagText(block, 'title');
    if (!title) continue;
    // RSS кладёт ссылку текстом, Atom — атрибутом href.
    let link = tagText(block, 'link');
    if (!link) {
      const href = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(block);
      link = href ? decodeEntities(href[1] ?? '') : '';
    }
    const dateRaw = tagText(block, 'pubDate') || tagText(block, 'updated') || tagText(block, 'published');
    const at = dateRaw ? Date.parse(dateRaw) : Number.NaN;
    const item: GenFeedItem = { title: title.slice(0, 160) };
    if (link) item.link = link.slice(0, 500);
    if (Number.isFinite(at)) item.at = at;
    out.push(item);
    if (out.length >= GEN_FEED_MAX_ITEMS) break;
  }
  return out;
}

/** Похоже ли на фид — по содержимому, а не по расширению в адресе. */
export function looksLikeFeed(body: string): boolean {
  if (typeof body !== 'string') return false;
  const head = body.slice(0, 2000);
  return /<rss\b|<feed\b|<rdf:RDF\b|<channel\b/i.test(head);
}

/**
 * Значение по пути вида `rates.USD.value` или `data[0].price`.
 *
 * ⚠️ Путь выбирает МОДЕЛЬ, но по НАСТОЯЩЕМУ образцу ответа — хост ходит по ссылке до того, как
 * спросить. Без образца она сочиняла бы ключи, и виджет собирался бы вслепую (это же правило
 * спасло виджеты-списки: данные важнее догадки).
 */
export function resolveJsonPath(root: unknown, path: string): unknown {
  if (typeof path !== 'string' || !path.trim()) return undefined;
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((x) => x.trim())
    .filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(part);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return undefined;
      cur = cur[i];
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Значение, годное для показа одной строкой. Объекты и массивы виджету показывать нечем. */
export function displayableValue(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Хвост из плавающей точки на плитке читается как мусор: 82.91999999999999.
    return String(Math.round(v * 100) / 100);
  }
  if (typeof v === 'string') {
    const s = v.replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, 40) : null;
  }
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  return null;
}

/**
 * Урезанный образец ответа для промпта.
 *
 * ⚠️ Целиком слать нельзя: ответы API бывают на сотни килобайт, а окно контекста у локальной
 * модели одно на всё приложение. Режем и вглубь, и вширь — модели нужны КЛЮЧИ, а не данные.
 */
export function jsonSample(value: unknown, depth = 0): unknown {
  if (depth >= 4) return '…';
  if (Array.isArray(value)) return value.slice(0, 2).map((x) => jsonSample(x, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 12)) out[k] = jsonSample(v, depth + 1);
    return out;
  }
  if (typeof value === 'string') return value.slice(0, 40);
  return value;
}

/** Пути-кандидаты до чисел и коротких строк — подсказка модели и запасной выбор. */
export function jsonLeafPaths(value: unknown, prefix = '', depth = 0, out: string[] = []): string[] {
  if (out.length >= 40 || depth >= 4) return out;
  if (Array.isArray(value)) {
    if (value.length > 0) jsonLeafPaths(value[0], `${prefix}[0]`, depth + 1, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value).slice(0, 12)) {
      jsonLeafPaths(v, prefix ? `${prefix}.${k}` : k, depth + 1, out);
      if (out.length >= 40) break;
    }
    return out;
  }
  if (prefix && displayableValue(value) !== null) out.push(prefix);
  return out;
}
