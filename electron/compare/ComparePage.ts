import type { WebContents } from 'electron';
import { productForComparison, type CompareCollected, type CompareProduct } from '../../shared/tabCompare';

// Эта функция исполняется в изолированном мире страницы и не вызывает её JS/API.
export function collectComparePage(): CompareCollected {
  const url = new URL(location.href);
  const wb = /(^|\.)wildberries\.ru$/.test(url.hostname) && /^\/catalog\/\d+\/detail\.aspx/.test(url.pathname);
  const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden], [aria-hidden="true"]');
  const read = (e: Element | null) => e && visible(e) ? (e.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const headingNode = Array.from(document.querySelectorAll(wb ? 'main h1, main h2' : 'h1')).find(e => visible(e) && (!wb || read(e).length >= 8 && document.title.includes(read(e)))) ?? null;
  const heading = read(headingNode);
  const main = headingNode?.closest('main, [role="main"], [itemtype*="Product"], .product-page') ?? document.querySelector('main, [role="main"]');
  const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 5).map(e => e.textContent || '').filter(t => t.length <= 100_000);
  const pairs: [string, string][] = [], prices: string[] = [];
  const productUrl = wb || /(^|\.)ozon\.ru$/.test(url.hostname) && /^\/product\//.test(url.pathname)
    || !!document.querySelector('[itemtype*="schema.org/Product"]');
  // На статьях/почте не обходим таблицы и не читаем весь текст: это частая фоновая проверка.
  const structuredProduct = blocks.some(text => {
    try {
      const root = JSON.parse(text);
      const nodes = Array.isArray(root) ? root : [root, ...(Array.isArray(root?.['@graph']) ? root['@graph'] : [])];
      return nodes.some(node => node && [node['@type']].flat().includes('Product'));
    } catch { return false; }
  });
  if (!productUrl && !structuredProduct) return { title: '', heading: '', category: '', blocks: [], pairs, prices, blocked: false, productUrl: false };
  const details = wb ? document.querySelector('[data-testid="product_additional_information"]') : null;
  if (main) {
    const rows = [...Array.from(main.querySelectorAll('tr')), ...Array.from(details?.querySelectorAll('tr') ?? [])];
    for (const row of rows.slice(0, 100)) {
      if (!visible(row)) continue;
      const cells = row.querySelectorAll('th,td');
      if (cells.length === 2) pairs.push([read(cells[0]).slice(0, 80), read(cells[1]).slice(0, 220)]);
    }
    for (const dt of Array.from(main.querySelectorAll('dt')).slice(0, 60)) {
      if (dt.nextElementSibling?.tagName === 'DD') pairs.push([read(dt).slice(0, 80), read(dt.nextElementSibling).slice(0, 220)]);
    }
    // WB хранит цену в видимой карточке. Контекст сохраняем целиком: кошелёк/рассрочка — разные цены.
    const priceNodes = wb ? main.querySelectorAll('.j-product-header [class*="priceBlock"], .price-block__final-price') : main.querySelectorAll('[itemprop="price"], [data-testid="price"]');
    for (const el of Array.from(priceNodes).slice(0, 12)) {
      if (!visible(el) || el.closest('s, del, [class*="recommend"], [class*="similar"]')) continue;
      const parent = read(el.parentElement), own = read(el);
      const price = parent && parent.length <= 180 ? parent : own;
      if (/нет в\s*наличии/i.test(price)) { pairs.push(['Наличие', 'Нет в наличии']); continue; }
      if (price && /\d/.test(price) && !prices.includes(price)) prices.push(price.slice(0, 220));
    }
  }
  const breadcrumb = Array.from(document.querySelectorAll('[aria-label*="breadcrumb" i] a, [class*="breadcrumb"] a')).slice(0, 15).map(read).filter(Boolean);
  return { title: document.title.slice(0, 200), heading, blocks, pairs, prices, category: breadcrumb.at(-1) || '', productUrl,
    blocked: !heading && /captcha|капч|подтвердите.*человек|доступ ограничен/i.test((main?.textContent || document.body?.innerText || '').slice(0, 1500)) };
}
export async function readCompareProduct(wc: WebContents, tabId: string): Promise<CompareProduct | null> {
  if (wc.isDestroyed() || !/^https?:/.test(wc.getURL())) return null;
  const url = wc.getURL();
  let timeout: NodeJS.Timeout | undefined;
  try {
    const raw = await Promise.race([
      wc.executeJavaScriptInIsolatedWorld(1005, [{ code: `(${collectComparePage.toString()})()` }]) as Promise<CompareCollected>,
      new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 3500); }),
    ]);
    return raw && !wc.isDestroyed() && wc.getURL() === url ? productForComparison(raw, tabId, url) : null;
  } catch { return null; } finally { if (timeout) clearTimeout(timeout); }
}
