// Поповер VPN у тулбарной пилюли — тот же приём, что PasswordPopoverManager.ts (отдельная
// прозрачная WebContentsView поверх страницы: DOM внутри Toolbar не подходит, нативный
// WebContentsView страницы перекрывает его независимо от z-index). Список серверов/статус
// подключения на показ он запрашивает сам через свой preload (см. preload-vpnpopover.ts) —
// но живые апдейты, пока уже открыт, main всё же толкает явно (см. broadcastVpnState ниже):
// иначе подсветка подключённого сервера обновлялась бы только при следующем открытии.
import { WebContentsView, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import type { ContentBounds, VpnConnectionState } from '../shared/ipc';
import { IPC } from '../shared/ipc';

const POPOVER_WIDTH = 300;
const INITIAL_HEIGHT = 160;
// ⚠️ ЗАЗОР ОБЯЗАН БЫТЬ НЕ МЕНЬШЕ SHADOW_MARGIN, и это не про воздух, а про мышь. Прозрачный
// запас под тень ХИТ-ТЕСТИТСЯ: вью ловит клики всем своим прямоугольником, а не видимой
// карточкой. При зазоре 6 и запасе 16 верхний край вью вставал на 10 px ВЫШЕ низа кнопки-якоря,
// то есть её нижняя треть переставала нажиматься, пока поповер открыт (закрыть поповер повторным
// кликом по кнопке получалось не всегда — как повезёт попасть выше кромки). Ровно этот же просчёт
// на дропдауне омнибокса накрывал адресную строку целиком и месяц выглядел как проблема фокуса —
// см. разбор в docs/architecture-core.md.
const GAP = 16;
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
// Домен активной вкладки для адблок-секции (заход «Защита», шаг 3) — приходит от Toolbar через
// syncVpnPopoverActiveUrl, форвардится во вью 'vpn-popover:active-url'. Держим последнее значение
// в модуле (как lastAnchorBounds выше), чтобы showVpnPopover/did-finish-load могли переотправить
// его вью, даже если сама вью на момент прихода URL ещё грузилась.
let lastActiveUrl = '';

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
    if (isOpen) {
      popoverView?.webContents.send('vpn-popover:show');
      popoverView?.webContents.send('vpn-popover:active-url', lastActiveUrl);
    }
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
  if (popoverLoaded) {
    view.webContents.send('vpn-popover:show');
    view.webContents.send('vpn-popover:active-url', lastActiveUrl);
  }
}

// Домен активной вкладки для адблок-секции — Toolbar шлёт это ПЕРЕД showVpnPopover() при открытии
// (см. Toolbar.tsx::toggleVpnPopover) и повторно при навигации в той же вкладке, пока поповер
// открыт. lastActiveUrl обновляется независимо от isOpen/popoverLoaded — так к моменту, когда
// showVpnPopover()/did-finish-load решат отправить URL во вью, значение уже свежее. Живой push
// (пока поповер уже открыт и загружен) шлём сразу же, без ожидания следующего показа.
export function syncVpnPopoverActiveUrl(url: string): void {
  lastActiveUrl = url;
  if (popoverLoaded) popoverView?.webContents.send('vpn-popover:active-url', url);
}

// Живой пуш статуса подключения в саму вью поповера — до этого коммита сюда шёл только в
// chromeView (main.ts::vpnProcess.onStateChange), а preload-vpnpopover.ts::onVpnConnectionStateChanged
// слушал этот же канал, но никто в эту WebContentsView никогда не слал: подсветка активного
// сервера обновлялась только на следующем открытии (onShow → повторный getVpnConnectionState()).
// Инкапсуляция: main зовёт эту функцию, а не тянет popoverView наружу — сам менеджер решает,
// жива ли вью (не destroyed — иначе крэш на send в мёртвый webContents) и показана ли она сейчас
// (isOpen — нет смысла толкать в закрытую, следующий showVpnPopover() и так подтянет свежее
// через onShow; popoverLoaded — до первого did-finish-load слушателя на renderer-стороне ещё нет).
export function broadcastVpnState(state: VpnConnectionState): void {
  if (!popoverView || popoverView.webContents.isDestroyed()) return;
  if (!isOpen || !popoverLoaded) return;
  popoverView.webContents.send(IPC.VPN_CONNECTION_STATE_CHANGED, state);
}

export function closeVpnPopover(): void {
  if (!isOpen) return;
  isOpen = false;
  if (isAttached()) {
    try { attachedWin!.contentView.removeChildView(popoverView!); } catch { /* окно могло уже закрыться */ }
  }
  onClosedCb?.();
}
