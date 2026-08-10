// Поповер паролей — отдельная прозрачная WebContentsView поверх страницы, как FindBar и
// SuggestDropdown. DOM внутри Toolbar не подходит: нативный WebContentsView страницы перекрывает
// его независимо от z-index.
//
// ⚠️ ПОПОВЕР — СВОЙ У КАЖДОГО ОКНА (та же причина, что у FindBarManager/SuggestDropdownManager):
// он заякорен на поле конкретной страницы, и якорь из окна B двигал бы карточку, висящую над
// окном A. Состояние — в карте по id окна, умирает вместе с окном.
import { WebContentsView, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { ContentBounds, PasswordIndicatorState } from '../shared/ipc';

const POPOVER_WIDTH = 280;
const INITIAL_HEIGHT = 150;
// ⚠️ ЗАЗОР ОБЯЗАН БЫТЬ НЕ МЕНЬШЕ SHADOW_MARGIN, и это не про воздух, а про мышь. Прозрачный
// запас под тень ХИТ-ТЕСТИТСЯ: вью ловит клики всем своим прямоугольником, а не видимой
// карточкой. При зазоре 6 и запасе 16 верхний край вью вставал на 10 px ВЫШЕ низа кнопки-якоря,
// то есть её нижняя треть переставала нажиматься, пока поповер открыт (закрыть поповер повторным
// кликом по кнопке получалось не всегда — как повезёт попасть выше кромки). Ровно этот же просчёт
// на дропдауне омнибокса накрывал адресную строку целиком и месяц выглядел как проблема фокуса —
// см. разбор в docs/architecture-core.md.
const GAP = 16;
const WINDOW_MARGIN = 8;
// Держать в синхроне с SHADOW_MARGIN в src/passwordpopover.tsx.
const SHADOW_MARGIN = 16;

interface WindowPopover {
  win: BrowserWindow;
  view: WebContentsView | null;
  resizeBound: boolean;
  anchor: ContentBounds;
  height: number;
  state: PasswordIndicatorState | null;
}

const popovers = new Map<number, WindowPopover>();
let ipcRegistered = false;
let onClosedCb: ((win: BrowserWindow) => void) | null = null;

export function initPasswordPopover(onClosed: (win: BrowserWindow) => void): void {
  onClosedCb = onClosed;
}

function stateFor(win: BrowserWindow): WindowPopover {
  const existing = popovers.get(win.id);
  if (existing) return existing;
  const created: WindowPopover = {
    win, view: null, resizeBound: false,
    anchor: { x: 0, y: 0, width: 0, height: 0 },
    height: INITIAL_HEIGHT, state: null,
  };
  popovers.set(win.id, created);
  win.once('closed', () => { popovers.delete(win.id); });
  return created;
}

// Окно по вью-отправителю: каналы поповера общие на все окна, а BrowserWindow.fromWebContents
// для дочерней вью возвращает null (тот же случай, что в WindowRegistry.contextFromSender).
function stateBySender(sender: Electron.WebContents): WindowPopover | null {
  for (const st of popovers.values()) if (st.view?.webContents === sender) return st;
  return null;
}

function isAttached(st: WindowPopover): boolean {
  return !!st.view && !st.win.isDestroyed() && st.win.contentView.children.includes(st.view);
}

function computeBounds(st: WindowPopover): { x: number; y: number; width: number; height: number } {
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

function layoutPopover(st: WindowPopover): void {
  if (!isAttached(st)) return;
  st.view!.setBounds(computeBounds(st));
}

export function syncPasswordPopoverAnchorBounds(win: BrowserWindow, b: ContentBounds): void {
  const st = stateFor(win);
  st.anchor = b;
  layoutPopover(st);
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on('password-popover:close', (e) => {
    const st = stateBySender(e.sender);
    if (st) closePasswordPopover(st.win);
  });
  ipcMain.on('password-popover:height', (e, px: number) => {
    const st = stateBySender(e.sender);
    if (!st) return;
    st.height = Math.max(1, px);
    layoutPopover(st);
  });
}

function ensurePopoverView(st: WindowPopover): WebContentsView {
  if (st.view) return st.view;
  ensureIpcRegistered();
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-passwordpopover.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  st.view = view;
  view.setBackgroundColor('#00000000');
  view.webContents.once('did-finish-load', () => {
    if (st.state) view.webContents.send('password-popover:show', st.state);
  });
  view.webContents.loadURL('oblako-chrome://localhost/passwordpopover.html');
  return view;
}

export function showPasswordPopover(win: BrowserWindow, state: PasswordIndicatorState): void {
  const st = stateFor(win);
  st.state = state;
  if (!st.resizeBound) {
    win.on('resize', () => layoutPopover(st));
    st.resizeBound = true;
  }
  const view = ensurePopoverView(st);
  view.setBounds(computeBounds(st));
  if (!isAttached(st)) win.contentView.addChildView(view);
  view.webContents.send('password-popover:show', state);
}

export function closePasswordPopover(win: BrowserWindow | null): void {
  if (!win) return;
  const st = popovers.get(win.id);
  if (!st) return;
  st.state = null;
  if (isAttached(st)) {
    try { st.win.contentView.removeChildView(st.view!); } catch { /* окно могло уже закрыться */ }
  }
  onClosedCb?.(st.win);
}
