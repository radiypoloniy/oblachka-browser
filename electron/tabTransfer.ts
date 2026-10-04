import type { BrowserWindow, WebContentsView } from 'electron';
import type { SidebarNode, TabErrorState } from '../shared/ipc';
import { findTabParent, pruneEmptyGroups } from '../shared/nodeTree';
import type { ManagedTab, SleepingMeta } from './tabTransferTypes';

interface TransferState {
  tabs: Map<string, ManagedTab>;
  nodes: SidebarNode[];
  pinned: ManagedTab[];
  errors: Map<string, TabErrorState>;
  activeId: string;
}

export interface TabTransferHost {
  window(): BrowserWindow;
  state(): TransferState;
  canDetach(id: string): boolean;
  wire(id: string, view: WebContentsView): void;
  activate(id: string): void;
  changed(): void;
  markPrivate(): void;
  committed(id: string): void;
}

// Билет одноразовый: отказ приёмника возвращает исходное дерево, а успешное принятие
// сохраняет id и все метаданные. До завершения переноса источник не публикует пустое дерево.
export interface DetachedTab {
  tab: ManagedTab;
  pinned: boolean;
  error?: TabErrorState;
  source: TabTransferHost;
  pending: boolean;
  restore(): void;
}

export function detachTab(host: TabTransferHost, id: string): DetachedTab | null {
  const state = host.state();
  const tab = state.tabs.get(id);
  if (host.window().isDestroyed() || !tab || tab.kind || !host.canDetach(id)) return null;
  const live = tab.view?.webContents;
  if ((!live || live.isDestroyed()) && !tab.sleeping) return null;
  const pinnedIndex = state.pinned.findIndex(t => t.id === id);
  const parent = pinnedIndex < 0 ? findTabParent(id, state.nodes) : null;
  if (pinnedIndex < 0 && (!parent || parent.parent[parent.idx]?.type !== 'single')) return null;
  const nodes = structuredClone(state.nodes);
  const pinned = [...state.pinned];
  const fallback: SleepingMeta = tab.sleeping ?? {
    url: live!.getURL(), title: live!.getTitle(), faviconUrl: null, faviconData: null,
  };
  const ticket: DetachedTab = {
    tab, pinned: pinnedIndex >= 0, error: state.errors.get(id), source: host, pending: true,
    restore() {
      if (!ticket.pending) return;
      ticket.pending = false;
      const current = host.state();
      // Даже умершая во время переноса вью оставляет восстановимый адрес вкладки.
      if (tab.view && (!tab.view.webContents || tab.view.webContents.isDestroyed())) {
        tab.view = null; tab.sleeping = fallback;
      }
      current.tabs.set(id, tab);
      current.nodes.splice(0, current.nodes.length, ...nodes);
      current.pinned.splice(0, current.pinned.length, ...pinned);
      if (ticket.error) current.errors.set(id, ticket.error);
      try {
        if (tab.view) host.wire(id, tab.view);
        if (!host.window().isDestroyed()) host.activate(state.activeId);
        host.changed();
      } catch (e) { console.error('[TabTransfer] дерево восстановлено, обновление окна не удалось:', e); }
    },
  };
  // Всё ниже синхронно; вызывающая сторона обязана принять билет или вернуть его.
  state.tabs.delete(id);
  state.errors.delete(id);
  if (pinnedIndex >= 0) state.pinned.splice(pinnedIndex, 1);
  else { parent!.parent.splice(parent!.idx, 1); pruneEmptyGroups(state.nodes); }
  try {
    if (tab.view) host.window().contentView.removeChildView(tab.view);
  } catch (e) {
    ticket.restore();
    console.error('[TabTransfer] снятие отменено:', e);
    return null;
  }
  return ticket;
}

export function adoptTab(host: TabTransferHost, ticket: DetachedTab): string | null {
  const state = host.state();
  const previousActiveId = state.activeId;
  const { tab: original } = ticket;
  if (!ticket.pending || ticket.source === host || host.window().isDestroyed()
    || state.tabs.has(original.id)) return null;
  if (original.view && (!original.view.webContents || original.view.webContents.isDestroyed())) return null;
  const tab = { ...original };
  const id = tab.id;
  try {
    state.tabs.set(id, tab);
    if (ticket.pinned) state.pinned.push(tab);
    else state.nodes.push({ type: 'single', tabId: id });
    if (ticket.error) state.errors.set(id, ticket.error);
    if (tab.view) host.wire(id, tab.view);
    host.activate(id);
  } catch (e) {
    const current = host.state();
    current.tabs.delete(id);
    current.errors.delete(id);
    const pin = current.pinned.findIndex(t => t.id === id);
    if (pin >= 0) current.pinned.splice(pin, 1);
    const parent = findTabParent(id, current.nodes);
    if (parent) parent.parent.splice(parent.idx, 1);
    if (tab.view) {
      try { host.window().contentView.removeChildView(tab.view); } catch { /* приёмник мог закрыться */ }
      if (tab.view !== original.view) tab.view.webContents.close();
    }
    try { host.activate(previousActiveId); } catch { /* исходное дерево приёмника сохранено */ }
    console.error('[TabTransfer] принятие отменено:', e);
    return null;
  }
  if (tab.incognito) host.markPrivate();
  ticket.pending = false;
  // Ошибка обновления UI источника уже не отменяет состоявшийся перенос страницы.
  try { ticket.source.committed(id); } catch (e) { console.error('[TabTransfer] обновление источника:', e); }
  return id;
}
