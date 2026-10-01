// Значения таблицы всегда приходят со страницы. Модель может лишь объединить подписи строк.
export interface CompareFact { id: number; label: string; value: string; quote: string }
export interface CompareProduct {
  tabId: string; url: string; title: string; category: string; capturedAt: number;
  facts: CompareFact[]; method: 'structured' | 'page'; note: string;
}
export interface CompareRow { label: string; cells: (CompareFact | null)[] }
export interface CompareState {
  enabled: boolean; candidates: CompareProduct[]; products: CompareProduct[]; rows: CompareRow[];
  phase: 'idle' | 'reading' | 'ready' | 'error'; note: string; connectionId: string;
  models: { id: string; label: string; local: boolean }[]; via: string | null;
}
export interface CompareApi {
  tabCompareState(): Promise<CompareState>;
  onTabCompareState(cb: (state: CompareState) => void): () => void;
  setTabCompareEnabled(enabled: boolean): Promise<void>;
  showTabCompareOffer(anchor: { x: number; y: number; width: number; height: number; automatic?: boolean }): Promise<void>;
  closeTabCompareOffer(): Promise<void>;
  startTabCompare(tabIds: string[], connectionId: string): Promise<void>;
  refreshTabCompare(): Promise<void>;
  tabCompareSource(tabId: string, factId: number): Promise<boolean>;
}
export interface CompareCollected {
  title: string; heading: string; category: string; blocks: string[];
  pairs: [string, string][]; prices: string[]; blocked: boolean; productUrl: boolean;
}
const record = (x: unknown): Record<string, unknown> | null => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null;
const text = (x: unknown): string => typeof x === 'string' || typeof x === 'number' ? String(x).replace(/\s+/g, ' ').trim() : '';
const cleanLabel = (s: string): string => {
  if (/^Цена (по разметке|на странице)$/.test(s)) return 'price';
  const key = s.toLocaleLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
  return ['озу', 'оперативнаяпамять', 'объемоперативнойпамяти', 'ram', 'memoryram'].includes(key) ? 'ram' : key;
};

export function productForComparison(raw: CompareCollected, tabId: string, url: string, now = Date.now()): CompareProduct | null {
  if (raw.blocked || !raw.heading && !raw.blocks.length) return null;
  let product: Record<string, unknown> | null = null;
  // Только корневой Product/@graph: товары из рекомендаций и выдачи не становятся текущим.
  for (const block of raw.blocks.slice(0, 5)) {
    if (block.length > 100_000) continue;
    try {
      const parsed: unknown = JSON.parse(block), root = record(parsed);
      const nodes: unknown[] = Array.isArray(parsed) ? parsed : root && Array.isArray(root['@graph']) ? root['@graph'] : [parsed];
      product = nodes.map(record).find(o => o && (Array.isArray(o['@type']) ? o['@type'] : [o['@type']]).some(t => t === 'Product')) ?? null;
      if (product) break;
    } catch { /* Битая SEO-разметка не мешает прочитать видимую карточку. */ }
  }
  if (!product && !raw.productUrl) return null;
  const facts: CompareFact[] = [];
  const add = (label: string, value: string, quote = value) => {
    const l = text(label).slice(0, 80), v = text(value).slice(0, 220);
    if (!l || !v || facts.length >= 36 || facts.some(f => cleanLabel(f.label) === cleanLabel(l) && f.value === v)) return;
    facts.push({ id: facts.length + 1, label: l, value: v, quote: text(quote).slice(0, 250) });
  };
  if (product) {
    const brand = record(product.brand);
    add('Бренд', text(brand?.name ?? product.brand));
    add('Модель', text(product.model));
    const rating = record(product.aggregateRating);
    add('Оценка покупателей', text(rating?.ratingValue));
    add('Количество оценок', text(rating?.ratingCount ?? rating?.reviewCount));
    const properties = Array.isArray(product.additionalProperty) ? product.additionalProperty : [product.additionalProperty];
    for (const p of properties.slice(0, 30)) { const o = record(p); if (o) add(text(o.name), [text(o.value), text(o.unitText)].filter(Boolean).join(' ')); }
    // Видимая цена приоритетна: SEO-разметка может не знать скидку кошелька и выбранный вариант.
    if (!raw.prices.length) {
      const offer = record(Array.isArray(product.offers) ? product.offers[0] : product.offers);
      if (offer) {
        const price = text(offer.price ?? offer.lowPrice);
        if (price) add('Цена по разметке', `${offer.lowPrice !== undefined && offer.price === undefined ? 'от ' : ''}${price} ${text(offer.priceCurrency)}`);
      }
    }
  }
  raw.prices.slice(0, 3).forEach((v, i) => add(i ? `Условия цены ${i + 1}` : 'Цена на странице', v));
  const visibleKeys = new Set<string>();
  raw.pairs.slice(0, 60).forEach(([k, v]) => {
    const key = cleanLabel(k), existing = facts.find(f => cleanLabel(f.label) === key);
    // Выбранный вариант на странице может отличаться от SEO-разметки. Видимые данные важнее.
    if (existing && text(v) && !visibleKeys.has(key)) {
      existing.value = text(v).slice(0, 220); existing.quote = text(`${k} ${v}`).slice(0, 250);
    } else add(k, v, `${k} ${v}`);
    visibleKeys.add(key);
  });
  const title = text(raw.heading || product?.name).slice(0, 180);
  if (!title || !facts.length) return null;
  return { tabId, url, title, facts, category: text(product?.category || raw.category).slice(0, 160), capturedAt: now,
    method: product ? 'structured' : 'page', note: facts.length < 4 ? 'Прочитана только часть данных. Откройте характеристики на сайте и обновите сравнение.' : '' };
}

