// Поповер VPN у тулбарной пилюли — тот же приём, что PasswordPopoverManager.ts (отдельная
// прозрачная WebContentsView поверх страницы: DOM внутри Toolbar не подходит, нативный
// WebContentsView страницы перекрывает его независимо от z-index). Отличие от паролей: этому
// поповеру не нужен "state" на входе — список серверов/статус подключения он сам запрашивает
// через свой preload при показе (см. preload-vpnpopover.ts), main ничего не решает и не толкает.
import { WebContentsView, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { ContentBounds } from '../shared/ipc';

const POPOVER_WIDTH = 300;
const INITIAL_HEIGHT = 160;
const GAP = 6;
const WINDOW_MARGIN = 8;
// Держать в синхроне с SHADOW_MARGIN в src/vpnpopover.tsx.
const SHADOW_MARGIN = 16;

let popoverView: WebContentsView | null = null;
let attachedWin: BrowserWindow | null = null;
let resizeBoundWin: BrowserWindow | null = null;
let ipcRegistered = false;
let lastAnchorBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
let currentHeight = INITIAL_HEIGHT;
let isOpen = false;
// На первом открытии showVpnPopover() успевает вызвать send() ДО того, как страница поповера
// (loadURL — асинхронная загрузка) навесит свой ipcRenderer.on('vpn-popover:show') — сообщение
// без слушателя молча теряется (в отличие от пароля, где did-finish-load пересылает lastState,
// здесь нет payload для повторной отправки, поэтому переотправляем сам факт показа по флагу isOpen).
let popoverLoaded = false;
let onClosedCb: (() => void) | null = null;

export function initVpnPopover(onClosed: () => void): void {
  onClosedCb = onClosed;
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

export function syncVpnPopoverAnchorBounds(b: ContentBounds): void {
  lastAnchorBounds = b;
  layoutPopover();
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on('vpn-popover:close', () => closeVpnPopover());
  ipcMain.on('vpn-popover:height', (_e, px: number) => {
    currentHeight = Math.max(1, px);
    layoutPopover();
  });
}

function ensurePopoverView(): WebContentsView {
  if (popoverView) return popoverView;
  ensureIpcRegistered();
  popoverView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-vpnpopover.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  popoverView.setBackgroundColor('#00000000');
  popoverView.webContents.once('did-finish-load', () => {
    popoverLoaded = true;
    if (isOpen) popoverView?.webContents.send('vpn-popover:show');
  });
  popoverView.webContents.loadURL('oblako-chrome://localhost/vpnpopover.html');
  return popoverView;
}

export function showVpnPopover(win: BrowserWindow): void {
  attachedWin = win;
  isOpen = true;
  if (resizeBoundWin !== win) {
    win.on('resize', layoutPopover);
    resizeBoundWin = win;
  }
  const view = ensurePopoverView();
  view.setBounds(computeBounds());
  if (!isAttached()) win.contentView.addChildView(view);
  // Попап сам подтягивает свежие данные при показе (см. preload-vpnpopover.ts::onShow) —
  // не нуждается в payload с сервера, в отличие от паролей (там main решает has-saved/offer-*).
  // На первом открытии страница ещё грузится — did-finish-load выше пошлёт сам, когда догрузится.
  if (popoverLoaded) view.webContents.send('vpn-popover:show');
}

export function closeVpnPopover(): void {
  if (!isOpen) return;
  isOpen = false;
  if (isAttached()) {
    try { attachedWin!.contentView.removeChildView(popoverView!); } catch { /* окно могло уже закрыться */ }
  }
  onClosedCb?.();
}
