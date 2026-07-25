// Поповер автозаполнения — отдельная прозрачная WebContentsView поверх страницы, заякоренная на
// поле формы. Тот же приём, что PasswordPopoverManager (DOM внутри chrome перекрывается нативной
// вьюхой страницы). Показывает список сохранённых профилей (адреса; карты — заход 3); выбор
// пользователя уходит в оркестратор, который шлёт значения на подстановку в страницу.
import { WebContentsView, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { ContentBounds, AddressProfile, CardMeta } from '../shared/ipc';

const POPOVER_WIDTH = 300;
const INITIAL_HEIGHT = 120;
const GAP = 6;
const WINDOW_MARGIN = 8;
// Держать в синхроне с SHADOW_MARGIN в src/autofillpopover.tsx.
const SHADOW_MARGIN = 16;

// Что показывает поповер: список для подстановки (адреса/карты) ЛИБО предложение сохранить после
// отправки формы (save-*). Сами данные для сохранения держит оркестратор (pendingSave) — в поповер
// уходит только текст для показа (полный номер карты сюда не попадает).
export type AutofillPopoverState =
  | { kind: 'address'; addresses: AddressProfile[] }
  | { kind: 'card'; cards: CardMeta[] }
  | { kind: 'save-address'; title: string; sub: string }
  | { kind: 'save-card'; title: string; sub: string };

let popoverView: WebContentsView | null = null;
let attachedWin: BrowserWindow | null = null;
let resizeBoundWin: BrowserWindow | null = null;
let ipcRegistered = false;
let lastAnchorBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
let currentHeight = INITIAL_HEIGHT;
let lastState: AutofillPopoverState | null = null;
let onClosedCb: (() => void) | null = null;
let onPickCb: ((id: number) => void) | null = null;
let onSaveCb: (() => void) | null = null;

export function initAutofillPopover(onClosed: () => void, onPick: (id: number) => void, onSave: () => void): void {
  onClosedCb = onClosed;
  onPickCb = onPick;
  onSaveCb = onSave;
}

function isAttached(): boolean {
  return !!popoverView && !!attachedWin && attachedWin.contentView.children.includes(popoverView);
}

function computeBounds(): { x: number; y: number; width: number; height: number } {
  const winBounds = attachedWin?.getContentBounds() ?? { width: 1200, height: 800 };
  const maxX = Math.max(WINDOW_MARGIN, winBounds.width - POPOVER_WIDTH - WINDOW_MARGIN);
  const cardX = Math.min(Math.max(WINDOW_MARGIN, lastAnchorBounds.x), maxX);
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

export function syncAutofillPopoverAnchorBounds(b: ContentBounds): void {
  lastAnchorBounds = b;
  layoutPopover();
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on('autofill-popover:close', () => closeAutofillPopover());
  ipcMain.on('autofill-popover:height', (_e, px: number) => {
    currentHeight = Math.max(1, px);
    layoutPopover();
  });
  ipcMain.on('autofill-popover:pick', (_e, id: number) => {
    onPickCb?.(id);
    closeAutofillPopover();
  });
  ipcMain.on('autofill-popover:save', () => {
    onSaveCb?.();
    closeAutofillPopover();
  });
}

function ensurePopoverView(): WebContentsView {
  if (popoverView) return popoverView;
  ensureIpcRegistered();
  popoverView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-autofillpopover.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  popoverView.setBackgroundColor('#00000000');
  popoverView.webContents.once('did-finish-load', () => {
    if (lastState) popoverView?.webContents.send('autofill-popover:show', lastState);
  });
  popoverView.webContents.loadURL('oblako-chrome://localhost/autofillpopover.html');
  return popoverView;
}

export function showAutofillPopover(win: BrowserWindow, state: AutofillPopoverState): void {
  attachedWin = win;
  lastState = state;
  if (resizeBoundWin !== win) {
    win.on('resize', layoutPopover);
    resizeBoundWin = win;
  }
  const view = ensurePopoverView();
  view.setBounds(computeBounds());
  if (!isAttached()) win.contentView.addChildView(view);
  view.webContents.send('autofill-popover:show', state);
}

export function closeAutofillPopover(): void {
  lastState = null;
  if (isAttached()) {
    try { attachedWin!.contentView.removeChildView(popoverView!); } catch { /* окно могло уже закрыться */ }
  }
  onClosedCb?.();
}
