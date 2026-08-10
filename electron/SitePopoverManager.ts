// Поповер «сведения о сайте» — то, что открывается по замочку слева в адресной строке.
//
// Зачем. Замок был картинкой без поведения, хотя во всех браузерах это точка входа в «что за
// сайт передо мной»: защищено ли соединение, что я ему разрешил, сколько с него вырезали
// трекеров. Всё это у нас уже посчитано и лежит в разных углах настроек — не хватало места, где
// человек смотрит НА КОНКРЕТНЫЙ САЙТ, а не на список всех сайтов сразу.
//
// ⚠️ Сюда же переехало «вы это уже читали». Раньше подсказка жила в выпадашке омнибокса и
// конкурировала там с поиском вкладки по смыслу: обе фоновые, обе на одной модели, очередь на
// приложение одна — клик в строку занимал её ровно в тот момент, когда человек начинал печатать.
// Здесь конфликта нет: поповер открывают отдельным осознанным действием, и в этот момент никто
// ничего не набирает.
//
// Механика вью — ровно та же, что у DownloadsPopoverManager/VpnPopoverManager: своя прозрачная
// WebContentsView поверх страницы (DOM внутри Toolbar не годится — нативная вью страницы лежит
// выше любого z-index), высота приезжает из самой вью, позиция считается от якоря.
import { WebContentsView, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { ContentBounds } from '../shared/ipc';

const POPOVER_WIDTH = 340;
const INITIAL_HEIGHT = 220;
// ⚠️ ЗАЗОР ОБЯЗАН БЫТЬ НЕ МЕНЬШЕ SHADOW_MARGIN, и это не про воздух, а про мышь. Прозрачный
// запас под тень ХИТ-ТЕСТИТСЯ: вью ловит клики всем своим прямоугольником, а не видимой
// карточкой. При зазоре 6 и запасе 16 верхний край вью вставал на 10 px ВЫШЕ низа кнопки-якоря,
// то есть её нижняя треть переставала нажиматься, пока поповер открыт (закрыть поповер повторным
// кликом по кнопке получалось не всегда — как повезёт попасть выше кромки). Ровно этот же просчёт
// на дропдауне омнибокса накрывал адресную строку целиком и месяц выглядел как проблема фокуса —
// см. разбор в docs/architecture-core.md.
const GAP = 16;
const WINDOW_MARGIN = 8;
// Держать в синхроне с SHADOW_MARGIN в src/sitepopover.tsx.
const SHADOW_MARGIN = 16;

let popoverView: WebContentsView | null = null;
let attachedWin: BrowserWindow | null = null;
let resizeBoundWin: BrowserWindow | null = null;
let ipcRegistered = false;
let lastAnchorBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
let currentHeight = INITIAL_HEIGHT;
let isOpen = false;
// Первый показ успевает позвать send() до того, как страница поповера навесит слушателей
// (loadURL асинхронен) — тот же флаг и та же переотправка в did-finish-load, что у соседей.
let popoverLoaded = false;
let onClosedCb: ((win: BrowserWindow) => void) | null = null;

export function initSitePopover(onClosed: (win: BrowserWindow) => void): void {
  onClosedCb = onClosed;
}

function isAttached(): boolean {
  return !!popoverView && !!attachedWin && attachedWin.contentView.children.includes(popoverView);
}

// Поповер прижимается к ЛЕВОМУ краю якоря (замок стоит слева в омнибоксе), в отличие от загрузок
// и VPN — те висят у правого края своих кнопок.
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

export function syncSitePopoverAnchorBounds(b: ContentBounds): void {
  lastAnchorBounds = b;
  layoutPopover();
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on('site-popover:close', () => closeSitePopover());
  ipcMain.on('site-popover:height', (_e, px: number) => {
    currentHeight = Math.max(1, px);
    layoutPopover();
  });
}

function ensurePopoverView(): WebContentsView {
  if (popoverView) return popoverView;
  ensureIpcRegistered();
  popoverView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-sitepopover.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  popoverView.setBackgroundColor('#00000000');
  popoverView.webContents.once('did-finish-load', () => {
    popoverLoaded = true;
    if (isOpen) popoverView?.webContents.send('site-popover:show');
  });
  popoverView.webContents.loadURL('oblako-chrome://localhost/sitepopover.html');
  return popoverView;
}

export function showSitePopover(win: BrowserWindow): void {
  attachedWin = win;
  isOpen = true;
  if (resizeBoundWin !== win) {
    win.on('resize', layoutPopover);
    resizeBoundWin = win;
  }
  const view = ensurePopoverView();
  view.setBounds(computeBounds());
  if (!isAttached()) win.contentView.addChildView(view);
  // ⚠️ Показ — это ещё и сигнал «перечитай всё заново»: содержимое зависит от того, какая
  // страница открыта прямо сейчас, а вью между показами живёт.
  if (popoverLoaded) view.webContents.send('site-popover:show');
}

export function closeSitePopover(): void {
  if (!isOpen) return;
  isOpen = false;
  const win = attachedWin;
  if (isAttached()) {
    try { attachedWin!.contentView.removeChildView(popoverView!); } catch { /* окно могло уже закрыться */ }
  }
  if (win && !win.isDestroyed()) onClosedCb?.(win);
}

export function isSitePopoverOpen(): boolean {
  return isOpen;
}
