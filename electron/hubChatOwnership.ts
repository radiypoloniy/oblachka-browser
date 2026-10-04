import type { BrowserWindow, WebContents } from 'electron';
import type { HubChatManager } from './HubChatManager';
import { allContexts, contextFromSender } from './WindowRegistry';

export function hubSelection(sender: WebContents, id: unknown) {
  const owner = contextFromSender(sender);
  if (!owner || typeof id !== 'string') return null;
  const tab = owner.tabs.stateForTab(id);
  if (!tab || tab.kind !== 'hub' || tab.incognito) return null;
  return { owner, key: `hub:${owner.sessionId}` };
}
const bound = new WeakSet<BrowserWindow>();
export function syncHubChats(win: BrowserWindow, chats: HubChatManager): void {
  if (!bound.has(win)) {
    bound.add(win);
    win.once('closed', () => syncHubChats(win, chats));
  }
  const live = new Set<string>();
  for (const owner of allContexts()) {
    if (owner.win.isDestroyed()) continue;
    live.add(`hub:${owner.sessionId}`);
  }
  chats.pruneClosedTabs(live);
}
