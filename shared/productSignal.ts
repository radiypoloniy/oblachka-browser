// Разбор товара из разметки schema.org (отслеживание товаров, срез 1).
//
// ⚠️ Живёт ОТДЕЛЬНО и БЕЗ импортов — под прогон обычным node (npm run product-signal-check).
// Это слой, который решает, ЧТО мы покажем человеку как цену и что запишем в историю: ошибка
// здесь — неверная цена в графике и ложное «подешевело». Проверять такое надо прогоном.
//
// ⚠️ Строим ТОЛЬКО на schema.org — по итогам замера (см. PRICE-TRACKING.md): это не «три
// магазина», а вся розница, отдающая стандартную разметку ради SEO. Адаптеров под конкретные
// сайты нет и не планируется.

export interface ProductSignal {
  name: string;
  /** Цена числом. Валюта отдельно — сравнивать цены в разных валютах нельзя. */
  price: number;
  currency: string;
  /** Из schema.org, без префикса: InStock / OutOfStock / PreOrder / LimitedAvailability / ''. */
  availability: string;
  /** Опознавательные знаки товара — по ним склеиваются предложения с разных сайтов. */
  sku: string;
  gtin: string;
  /** Артикул ПРОИЗВОДИТЕЛЯ. ⚠️ Не путать с sku: тот у каждого магазина свой и для склейки не годится. */
  mpn: string;
  brand: string;
}

/** Максимум разметки, которую разбираем: у крупных магазинов JSON-LD бывает огромным. */
const MAX_BLOCK_CHARS = 300_000;

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Часть магазинов кладёт { "@value": "…" } или { "name": "…" } вместо строки.
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['@value'] === 'string') return o['@value'].trim();
    if (typeof o.name === 'string') return o.name.trim();
  }
  return '';
}

/**
 * Цена числом.
 *
 * ⚠️ Форматов в живой разметке три: «5121», «5121.00» и «5 121,00». Разделитель разрядов надо
 * убрать, а десятичную запятую превратить в точку — перепутав их, получим 512100 вместо 5121.
 * Отрицательное и ноль ценой не считаем: это заглушка «цена по запросу», а не цена.
 */
export function parsePrice(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0;
  let s = str(raw);
  if (!s) return 0;
  s = s.replace(/[\s ]/g, '');
  // Запятая как десятичный разделитель — только если после неё ровно одна-две цифры до конца.
  s = s.replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
  const n = Number.parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Наличие без префикса схемы: `https://schema.org/InStock` → `InStock`. */
export function parseAvailability(raw: unknown): string {
  const s = str(raw);
  if (!s) return '';
  const tail = s.split(/[/#]/).pop() ?? '';
  return /^[A-Za-z]+$/.test(tail) ? tail : '';
}

function typeOf(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

/** Оффер бывает объектом, массивом и AggregateOffer с диапазоном — берём разумную одну цену. */
function priceFromOffers(offers: unknown): { price: number; currency: string; availability: string } {
  const list = Array.isArray(offers) ? offers : [offers];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    // ⚠️ У AggregateOffer своей `price` нет — там диапазон. Берём НИЖНЮЮ границу: человек
    // сравнивает «от скольки», и именно она меняется при распродаже.
    const price = parsePrice(o.price ?? o.lowPrice);
    if (!price) continue;
    return {
      price,
      currency: str(o.priceCurrency) || 'RUB',
      availability: parseAvailability(o.availability),
    };
  }
  return { price: 0, currency: '', availability: '' };
}

/**
 * Блоки JSON-LD из СЫРОГО HTML — для самого дешёвого пути проверки: обычный запрос без запуска
 * страницы. По замеру (PRICE-TRACKING.md) так читается Яндекс.Маркет; остальным нужна вью.
 *
 * ⚠️ Регуляркой, а не разбором HTML: нам нужен ровно один тип тега, а тащить парсер разметки в
 * общий модуль без зависимостей нельзя. Ошибка тут дёшева — блок просто не разберётся как JSON.
 */
export function jsonLdBlocksFromHtml(html: string): string[] {
  const out: string[] = [];
  if (!html) return out;
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const body = (m[1] ?? '').trim();
    if (body && body.length <= MAX_BLOCK_CHARS) out.push(body);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Достаёт товар из блоков JSON-LD (строки как есть со страницы).
 *
 * null — товара нет. Это НОРМАЛЬНЫЙ и самый частый ответ: на обычной странице, на выдаче поиска и
 * в магазине без разметки его быть и не должно. Ложное «нашёлся» дороже пропуска: индикатор
 * загорится там, где отслеживать нечего.
 */
export function productFromJsonLd(blocks: string[]): ProductSignal | null {
  for (const block of blocks) {
    if (!block || block.length > MAX_BLOCK_CHARS) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(block); } catch { continue; }

    // Обход в ширину: Product бывает и в @graph, и внутри itemListElement.
    const queue: unknown[] = [parsed];
    let guard = 0;
    while (queue.length && guard++ < 5000) {
      const node = queue.shift();
      if (Array.isArray(node)) { queue.push(...node); continue; }
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;
      for (const v of Object.values(obj)) if (v && typeof v === 'object') queue.push(v);

      if (!typeOf(obj).some((t) => /product/i.test(t))) continue;
      const { price, currency, availability } = priceFromOffers(obj.offers);
      // ⚠️ Без цены товар нам не товар: отслеживать нечего, и индикатор зажигать не за что.
      if (!price) continue;
      const name = str(obj.name);
      if (!name) continue;
      return {
        name: name.slice(0, 200),
        price,
        currency,
        availability,
        sku: str(obj.sku).slice(0, 64),
        mpn: (str(obj.mpn) || str(obj.productID)).slice(0, 64),
        gtin: (str(obj.gtin13) || str(obj.gtin) || str(obj.gtin12) || str(obj.ean)).slice(0, 64),
        brand: str(obj.brand).slice(0, 80),
      };
    }
  }
  return null;
}
