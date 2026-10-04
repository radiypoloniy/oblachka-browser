import type { BrowserWindow, WebContents } from 'electron';
import type { AiFileMeta } from '../../shared/aiAttachments';
import type { ModelErrorCode, TabState } from '../../shared/ipc';
import type { runChatMessage } from '../TranslationService';
import { allContexts, contextForWindow } from '../WindowRegistry';
import { allPanels, panelBySender } from './instances';

interface ChatMessage {
  role: 'user' | 'assistant'; text: string;
  via?: { label: string; local: boolean }; files?: AiFileMeta[];
}
export interface TabChatContext {
  key: string; messages: ChatMessage[];
  history: Parameters<typeof runChatMessage>[1];
  url: string; title: string; pageText: string | null; pageMarkdown: string | null;
  pending: 'chat' | 'factcheck' | 'search' | null;
  job: number; abort: AbortController | null;
  error: string | null; errorCode: ModelErrorCode | null;
}
export const tabContexts = new Map<string, TabChatContext>();
const cleanupBound = new WeakSet<BrowserWindow>();
const activeKeys = new Map<number, string>();

function contextKey(win: BrowserWindow, id: string): string {
  return id === 'hub' ? `hub:${contextForWindow(win)?.sessionId}` : id;
}
export function selectionFor(sender: WebContents, requested?: unknown): (TabState & { key: string }) | null {
  const panel = panelBySender(sender);
  const owner = panel ? contextForWindow(panel.win) : null;
  if (!owner || sender.isDestroyed()) return null;
  const id = typeof requested === 'string' && requested ? requested : owner.tabs.getActiveId();
  const tab = owner.tabs.stateForTab(id);
  return tab ? { ...tab, key: contextKey(owner.win, id) } : null;
}
export function getOrCreateContext(key: string, url: string, title = ''): TabChatContext {
  let ctx = tabContexts.get(key);
  if (!ctx) {
    ctx = { key, messages: [], history: [], url, title, pageText: null, pageMarkdown: null,
      pending: null, job: 0, abort: null, error: null, errorCode: null };
    tabContexts.set(key, ctx);
  }
  return ctx;
}
export function resetChat(ctx: TabChatContext, url: string): void {
  ctx.abort?.abort(); ctx.job++;
  Object.assign(ctx, { url, messages: [], history: [], pageText: null, pageMarkdown: null,
    pending: null, abort: null, error: null, errorCode: null });
}
export function sendCurrentContext(win: BrowserWindow): void {
  const panel = allPanels().find(p => p.win === win);
  const view = panel?.view;
  if (!view || view.webContents.isDestroyed()) return;
  const selection = selectionFor(view.webContents);
  if (!selection) return;
  const ctx = getOrCreateContext(selection.key, selection.url, selection.title);
  view.webContents.send('ai-panel:context', {
    tabId: selection.id, url: selection.url, title: selection.title, favicon: selection.faviconUrl,
    messages: ctx.messages, sending: ctx.pending !== null, factChecking: ctx.pending === 'factcheck',
    webSearching: ctx.pending === 'search', error: ctx.error, errorCode: ctx.errorCode,
  });
}
export function sendToTab(tabId: string, channel: string, payload: unknown, key: string): void {
  for (const panel of allPanels()) {
    const wc = panel.view?.webContents;
    const selected = wc && !wc.isDestroyed() ? selectionFor(wc) : null;
    if (selected?.id === tabId && selected.key === key) wc!.send(channel, payload);
  }
}
export function syncTabChat(win: BrowserWindow): void {
  if (!cleanupBound.has(win)) {
    cleanupBound.add(win);
    win.once('closed', () => { activeKeys.delete(win.id); syncTabChat(win); });
  }
  // Проверяем полный набор вкладок всех окон, включая скрытые профили и перенос.
  const live = new Map<string, TabState>();
  for (const owner of allContexts()) {
    if (owner.win.isDestroyed()) continue;
    for (const id of ['hub', ...owner.tabs.tabIds()]) {
      const tab = owner.tabs.stateForTab(id);
      if (tab) live.set(contextKey(owner.win, id), tab);
    }
  }
  for (const [key, ctx] of tabContexts) {
    const tab = live.get(key);
    if (!tab) { resetChat(ctx, ctx.url); tabContexts.delete(key); }
    else {
      if (ctx.url !== tab.url) resetChat(ctx, tab.url);
      ctx.title = tab.title;
    }
  }
  const owner = contextForWindow(win);
  const tab = owner?.tabs.stateForTab(owner.tabs.getActiveId());
  const key = tab ? `${contextKey(win, tab.id)}:${tab.url}` : '';
  if (activeKeys.get(win.id) !== key) {
    activeKeys.set(win.id, key);
    sendCurrentContext(win);
  }
}
export function pageWcOf(tabId: string): WebContents | null {
  for (const owner of allContexts()) {
    const wc = owner.tabs.getWebContentsForTab(tabId);
    if (wc && !wc.isDestroyed()) return wc;
  }
  return null;
}
