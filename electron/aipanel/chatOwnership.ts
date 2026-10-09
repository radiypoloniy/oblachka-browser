import type { BrowserWindow, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AiFileMeta } from '../../shared/aiAttachments';
import type { ModelErrorCode, TabState } from '../../shared/ipc';
import type { runChatMessage } from '../TranslationService';
import { allContexts, contextForWindow } from '../WindowRegistry';
import { allPanels, existingPanel, panelBySender, type PanelInstance } from './instances';
import * as contextStore from '../AiContextStore';
import { releaseOwner } from '../ai/InputFileStore';
import type { AiInputMeta } from '../../shared/aiChatInputs';
import {
  PAGE_SOURCE, freeChatId, initialSource, resolveSource, sourceFromChatId, type ChatSource,
} from '../../shared/aiContexts';

interface ChatMessage {
  role: 'user' | 'assistant'; text: string;
  via?: { label: string; local: boolean }; files?: AiFileMeta[];
  inputs?: AiInputMeta[];
}
export interface TabChatContext {
  inputEpoch: string;
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

// ── Источник беседы: страница или отвязанный чат ──────────────────────────────────────────────
//
// ⚠️ Отвязанная беседа живёт в ТОЙ ЖЕ tabContexts, но под ключом 'free:<окно>:<источник>', и
// syncTabChat её не трогает: смысл отвязки ровно в том, что переключение вкладки и навигация
// беседу не сбрасывают. Окно своё у ключа потому, что источник выбирается на плашке окна, и два
// окна с одним набором — два разных разговора, а не один на двоих с перемешанными ответами.
const FREE_PREFIX = 'free:';
function freeKey(win: BrowserWindow, source: ChatSource): string {
  return `${FREE_PREFIX}${win.id}:${freeChatId(source).slice(FREE_PREFIX.length)}`;
}

/** Источник беседы панели. Первый вызов фиксирует набор по умолчанию из настроек. */
export function sourceOf(panel: PanelInstance): ChatSource {
  const state = contextStore.getState();
  panel.source = resolveSource(panel.source ?? initialSource(state), state);
  return panel.source;
}

export function setPanelSource(panel: PanelInstance, source: ChatSource): void {
  panel.source = resolveSource(source, contextStore.getState());
  syncTabChat(panel.win);
}

/** Текст набора — уходит в системный промпт. У страницы и пустого чата его нет. */
export function instructionsFor(source: ChatSource): string | undefined {
  return source.kind === 'preset' ? contextStore.presetText(source.id) : undefined;
}

export function connectionFor(source: ChatSource): string | undefined {
  return source.kind === 'preset' ? contextStore.getState().presets.find(p => p.id === source.id)?.connectionId : undefined;
}

export interface ChatSelection {
  /** То, чем панель подписывает отправку: id вкладки или 'free:…'. */
  id: string; key: string; url: string; title: string; faviconUrl: string | null; source: ChatSource;
}
/**
 * Беседа, к которой относится сообщение панели.
 *
 * ⚠️ Присланный id важнее текущего источника: IPC может доехать уже после того, как человек
 * переключил плашку, и тогда вопрос, заданный про страницу, ушёл бы в отвязанный чат.
 */
export function selectionFor(sender: WebContents, requested?: unknown): ChatSelection | null {
  const panel = panelBySender(sender);
  const owner = panel ? contextForWindow(panel.win) : null;
  if (!panel || !owner || sender.isDestroyed()) return null;
  const asked = typeof requested === 'string' && requested ? requested : null;
  const source = asked ? (sourceFromChatId(asked) ?? PAGE_SOURCE) : sourceOf(panel);
  if (source.kind !== 'page') {
    const title = source.kind === 'preset'
      ? contextStore.getState().presets.find((p) => p.id === source.id)?.title ?? '' : '';
    return { id: freeChatId(source), key: freeKey(owner.win, source), url: '', title, faviconUrl: null, source };
  }
  const id = asked ?? owner.tabs.getActiveId();
  const tab = owner.tabs.stateForTab(id);
  return tab ? {
    id, key: contextKey(owner.win, id), url: tab.url, title: tab.title,
    faviconUrl: tab.faviconUrl ?? null, source,
  } : null;
}
export function getOrCreateContext(key: string, url: string, title = ''): TabChatContext {
  let ctx = tabContexts.get(key);
  if (!ctx) {
    ctx = { key, inputEpoch: randomUUID(), messages: [], history: [], url, title, pageText: null, pageMarkdown: null,
      pending: null, job: 0, abort: null, error: null, errorCode: null };
    tabContexts.set(key, ctx);
  }
  return ctx;
}
export function resetChat(ctx: TabChatContext, url: string): void {
  releaseOwner(ctx.key);
  ctx.abort?.abort(); ctx.job++;
  Object.assign(ctx, { url, inputEpoch: randomUUID(), messages: [], history: [], pageText: null, pageMarkdown: null,
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
    source: selection.source, inputEpoch: ctx.inputEpoch, messages: ctx.messages, sending: ctx.pending !== null, factChecking: ctx.pending === 'factcheck',
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
    win.once('closed', () => {
      activeKeys.delete(win.id);
      // Отвязанные беседы окна уходят вместе с ним — их никто больше не покажет.
      for (const [key, ctx] of tabContexts) {
        if (key.startsWith(`${FREE_PREFIX}${win.id}:`)) { resetChat(ctx, ''); tabContexts.delete(key); }
      }
      syncTabChat(win);
    });
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
    if (key.startsWith(FREE_PREFIX)) continue;
    const tab = live.get(key);
    if (!tab) { resetChat(ctx, ctx.url); tabContexts.delete(key); }
    else {
      if (ctx.url !== tab.url) resetChat(ctx, tab.url);
      ctx.title = tab.title;
    }
  }
  const owner = contextForWindow(win);
  const tab = owner?.tabs.stateForTab(owner.tabs.getActiveId());
  // ⚠️ У отвязанной беседы ключ не зависит от вкладки — поэтому переключение вкладки её заново
  // не присылает. Повторный onContext посреди генерации стёр бы уже напечатанную часть ответа.
  const panel = existingPanel(win);
  const source = panel ? sourceOf(panel) : PAGE_SOURCE;
  const key = source.kind !== 'page' ? freeKey(win, source)
    : tab ? `${contextKey(win, tab.id)}:${tab.url}` : '';
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

// ── Наборы поменялись в настройках ───────────────────────────────────────────────────────────
//
// ⚠️ Правка текста набора СБРАСЫВАЕТ его беседы. Локальная Qwen хранит системный промпт внутри
// истории (setChatHistory), и после правки модель продолжала бы отвечать по старым инструкциям,
// хотя человек видит новые. Честнее начать заново, чем молча расходиться с тем, что написано.
// ⚠️ Смена набора по умолчанию переключает ВСЕ панели: это явное действие в настройках, и
// человек ждёт увидеть результат сразу, а не в следующем окне.
contextStore.onChanged((next, prev) => {
  for (const old of prev.presets) {
    const cur = next.presets.find((p) => p.id === old.id);
    if (cur && cur.text === old.text && cur.materials === old.materials && cur.connectionId === old.connectionId) continue;
    const suffix = `:${freeChatId({ kind: 'preset', id: old.id }).slice(FREE_PREFIX.length)}`;
    for (const [key, ctx] of tabContexts) {
      if (key.startsWith(FREE_PREFIX) && key.endsWith(suffix)) { resetChat(ctx, ''); tabContexts.delete(key); }
    }
  }
  const defaultChanged = next.defaultId !== prev.defaultId;
  for (const panel of allPanels()) {
    if (panel.win.isDestroyed()) continue;
    if (defaultChanged) panel.source = initialSource(next);
    activeKeys.delete(panel.win.id);
    syncTabChat(panel.win);
  }
});
