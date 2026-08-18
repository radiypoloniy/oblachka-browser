// Поповер буфера скопированного — своя прозрачная WebContentsView поверх страницы. Тот же приём,
// что у поповеров загрузок и VPN: DOM внутри чрома не годится, нативная вью страницы перекрывает
// его независимо от z-index.
//
// ⚠️ Поповер СВОЙ У КАЖДОГО ОКНА, как у паролей: буфер один на приложение, но якорь и показ
// принадлежат конкретному окну (в лёгком окне кнопка тоже есть).
import { WebContentsView, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { ContentBounds } from '../shared/ipc';
import { closeWindowView } from './viewTeardown';

const POPOVER_WIDTH = 380;
const INITIAL_HEIGHT = 200;
// ⚠️ ЗАЗОР ОБЯЗАН БЫТЬ НЕ МЕНЬШЕ SHADOW_MARGIN, и это не про воздух, а про мышь. Прозрачный
// запас под тень ХИТ-ТЕСТИТСЯ: вью ловит клики всем своим прямоугольником, а не видимой
// карточкой. При зазоре 6 и запасе 16 верхний край вью вставал на 10 px ВЫШЕ низа кнопки-якоря,
// то есть её нижняя треть переставала нажиматься, пока поповер открыт (закрыть поповер повторным
// кликом по кнопке получалось не всегда — как повезёт попасть выше кромки). Ровно этот же просчёт
// на дропдауне омнибокса накрывал адресную строку целиком и месяц выглядел как проблема фокуса —
// см. разбор в docs/architecture-core.md.
const GAP = 16;
const WINDOW_MARGIN = 8;
// Держать в синхроне с SHADOW_MARGIN в src/clipboardpopover.tsx.
const SHADOW_MARGIN = 16;

interface WindowPopover {
  win: BrowserWindow;
  view: WebContentsView | null;
  anchor: ContentBounds;
  height: number;
  open: boolean;
  loaded: boolean;
  resizeBound: boolean;
}

const popovers = new Map<number, WindowPopover>();
let ipcRegistered = false;
let onClosedCb: ((win: BrowserWindow) => void) | null = null;

export function initClipboardPopover(onClosed: (win: BrowserWindow) => void): void {
  onClosedCb = onClosed;
}

function stateFor(win: BrowserWindow): WindowPopover {
  const existing = popovers.get(win.id);
  if (existing) return existing;
  const created: WindowPopover = {
    win, view: null, anchor: { x: 0, y: 0, width: 0, height: 0 },
    height: INITIAL_HEIGHT, open: false, loaded: false, resizeBound: false,
  };
  popovers.set(win.id, created);
  // ⚠️ Вью закрываем сами: окно не уносит с собой дочерние WebContentsView, и поповер
  // закрытого окна остался бы жить отдельным процессом (замер и разбор — viewTeardown.ts).
  win.once('closed', () => { closeWindowView(popovers.get(win.id)?.view); popovers.delete(win.id); });
  return created;
}

function stateBySender(sender: Electron.WebContents): WindowPopover | null {
  for (const st of popovers.values()) if (st.view?.webContents === sender) return st;
  return null;
}

function isAttached(st: WindowPopover): boolean {
  return !!st.view && !st.win.isDestroyed() && st.win.contentView.children.includes(st.view);
}

function computeBounds(st: WindowPopover) {
  const winBounds = st.win.isDestroyed() ? { width: 1200, height: 800 } : st.win.getContentBounds();
  const maxX = Math.max(WINDOW_MARGIN, winBounds.width - POPOVER_WIDTH - WINDOW_MARGIN);
  const cardX = Math.min(Math.max(WINDOW_MARGIN, st.anchor.x + st.anchor.width - POPOVER_WIDTH), maxX);
  const belowY = st.anchor.y + st.anchor.height + GAP;
  const aboveY = st.anchor.y - st.height - GAP;
  const cardY = belowY + st.height + WINDOW_MARGIN <= winBounds.height
    ? belowY
    : Math.max(WINDOW_MARGIN, aboveY);
  return {
    x: cardX - SHADOW_MARGIN,
    y: cardY - SHADOW_MARGIN,
    width: POPOVER_WIDTH + SHADOW_MARGIN * 2,
    height: st.height + SHADOW_MARGIN * 2,
  };
}

function layout(st: WindowPopover): void {
  if (isAttached(st)) st.view!.setBounds(computeBounds(st));
}

export function syncClipboardPopoverAnchor(win: BrowserWindow, b: ContentBounds): void {
  const st = stateFor(win);
  st.anchor = b;
  layout(st);
}

function ensureIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on('clipboard-popover:close', (e) => {
    const st = stateBySender(e.sender);
    if (st) closeClipboardPopover(st.win);
  });
  ipcMain.on('clipboard-popover:height', (e, px: number) => {
    const st = stateBySender(e.sender);
    if (!st) return;
    st.height = Math.max(1, px);
    layout(st);
  });
}

function ensureView(st: WindowPopover): WebContentsView {
  if (st.view) return st.view;
  ensureIpc();
  st.view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-clipboardpopover.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  st.view.setBackgroundColor('#00000000');
  st.view.webContents.once('did-finish-load', () => {
    st.loaded = true;
    if (st.open) st.view?.webContents.send('clipboard-popover:show');
  });
  st.view.webContents.loadURL('oblako-chrome://localhost/clipboardpopover.html');
  return st.view;
}

export function showClipboardPopover(win: BrowserWindow): void {
  const st = stateFor(win);
  st.open = true;
  if (!st.resizeBound) {
    win.on('resize', () => layout(st));
    st.resizeBound = true;
  }
  const view = ensureView(st);
  view.setBounds(computeBounds(st));
  if (!isAttached(st)) win.contentView.addChildView(view);
  if (st.loaded) view.webContents.send('clipboard-popover:show');
}

export function closeClipboardPopover(win: BrowserWindow): void {
  const st = popovers.get(win.id);
  if (!st || !st.open) return;
  st.open = false;
  if (isAttached(st)) {
    try { st.win.contentView.removeChildView(st.view!); } catch { /* окно могло закрыться */ }
  }
  if (!st.win.isDestroyed()) onClosedCb?.(st.win);
}

export function toggleClipboardPopover(win: BrowserWindow): void {
  const st = popovers.get(win.id);
  if (st?.open) closeClipboardPopover(win);
  else showClipboardPopover(win);
}

/**
 * Окно, которому принадлежит эта вью поповера.
 *
 * ⚠️ Нужно потому, что contextFromSender в main про вью поповера ничего не знает — реестр окон
 * держит только слой хрома и вкладки. А переход к источнику обязан открыть страницу В ТОМ ЖЕ окне,
 * где человек нажал: в лёгком окне кнопка буфера тоже есть, и уводить его вкладку в главное окно
 * значило бы отвечать не туда, куда смотрят.
 */
export function windowOfClipboardPopover(sender: Electron.WebContents): BrowserWindow | null {
  return stateBySender(sender)?.win ?? null;
}

/** Открыт ли поповер в этом окне — нужно хоткею, чтобы работать переключателем. */
export function isClipboardPopoverOpen(win: BrowserWindow): boolean {
  return popovers.get(win.id)?.open ?? false;
}
