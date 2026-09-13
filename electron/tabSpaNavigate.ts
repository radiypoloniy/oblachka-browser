// SPA-навигация для истории. Живёт отдельно от TabManager, чтобы не раздувать файл
// сверх храповика: якорь не страница, pathname/search — да.
import type { WebContents } from 'electron';
import { isSpaRouteChange } from '../shared/historyIndex';

const lastUrl = new WeakMap<WebContents, string>();

export function rememberSpaNavigation(wc: WebContents): void {
  if (wc.isDestroyed()) return;
  lastUrl.set(wc, wc.getURL());
}

export function handleSpaInPageNavigate(
  wc: WebContents,
  url: string,
  isMainFrame: boolean,
  incognito: boolean,
  notify: () => void,
  onNavigate?: (url: string, title: string, wc: WebContents) => void,
): void {
  notify();
  if (wc.isDestroyed()) return;
  const prev = lastUrl.get(wc) ?? '';
  lastUrl.set(wc, url);
  if (!isMainFrame || incognito) return;
  if (!isSpaRouteChange(prev, url)) return;
  onNavigate?.(url, wc.getTitle() || url, wc);
}
