import type { WebContents } from 'electron';
import { readCompareProduct } from './ComparePage';

function openDetails(): boolean {
  if (!/(^|\.)wildberries\.ru$/.test(location.hostname) || !/^\/catalog\/\d+\/detail\.aspx/.test(location.pathname)) return false;
  if (document.querySelector('[data-testid="product_additional_information"]')) return false;
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('main button')).find(e =>
    e.textContent?.trim().toLocaleLowerCase() === 'о товаре' && !e.disabled);
  if (!button) return false;
  button.click(); return true;
}
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 400));
export async function revealWbDetails(wc: WebContents): Promise<boolean> {
  if (wc.isDestroyed() || !/^https:\/\/(?:www\.)?wildberries\.ru\/catalog\/\d+\/detail\.aspx/.test(wc.getURL())) return false;
  try {
    const opened = await wc.executeJavaScriptInIsolatedWorld(1005, [{ code: `(${openDetails.toString()})()` }]) as boolean;
    if (opened) await pause();
    return opened;
  } catch { return false; }
}
export async function readExpandedCompareProduct(wc: WebContents, tabId: string) {
  const url = wc.getURL(), opened = await revealWbDetails(wc);
  try {
    let product = await readCompareProduct(wc, tabId);
    for (let attempt = 0; opened && attempt < 2 && (product?.facts.length ?? 0) < 4; attempt++) { await pause(); product = await readCompareProduct(wc, tabId); }
    return product;
  } finally {
    // Только после явного «Сравнить», в скрытой исходной вкладке. Возвращаем закрытый нами drawer,
    // но не закрываем окно характеристик, которое человек открыл сам, и не нажимаем другие кнопки.
    if (opened && !wc.isDestroyed() && wc.getURL() === url) {
      await wc.executeJavaScriptInIsolatedWorld(1005, [{ code: `(()=>{const details=document.querySelector('[data-testid="product_additional_information"]');const dialog=details?.closest('[role="dialog"]');dialog?.querySelector('button[class*="closeButton"],button[aria-label="Закрыть"]')?.click();})()` }]).catch(() => {});
      // Drawer удаляется после анимации. Следующее чтение не должно застать его закрывающимся.
      await pause();
    }
  }
}
