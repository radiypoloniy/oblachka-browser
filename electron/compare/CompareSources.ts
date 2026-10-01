import type { CompareProduct } from '../../shared/tabCompare';
import type { WindowContext } from '../WindowRegistry';
import { getActiveProfile } from '../ProfileStore';

// Чтение сохранённого разбора не открывает сайты. Вкладки восстанавливаем только
// после явного перехода к источнику или запроса обновить данные.
export async function ensureCompareSource(ctx: WindowContext, product: CompareProduct): Promise<string> {
  const profile = getActiveProfile().id;
  const tab = ctx.tabs.snapshot().find(t => t.kind === 'page' && !t.incognito && t.url === product.url && t.id === product.tabId)
    ?? ctx.tabs.snapshot().find(t => t.kind === 'page' && !t.incognito && t.url === product.url);
  const id = tab?.id ?? ctx.tabs.createTab(product.url, true);
  if (tab?.isSleeping) ctx.tabs.activate(id);
  const wc = ctx.tabs.getWebContentsForTab(id);
  if (!wc) throw new Error('Источник недоступен');
  // Созданная вкладка ещё может показывать about:blank до первого события загрузки.
  const until = Date.now() + 20_000;
  while (!wc.isDestroyed() && (wc.isLoadingMainFrame() || !/^https?:/.test(wc.getURL())) && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (ctx.win.isDestroyed() || getActiveProfile().id !== profile) throw new Error('Профиль или окно изменились');
  }
  if (wc.isDestroyed() || wc.isLoadingMainFrame() || !/^https?:/.test(wc.getURL())) throw new Error('Источник ещё не загрузился. Повторите после загрузки страницы.');
  return id;
}