export function comparisonRows(products: CompareProduct[]): CompareRow[] {
  const labels = new Map<string, string>();
  for (const p of products) for (const f of p.facts) if (!labels.has(cleanLabel(f.label))) labels.set(cleanLabel(f.label), f.label);
  return [...labels].slice(0, 60).map(([key, label]) => ({ label: key === 'price' ? 'Цена и условия' : key === 'ram' ? 'Оперативная память' : label, cells: products.map(p => p.facts.find(f => cleanLabel(f.label) === key) ?? null) }));
}
export function relatedCompareProducts(active: CompareProduct, candidates: CompareProduct[]): CompareProduct[] {
  const family = (p: CompareProduct) => {
    const content = `${p.category} ${p.title}`.toLocaleLowerCase();
    const kinds = [/ноутбук|laptop|notebook/, /смартфон|smartphone|iphone/, /монитор|monitor/, /телевизор|television|\btv\b/,
      /наушник|headphone|earbud/, /планшет|tablet|ipad/, /кроссовк|sneaker/, /ботинк|boot/, /куртк|jacket/,
      /пылесос|vacuum/, /холодильник|refrigerator/, /стиральн|washing machine/, /клавиатур|keyboard/, /мышь|мышк|\bmouse\b/, /вентилятор|\bfan\b/];
    const kind = kinds.findIndex(re => re.test(content));
    return kind >= 0 ? `kind:${kind}` : cleanLabel(p.category) || cleanLabel(p.title.split(/\s+/)[0] ?? '');
  };
  const basis = family(active);
  return [active, ...candidates.filter(p => p.tabId !== active.tabId && p.url !== active.url && basis && family(p) === basis)].slice(0, 5);
}

export function mergeComparisonLabels(value: unknown, products: CompareProduct[], base: CompareRow[]): CompareRow[] {
  const output = record(value);
  if (!Array.isArray(output?.rows)) throw new Error('Модель не вернула строки сравнения');
  const used = new Set<string>(), merged: CompareRow[] = [];
  for (const raw of output.rows.slice(0, 30)) {
    const row = record(raw);
    if (!row || !Array.isArray(row.refs) || row.refs.length !== products.length || !text(row.label)) continue;
    const cells = row.refs.map((ref, i) => Number.isInteger(ref) ? products[i].facts.find(f => f.id === ref) ?? null : null);
    // Объединение имеет смысл только между несколькими товарами; цены не нормализуем моделью.
    if (cells.filter(Boolean).length < 2 || cells.some((f, i) => f && (/цен|price|стоим/i.test(f.label) || used.has(`${i}:${f.id}`)))) continue;
    cells.forEach((f, i) => { if (f) used.add(`${i}:${f.id}`); });
    merged.push({ label: text(row.label).slice(0, 80), cells });
  }
  if (!merged.length) return base;
  const rest = base.map(row => ({ ...row, cells: row.cells.map((f, i) => f && !used.has(`${i}:${f.id}`) ? f : null) })).filter(r => r.cells.some(Boolean));
  return [...rest.filter(r => /цен|price|стоим/i.test(r.label)), ...merged, ...rest.filter(r => !/цен|price|стоим/i.test(r.label))];
}
