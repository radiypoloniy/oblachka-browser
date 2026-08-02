// Поповер загрузок у одноимённой кнопки тулбара — тот же приём, что VpnPopoverManager.ts
// (отдельная прозрачная WebContentsView поверх страницы: DOM внутри Toolbar не годится, нативная
// вью страницы перекрывает его независимо от z-index).
//
// ⚠️ Отличие от VPN: содержимое здесь ЖИВОЕ. Пока поповер открыт, прогресс капает раз в 200 мс,
// и без явного пуша в саму вью (broadcastDownloads ниже) полоска замерла бы до переоткрытия —
// DOWNLOADS_CHANGED из main уходит только в chromeView.
import { WebContentsView, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { ContentBounds, DownloadEntry } from '../shared/ipc';
import { IPC } from '../shared/ipc';

const POPOVER_WIDTH = 340;
const INITIAL_HEIGHT = 180;
const GAP = 6;
const WINDOW_MARGIN = 8;
// Держать в синхроне с SHADOW_MARGIN в src/downloadspopover.tsx.
const SHADOW_MARGIN = 16;

let popoverView: WebContentsView | null = null;
let attachedWin: BrowserWindow | null = null;
let resizeBoundWin: BrowserWindow | null = null;
let ipcRegistered = false;
let lastAnchorBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
let currentHeight = INITIAL_HEIGHT;
let isOpen = false;
// На первом открытии show...() успевает позвать send() ДО того, как страница поповера навесит
// своих слушателей (loadURL асинхронен) — сообщение без слушателя молча теряется. Тот же флаг и
// та же переотправка в did-finish-load, что у VPN-поповера.
let popoverLoaded = false;
// Оба колбэка получают ОКНО: кнопка загрузок есть в каждом окне (в отличие от VPN-пилюли, которая
// живёт только в полном), и «закрылось»/«показать все» должны прийти в хром того окна, где кликнули.
let onClosedCb: ((win: BrowserWindow) => void) | null = null;
let onOpenAllCb: ((win: BrowserWindow) => void) | null = null;

export function initDownloadsPopover(
  onClosed: (win: BrowserWindow) => void,
  onOpenAll: (win: BrowserWindow) => void,
): void {
  onClosedCb = onClosed;
  onOpenAllCb = onOpenAll;
}

function isAttached(): boolean {
  return !!popoverView && !!attachedWin && attachedWin.contentView.children.includes(popoverView);
}

function computeBounds(): { x: number; y: number; width: number; height: number } {
  const winBounds = attachedWin?.getContentBounds() ?? { width: 1200, height: 800 };
  const maxX = Math.max(WINDOW_MARGIN, winBounds.width - POPOVER_WIDTH - WINDOW_MARGIN);
  const cardX = Math.min(Math.max(WINDOW_MARGIN, lastAnchorBounds.x + lastAnchorBounds.width - POPOVER_WIDTH), maxX);
  const belowY = lastAnchorBounds.y + lastAnchorBounds.height + GAP;
  const aboveY = lastAnchorBounds.y - currentHeight - GAP;
  const cardY = belowY + currentHeight + WINDOW_MARGIN <= winBounds.height
    ? belowY
    : Math.max(WINDOW_MARGIN, aboveY);
  return {
    x: cardX - SHADOW_MARGIN,
    y: cardY - SHADOW_MARGIN,
    width: POPOVER_WIDTH + SHADOW_MARGIN * 2,
    height: currentHeight + SHADOW_MARGIN * 2,
  };
}

function layoutPopover(): void {
  if (!isAttached()) return;
  popoverView!.setBounds(computeBounds());
}

export function syncDownloadsPopoverAnchorBounds(b: ContentBounds): void {
  lastAnchorBounds = b;
  layoutPopover();
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on('downloads-popover:close', () => closeDownloadsPopover());
  ipcMain.on('downloads-popover:height', (_e, px: number) => {
    currentHeight = Math.max(1, px);
    layoutPopover();
  });
  ipcMain.on(IPC.DOWNLOADS_POPOVER_OPEN_ALL, () => {
    const win = attachedWin;
    closeDownloadsPopover();
    if (win) onOpenAllCb?.(win);
  });
}

function ensurePopoverView(): WebContentsView {
  if (popoverView) return popoverView;
  ensureIpcRegistered();
  popoverView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-downloadspopover.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  popoverView.setBackgroundColor('#00000000');
  popoverView.webContents.once('did-finish-load', () => {
    popoverLoaded = true;
    if (isOpen) popoverView?.webContents.send('downloads-popover:show');
  });
  popoverView.webContents.loadURL('oblako-chrome://localhost/downloadspopover.html');
  return popoverView;
}

export function showDownloadsPopover(win: BrowserWindow): void {
  attachedWin = win;
  isOpen = true;
  if (resizeBoundWin !== win) {
    win.on('resize', layoutPopover);
    resizeBoundWin = win;
  }
  const view = ensurePopoverView();
  view.setBounds(computeBounds());
  if (!isAttached()) win.contentView.addChildView(view);
  if (popoverLoaded) view.webContents.send('downloads-popover:show');
}

// Живой список в открытую вью. Инкапсуляция та же, что у broadcastVpnState: main зовёт функцию,
// а менеджер сам решает, жива ли вью (не destroyed — иначе крэш на send) и есть ли смысл слать
// (закрытая всё равно перезапросит список на следующем показе).
export function broadcastDownloads(entries: DownloadEntry[]): void {
  if (!popoverView || popoverView.webContents.isDestroyed()) return;
  if (!isOpen || !popoverLoaded) return;
  popoverView.webContents.send(IPC.DOWNLOADS_CHANGED, entries);
}

export function closeDownloadsPopover(): void {
  if (!isOpen) return;
  isOpen = false;
  const win = attachedWin;
  if (isAttached()) {
    try { attachedWin!.contentView.removeChildView(popoverView!); } catch { /* окно могло уже закрыться */ }
  }
  if (win && !win.isDestroyed()) onClosedCb?.(win);
}
