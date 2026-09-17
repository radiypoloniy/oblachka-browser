import type { BrowserWindow, WebContents } from 'electron';
import type { FindResult } from '../shared/ipc';
import { rememberSpaNavigation, handleSpaInPageNavigate } from './tabSpaNavigate';

// Контракт оставляет владение вкладками, split и сессией у TabManager. Здесь только порядок и
// условия реакций на события конкретного WebContents; ссылки на состояние читаются при событии.
export interface PageLifecycleHost {
  win: BrowserWindow;
  mine(): boolean;
  notify(): void;
  focusedSplitSide(): 'left' | 'right' | null;
  focusSplitPanel(side: 'left' | 'right'): void;
  onContentFocus(): void;
  firstTabLoaded(): boolean;
  markFirstTabLoaded(): void;
  clearError(): void;
  clearAiTitle(): void;
  isActive(): boolean;
  splitState(): { inSplit: boolean; shownPartner: boolean };
  clearFind(): void;
  touch(): void;
  reveal(): void;
  incognito(): boolean;
  onNavigate(url: string, title: string, wc: WebContents): void;
  onRuleNavigate(url: string): void;
  getFullscreenTabId(): string | null;
  setFullscreenTabId(id: string | null): void;
  repositionViews(): void;
  onTitleUpdate(url: string, title: string, wc: WebContents): void;
  cacheFavicon(wc: WebContents, url: string): void;
  markAudio(): void;
  onFindResult(result: FindResult): void;
}

export function wireTabPageLifecycle(id: string, wc: WebContents, host: PageLifecycleHost): void {
  wc.on('focus', () => {
    if (!host.mine()) return;
    // Нативная вью перехватывает клик: DOM-панель split его не увидит.
    const side = host.focusedSplitSide();
    if (side) host.focusSplitPanel(side);
    host.onContentFocus();
  });

  // Подписка ставится только до первой загрузки; повторные события не дублируют callback.
  if (!host.firstTabLoaded()) {
    wc.once('did-finish-load', () => {
      if (host.firstTabLoaded()) return;
      host.markFirstTabLoaded();
    });
  }

  wc.on('did-start-loading', () => {
    if (!host.mine()) return;
    host.clearError();
    host.notify();
  });
  wc.on('did-stop-loading', host.notify);
  // Вью показываем только после коммита навигации, не на retry загрузки.
  wc.on('did-navigate', () => {
    if (!host.mine()) return;
    host.clearAiTitle(); // умное имя относилось к прежней странице, не к новому URL
    const active = host.isActive();
    const { inSplit, shownPartner } = host.splitState();
    if (active) host.clearFind();
    if (active || inSplit) host.touch();
    // Фоновая навигация в припаркованной паре не поднимает её поверх активной страницы.
    if (active || shownPartner) host.reveal();
    if (!host.incognito()) host.onNavigate(wc.getURL(), wc.getTitle(), wc);
    rememberSpaNavigation(wc);
    // Сначала отдаём rule hook прежний fromHost, затем запоминаем текущий адрес.
    host.onRuleNavigate(wc.getURL());
    host.notify();
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) =>
    handleSpaInPageNavigate(wc, url, isMainFrame, host.incognito(), host.notify, host.onNavigate));

  // Разворачиваем окно и вью вместе, но переставляем bounds лишь после OS-анимации окна.
  wc.on('enter-html-full-screen', () => {
    if (!host.mine()) return;
    host.setFullscreenTabId(id);
    if (host.win.isDestroyed()) return;
    if (host.win.isFullScreen()) { host.repositionViews(); return; }
    host.win.once('enter-full-screen', host.repositionViews);
    host.win.setFullScreen(true);
  });
  wc.on('leave-html-full-screen', () => {
    if (!host.mine()) return;
    if (host.getFullscreenTabId() !== id) return;
    host.setFullscreenTabId(null);
    if (host.win.isDestroyed()) return;
    if (!host.win.isFullScreen()) { host.repositionViews(); return; }
    host.win.once('leave-full-screen', host.repositionViews);
    host.win.setFullScreen(false);
  });

  wc.on('page-title-updated', (_e, title) => {
    if (!host.mine()) return;
    host.onTitleUpdate(wc.getURL(), title, wc);
    host.notify();
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    if (!host.mine()) return;
    const url = favicons?.[0];
    if (!url) return; // [] у SPA не стирает прежнюю иконку
    if (/^(data:|https?:)/i.test(url)) {
      (wc as WebContents & { _oblakoFavicon?: string })._oblakoFavicon = url;
      host.notify();
    }
    host.cacheFavicon(wc, url);
  });
  wc.on('audio-state-changed', (event) => {
    if (!host.mine()) return;
    if (event.audible) host.markAudio();
    host.notify();
  });
  wc.on('found-in-page', (_e, result) => {
    if (!host.mine()) return;
    host.onFindResult({ activeMatch: result.activeMatchOrdinal, count: result.matches });
  });
}
