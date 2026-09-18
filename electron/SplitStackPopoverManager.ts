// Стопка вкладок живёт в отдельной нативной вью: страница SplitView лежит над chrome DOM,
// поэтому обычный CSS-поповер под ней невозможно нажать.
import { WebContentsView, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import type { ContentBounds, SplitStackMenuData } from '../shared/ipc';
import type { TabManager } from './TabManager';
import { closeWindowView } from './viewTeardown';

interface StackPopover {
  win: BrowserWindow;
  tabs: TabManager;
  view: WebContentsView | null;
  loaded: boolean;
  open: boolean;
  side: 'left' | 'right';
  anchor: ContentBounds;
}

const popovers = new Map<number, StackPopover>();
const WIDTH = 300;
const SHADOW = 10;
let registered = false;

function stateFor(win: BrowserWindow, tabs: TabManager): StackPopover {
  let state = popovers.get(win.id);
  if (state) { state.tabs = tabs; return state; }
  state = {
    win, tabs, view: null, loaded: false, open: false, side: 'left',
    anchor: { x: 0, y: 0, width: 0, height: 0 },
  };
  popovers.set(win.id, state);
  win.on('resize', () => layout(state!));
  win.on('blur', () => closeSplitStackPopover(win));
  win.once('closed', () => {
    popovers.delete(win.id);
    closeWindowView(state!.view);
    state!.view = null;
  });
  return state;
}

function forSender(senderId: number): StackPopover | undefined {
  return [...popovers.values()].find((state) => state.view?.webContents.id === senderId);
}

function menuData(state: StackPopover): SplitStackMenuData {
  return { side: state.side, entries: state.tabs.splitStackEntries(state.side) };
}

function sendData(state: StackPopover): void {
  if (!state.open || !state.loaded || !state.view || state.view.webContents.isDestroyed()) return;
  state.view.webContents.send(IPC.SPLIT_STACK_DATA, menuData(state));
}

function layout(state: StackPopover): void {
  if (!state.open || !state.view || state.win.isDestroyed()) return;
  const count = menuData(state).entries.length;
  const { width, height } = state.win.getContentBounds();
  const cardHeight = Math.min(99 + count * 44, 405);
  const x = Math.max(8, Math.min(width - WIDTH - 8, state.anchor.x + state.anchor.width - WIDTH));
  const below = state.anchor.y + state.anchor.height + 4;
  const y = below + cardHeight + 8 <= height
    ? below : Math.max(8, state.anchor.y - cardHeight - 4);
  state.view.setBounds({ x: Math.round(x - SHADOW), y: Math.round(y - SHADOW), width: WIDTH + SHADOW * 2, height: cardHeight + SHADOW * 2 });
}

function registerIpc(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle(IPC.SPLIT_STACK_SELECT, (e, id: string) => {
    const state = forSender(e.sender.id);
    if (!state || !state.open || typeof id !== 'string') return;
    state.tabs.selectSplitStackTab(state.side, id);
    state.tabs.focusSplitPanel(state.side);
    closeSplitStackPopover(state.win);
    state.tabs.focusActiveView();
  });
  ipcMain.handle(IPC.SPLIT_STACK_DATA, (e) => {
    const state = forSender(e.sender.id);
    return state?.open ? menuData(state) : null;
  });
  ipcMain.handle(IPC.SPLIT_STACK_FORGET, (e, id: string) => {
    const state = forSender(e.sender.id);
    if (!state || !state.open || typeof id !== 'string') return;
    state.tabs.dismissSplitStackTab(state.side, id);
    if (state.tabs.splitStackEntries(state.side).length === 0) {
      closeSplitStackPopover(state.win);
    } else {
      layout(state);
      sendData(state);
    }
  });
  ipcMain.on(IPC.SPLIT_STACK_CLOSE, (e) => {
    const state = forSender(e.sender.id);
    if (!state) return;
    closeSplitStackPopover(state.win);
    state.tabs.focusActiveView();
  });
}

function ensureView(state: StackPopover): WebContentsView {
  if (state.view && !state.view.webContents.isDestroyed()) return state.view;
  registerIpc();
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-splitstack.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  view.setBackgroundColor('#00000000');
  state.view = view;
  state.loaded = false;
  view.webContents.once('did-finish-load', () => {
    state.loaded = true;
    sendData(state);
    if (state.open) view.webContents.focus();
  });
  void view.webContents.loadURL('oblako-chrome://localhost/splitstack.html');
  return view;
}

export function showSplitStackPopover(
  win: BrowserWindow, tabs: TabManager, side: 'left' | 'right', anchor: ContentBounds,
): void {
  if (side !== 'left' && side !== 'right') return;
  if (!anchor || ![anchor.x, anchor.y, anchor.width, anchor.height].every(Number.isFinite)) return;
  const state = stateFor(win, tabs);
  if (state.open && state.side === side) { closeSplitStackPopover(win); tabs.focusActiveView(); return; }
  if (tabs.splitStackEntries(side).length === 0) return;
  state.side = side;
  state.anchor = anchor;
  state.open = true;
  const view = ensureView(state);
  layout(state);
  if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
  sendData(state);
  if (state.loaded) view.webContents.focus();
}

export function closeSplitStackPopover(win: BrowserWindow): void {
  const state = popovers.get(win.id);
  if (!state) return;
  state.open = false;
  if (state.view && !win.isDestroyed() && win.contentView.children.includes(state.view)) {
    win.contentView.removeChildView(state.view);
  }
}
