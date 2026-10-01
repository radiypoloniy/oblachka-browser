import type { WebContents } from 'electron';
import { allContexts } from '../WindowRegistry';
import { insightsConfig } from './InsightsStore';
import { eligibleInsightPage, insightPageText, releaseInsightPage } from './InsightsPage';
import { prepareInsights, type PreparedInsights } from './InsightsGeneration';

interface PreparedPage {
  tabId: string; url: string; title: string; wc: WebContents;
  text: string; material: PreparedInsights; stableAt: number; waitingAt: number;
}
// Один снимок активной вкладки на окно. Здесь нет ни загрузки модели, ни вызовов API.
const pages = new Map<number, PreparedPage>();
let pending: Promise<void> | null = null;
function drop(windowId: number): void {
  const previous = pages.get(windowId);
  pages.delete(windowId);
  if (previous) releaseInsightPage(previous.wc);
}
export function clearPreparedInsights(): void {
  for (const id of pages.keys()) drop(id);
}
export function preparedInsights(windowId: number, tabId: string, url: string): PreparedPage | null {
  const page = pages.get(windowId);
  return page?.tabId === tabId && page.url === url ? page : null;
}
async function prepareActive(): Promise<void> {
  const active = new Set<number>();
  for (const ctx of allContexts()) {
    if (!insightsConfig().enabled) break;
    if (ctx.role !== 'main' || ctx.win.isDestroyed() || !ctx.win.isVisible() || ctx.win.isMinimized()) continue;
    const tab = ctx.tabs.snapshot().find(t => t.isActive);
    const wc = tab ? ctx.tabs.getActiveWebContents(tab.id) : null;
    if (!tab || !wc || wc.isDestroyed() || !eligibleInsightPage(tab.url)) continue;
    active.add(ctx.win.id);
    let previous = pages.get(ctx.win.id);
    if (previous && (previous.wc !== wc || previous.url !== tab.url)) { drop(ctx.win.id); previous = undefined; }
    if (wc.isLoadingMainFrame()) { drop(ctx.win.id); continue; }
    const text = await insightPageText(wc);
    // Пока DOM читался, пользователь мог сменить вкладку или выключить подготовку.
    if (!insightsConfig().enabled || ctx.win.isDestroyed() || wc.isDestroyed() ||
        ctx.tabs.snapshot().find(t => t.isActive)?.id !== tab.id || wc.getURL() !== tab.url) {
      releaseInsightPage(wc); continue;
    }
    if (previous?.text === text && previous.title === tab.title) continue;
    const now = Date.now();
    pages.set(ctx.win.id, { tabId: tab.id, url: tab.url, title: tab.title, wc, text,
      material: prepareInsights(text, tab.title), stableAt: now, waitingAt: previous?.waitingAt ?? now });
  }
  for (const id of pages.keys()) if (!active.has(id)) drop(id);
}
export async function prepareActiveInsights(): Promise<void> {
  if (pending) return pending;
  pending = prepareActive();
  try { await pending; } finally { pending = null; }
}
