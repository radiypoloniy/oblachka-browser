// Поповер автозаполнения — отдельная прозрачная WebContentsView поверх страницы, заякоренная на
// поле формы. Тот же приём, что PasswordPopoverManager (DOM внутри chrome перекрывается нативной
// вьюхой страницы). Показывает список сохранённых профилей (адреса; карты — заход 3); выбор
// пользователя уходит в оркестратор, который шлёт значения на подстановку в страницу.
//
// ⚠️ ПОПОВЕР — СВОЙ У КАЖДОГО ОКНА, как и у паролей: якорь считается по полю конкретной страницы,
// и выбор обязан вернуться в то окно, где кликнули.
import { WebContentsView, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { ContentBounds, AddressProfile, CardMeta } from '../shared/ipc';

const POPOVER_WIDTH = 300;
const INITIAL_HEIGHT = 120;
// ⚠️ ЗАЗОР ОБЯЗАН БЫТЬ НЕ МЕНЬШЕ SHADOW_MARGIN, и это не про воздух, а про мышь. Прозрачный
// запас под тень ХИТ-ТЕСТИТСЯ: вью ловит клики всем своим прямоугольником, а не видимой
// карточкой. При зазоре 6 и запасе 16 верхний край вью вставал на 10 px ВЫШЕ низа кнопки-якоря,
// то есть её нижняя треть переставала нажиматься, пока поповер открыт (закрыть поповер повторным
// кликом по кнопке получалось не всегда — как повезёт попасть выше кромки). Ровно этот же просчёт
// на дропдауне омнибокса накрывал адресную строку целиком и месяц выглядел как проблема фокуса —
// см. разбор в docs/architecture-core.md.
const GAP = 16;
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
  | { kind: 'save-card'; title: string; sub: string }
  // Разбор вставленной строки (AI-IDEAS.md №1): предпросмотр того, что ляжет в поля.
  // ⚠️ Показываем ЧАСТИ, а не «разложить?» одной кнопкой: цена ошибки разбора — чужой индекс
  // в форме доставки, и увидеть его человек обязан ДО подстановки, а не после отправки заказа.
  | { kind: 'parse-address'; parts: { label: string; value: string }[] };

interface WindowPopover {
  win: BrowserWindow;
  view: WebContentsView | null;
  resizeBound: boolean;
  anchor: ContentBounds;
  height: number;
  state: AutofillPopoverState | null;
}

const popovers = new Map<number, WindowPopover>();
let ipcRegistered = false;
let onClosedCb: ((win: BrowserWindow) => void) | null = null;
let onPickCb: ((win: BrowserWindow, id: number) => void) | null = null;
let onSaveCb: ((win: BrowserWindow) => void) | null = null;
let onApplyCb: ((win: BrowserWindow) => void) | null = null;

export function initAutofillPopover(
  onClosed: (win: BrowserWindow) => void,
  onPick: (win: BrowserWindow, id: number) => void,
  onSave: (win: BrowserWindow) => void,
  // ⚠️ Отдельный колбэк от onSave, а не тот же: «сохранить в сейф» и «разложить по полям» —
  // разные действия с разной ценой ошибки, и путать их в одном канале нельзя.
  onApply: (win: BrowserWindow) => void,
): void {
  onClosedCb = onClosed;
  onPickCb = onPick;
  onSaveCb = onSave;
  onApplyCb = onApply;
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

// Окно по вью-отправителю — см. ту же функцию в PasswordPopoverManager.ts.
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
  const cardX = Math.min(Math.max(WINDOW_MARGIN, st.anchor.x), maxX);
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

export function syncAutofillPopoverAnchorBounds(win: BrowserWindow, b: ContentBounds): void {
  const st = stateFor(win);
  st.anchor = b;
  layoutPopover(st);
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on('autofill-popover:close', (e) => {
    const st = stateBySender(e.sender);
    if (st) closeAutofillPopover(st.win);
  });
  ipcMain.on('autofill-popover:height', (e, px: number) => {
    const st = stateBySender(e.sender);
    if (!st) return;
    st.height = Math.max(1, px);
    layoutPopover(st);
  });
  ipcMain.on('autofill-popover:pick', (e, id: number) => {
    const st = stateBySender(e.sender);
    if (!st) return;
    onPickCb?.(st.win, id);
    closeAutofillPopover(st.win);
  });
  ipcMain.on('autofill-popover:save', (e) => {
    const st = stateBySender(e.sender);
    if (!st) return;
    onSaveCb?.(st.win);
    closeAutofillPopover(st.win);
  });
  ipcMain.on('autofill-popover:apply', (e) => {
    const st = stateBySender(e.sender);
    if (!st) return;
    onApplyCb?.(st.win);
    closeAutofillPopover(st.win);
  });
}

function ensurePopoverView(st: WindowPopover): WebContentsView {
  if (st.view) return st.view;
  ensureIpcRegistered();
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-autofillpopover.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  st.view = view;
  view.setBackgroundColor('#00000000');
  view.webContents.once('did-finish-load', () => {
    if (st.state) view.webContents.send('autofill-popover:show', st.state);
  });
  view.webContents.loadURL('oblako-chrome://localhost/autofillpopover.html');
  return view;
}

export function showAutofillPopover(win: BrowserWindow, state: AutofillPopoverState): void {
  const st = stateFor(win);
  st.state = state;
  if (!st.resizeBound) {
    win.on('resize', () => layoutPopover(st));
    st.resizeBound = true;
  }
  const view = ensurePopoverView(st);
  view.setBounds(computeBounds(st));
  if (!isAttached(st)) win.contentView.addChildView(view);
  view.webContents.send('autofill-popover:show', state);
}

export function closeAutofillPopover(win: BrowserWindow | null): void {
  if (!win) return;
  const st = popovers.get(win.id);
  if (!st) return;
  st.state = null;
  if (isAttached(st)) {
    try { st.win.contentView.removeChildView(st.view!); } catch { /* окно могло уже закрыться */ }
  }
  onClosedCb?.(st.win);
}
