import type { BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc';
import type { PageTranslateProgress, PageTranslateState } from '../shared/ipc';
import type { TabManager } from './TabManager';
import { allContexts, contextForWindow } from './WindowRegistry';

const states = new Map<string, PageTranslateState>();
const urls = new Map<string, string>();
const activeKeys = new Map<number, string>();
const bound = new WeakSet<BrowserWindow>();
export const runSeqByTab = new Map<string, number>();
const aborts = new Map<string, AbortController>();
const progressByTab = new Map<string, PageTranslateProgress | null>();

export function bumpSeq(id: string): number {
  aborts.get(id)?.abort();
  aborts.set(id, new AbortController());
  const seq = (runSeqByTab.get(id) ?? 0) + 1;
  runSeqByTab.set(id, seq);
  return seq;
}
export function signalFor(id: string): AbortSignal | undefined { return aborts.get(id)?.signal; }
export function getState(id: string): PageTranslateState { return states.get(id) ?? 'idle'; }
export function getActiveState(tabs: TabManager | null): PageTranslateState {
  return tabs ? getState(tabs.getActiveId()) : 'idle';
}
function sendActive(id: string, channel: string, payload: unknown): void {
  for (const owner of allContexts()) {
    if (owner.win.isDestroyed() || owner.tabs.getActiveId() !== id) continue;
    const wc = owner.chromeView.webContents;
    if (!wc.isDestroyed()) wc.send(channel, payload);
  }
}
export function pushState(id: string, state: PageTranslateState): void {
  states.set(id, state);
  sendActive(id, IPC.PAGE_TRANSLATE_STATE_CHANGED, state);
}
export function pushProgress(id: string, progress: PageTranslateProgress | null): void {
  progressByTab.set(id, progress);
  sendActive(id, IPC.PAGE_TRANSLATE_PROGRESS_CHANGED, progress);
}
export function tabsFor(id: string): TabManager | null {
  return allContexts().find(c => !c.win.isDestroyed() && c.tabs.stateForTab(id))?.tabs ?? null;
}
export function onTabsSynced(win: BrowserWindow): void {
  if (!bound.has(win)) {
    bound.add(win);
    win.once('closed', () => { activeKeys.delete(win.id); onTabsSynced(win); });
  }
  // Навигация в фоне тоже отменяет применение старого ответа; перенос сохраняет тот же id.
  const live = new Map<string, string>();
  for (const owner of allContexts()) {
    if (owner.win.isDestroyed()) continue;
    for (const id of owner.tabs.tabIds()) live.set(id, owner.tabs.stateForTab(id)!.url);
  }
  for (const [id, url] of urls) {
    if (!live.has(id) || live.get(id) !== url) {
      bumpSeq(id); states.delete(id); progressByTab.delete(id);
      if (!live.has(id)) { runSeqByTab.delete(id); aborts.delete(id); }
    }
  }
  urls.clear();
  for (const [id, url] of live) urls.set(id, url);
  const owner = contextForWindow(win);
  if (!owner) return;
  const id = owner.tabs.getActiveId();
  const key = `${id}:${live.get(id) ?? ''}`;
  if (activeKeys.get(win.id) !== key) {
    activeKeys.set(win.id, key);
    sendActive(id, IPC.PAGE_TRANSLATE_STATE_CHANGED, getState(id));
    sendActive(id, IPC.PAGE_TRANSLATE_PROGRESS_CHANGED, progressByTab.get(id) ?? null);
  }
}
