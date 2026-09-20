// SPA-навигация для истории. Живёт отдельно от TabManager, чтобы не раздувать файл
// сверх храповика: якорь не страница, pathname/search — да.
import type { WebContents } from 'electron';
import { isSpaRouteChange } from '../shared/historyIndex';
import { refreshFlightForWebContents } from './FlightWatch';

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
  // ⚠️ Якорь и тот же pathname+search — не визит, но на Aviasales там живёт открытый билет
  // (`t=` / `#search/…`). Часы обязаны это увидеть; история — нет.
  if (!isSpaRouteChange(prev, url)) {
    void refreshFlightForWebContents(wc);
    return;
  }
  onNavigate?.(url, wc.getTitle() || url, wc);
}
