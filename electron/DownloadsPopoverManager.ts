// Поповер загрузок у одноимённой кнопки тулбара — тот же приём, что VpnPopoverManager.ts
// (отдельная прозрачная WebContentsView поверх страницы: DOM внутри Toolbar не годится, нативная
// вью страницы перекрывает его независимо от z-index).
//
// ⚠️ Отличие от VPN: содержимое здесь ЖИВОЕ. Пока поповер открыт, прогресс капает раз в 200 мс,
// и без явного пуша в саму вью (broadcastDownloads ниже) полоска замерла бы до переоткрытия —
// DOWNLOADS_CHANGED из main уходит только в chromeView.
import { WebContentsView, ipcMain, webContents } from 'electron';
import type { BrowserWindow, InputEvent, WebContents } from 'electron';
import path from 'node:path';
import type { ContentBounds, DownloadEntry, DuplicateDownloadPrompt, DuplicateDownloadDecision } from '../shared/ipc';
import { IPC } from '../shared/ipc';
import { OVERLAY_GAP as GAP, OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';

const POPOVER_WIDTH = 360;
const INITIAL_HEIGHT = 180;
// Зазор от якоря и запас под тень — общие для всех якорных поповеров, см. shared/overlayMetrics.ts
// (там же разбор, почему зазор не может быть меньше запаса: прозрачное поле хит-теститься).
const WINDOW_MARGIN = 8;


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
  ipcMain.on(IPC.DOWNLOADS_POPOVER_CLOSE, () => closeDownloadsPopover());
  ipcMain.on('downloads-popover:height', (_e, px: number) => {
    currentHeight = Math.max(1, px);
    layoutPopover();
  });
  ipcMain.on(IPC.DOWNLOADS_POPOVER_OPEN_ALL, () => {
    const win = attachedWin;
    closeDownloadsPopover();
    if (win) onOpenAllCb?.(win);
  });
  ipcMain.handle(IPC.DOWNLOAD_DUPLICATE_PROMPT, () => pendingPrompt);
  ipcMain.on(IPC.DOWNLOAD_DUPLICATE_DECIDE, (_e, decision: DuplicateDownloadDecision) => {
    resolveDuplicatePrompt(decision);
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
  const startedAt = Date.now();
  popoverView.webContents.once('did-finish-load', () => {
    popoverLoaded = true;
    console.log(`[popover:downloads] документ готов за ${Date.now() - startedAt} мс`);
    if (isOpen) popoverView?.webContents.send(IPC.DOWNLOADS_POPOVER_SHOW);
    // Вопрос мог прийти РАНЬШЕ, чем страница поповера догрузилась (первый показ) — досылаем.
    if (pendingPrompt) popoverView?.webContents.send(IPC.DOWNLOAD_DUPLICATE_PROMPT, pendingPrompt);
  });
  popoverView.webContents.loadURL('oblako-chrome://localhost/downloadspopover.html');
  return popoverView;
}

/**
 * Прогрев: создать вью и загрузить её документ ЗАРАНЕЕ, не показывая.
 *
 * ⚠️ Первый показ поповера — это не «нарисовать карточку», а построить целый документ: новый
 * рендер-процесс, загрузка oblako-chrome://…html, React, шрифты, первый кадр. Между показами вью
 * ЖИВЁТ, поэтому второй клик мгновенный, — ровно то, что человек описывает как «первый раз
 * тормозит, дальше нормально».
 *
 * ⚠️ Прогреваются не все девять поповеров, и это осознанно: каждая вью — процесс, и девять
 * процессов ради интерфейса, который в этом сеансе могут не открыть ни разу, обменяли бы жалобу
 * на задержку на жалобу к памяти. Прогреваются только те, что открывает САМ ЧЕЛОВЕК и часто
 * (см. вызовы в main.ts); те, что открывает страница (пароли, разрешения, автозаполнение),
 * остаются ленивыми.
 *
 * Не бросает наружу — как prewarmDropZones и prewarmPanel: сбой прогрева обязан оставить фичу
 * ленивой, а не уронить старт.
 */
export function prewarmDownloadsPopover(): void {
  try {
    ensurePopoverView();
  } catch (e) {
    console.error('[popover:downloads] прогрев упал:', e);
  }
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
  if (popoverLoaded) view.webContents.send(IPC.DOWNLOADS_POPOVER_SHOW);
}

// Живой список в открытую вью. Инкапсуляция та же, что у broadcastVpnState: main зовёт функцию,
// а менеджер сам решает, жива ли вью (не destroyed — иначе крэш на send) и есть ли смысл слать
// (закрытая всё равно перезапросит список на следующем показе).
export function broadcastDownloads(entries: DownloadEntry[]): void {
  if (!popoverView || popoverView.webContents.isDestroyed()) return;
  if (!isOpen || !popoverLoaded) return;
  popoverView.webContents.send(IPC.DOWNLOADS_CHANGED, entries);
}

// ── Вопрос «этот файл уже скачан» ───────────────────────────────────────────
// ⚠️ Отдельного поповера под него НЕ заводим: он висит у того же значка загрузок и говорит про
// загрузку — это то же место. Карточка просто показывает вопрос вместо списка.
let pendingPrompt: DuplicateDownloadPrompt | null = null;
let onDecisionCb: ((askId: string, decision: DuplicateDownloadDecision) => void) | null = null;

export function setDuplicateDecisionHandler(fn: (askId: string, decision: DuplicateDownloadDecision) => void): void {
  onDecisionCb = fn;
}

export function setDuplicatePrompt(prompt: DuplicateDownloadPrompt | null): void {
  pendingPrompt = prompt;
  if (!popoverView || popoverView.webContents.isDestroyed()) return;
  if (popoverLoaded) popoverView.webContents.send(IPC.DOWNLOAD_DUPLICATE_PROMPT, prompt);
}

export function getDuplicatePrompt(): DuplicateDownloadPrompt | null {
  return pendingPrompt;
}

/** Ответ человека (кнопка в карточке). Закрывает поповер: вопрос отвечен. */
export function resolveDuplicatePrompt(decision: DuplicateDownloadDecision): void {
  const prompt = pendingPrompt;
  pendingPrompt = null;
  if (prompt) onDecisionCb?.(prompt.askId, decision);
  setDuplicatePrompt(null);
  closeDownloadsPopover();
}

export function closeDownloadsPopover(): void {
  endDownloadsFileDrag();
  if (!isOpen) return;
  isOpen = false;
  // ⚠️ Закрыли, не ответив (клик мимо, смена вкладки) — это ОТКАЗ от загрузки. Молча качать
  // второй раз то, о чём человек не сказал «да», нельзя; а бросить загрузку висеть на паузе
  // нельзя тем более — она так и осталась бы в подвешенном состоянии до конца сеанса.
  if (pendingPrompt) {
    const askId = pendingPrompt.askId;
    pendingPrompt = null;
    onDecisionCb?.(askId, 'cancel');
    if (popoverView && !popoverView.webContents.isDestroyed() && popoverLoaded) {
      popoverView.webContents.send(IPC.DOWNLOAD_DUPLICATE_PROMPT, null);
    }
  }
  const win = attachedWin;
  if (isAttached()) {
    try { attachedWin!.contentView.removeChildView(popoverView!); } catch { /* окно могло уже закрыться */ }
  }
  if (win && !win.isDestroyed()) onClosedCb?.(win);
}

// ── OS-drag файла из карточки ────────────────────────────────────────────────
//
// ⚠️ Поповер — отдельная WebContentsView поверх страницы. Нативный startDrag идёт с ЭТОЙ вью,
// и закрывать её в dragstart нельзя: removeChildView оборвёт жест. У View в Electron 42 нет
// setIgnoreMouseEvents (он только у окна), поэтому на время жеста прячем карточку setVisible(false):
// хит-тест проходит на страницу, drop в <input type="file"> доходит, webContents жив.
//
// Конец жеста renderer после preventDefault на dragstart часто не присылает. Смотрим mouseUp
// на всех вью и blur окна — тот же приём, что у DropZoneManager. Escape во время OS-drag
// система часто съедает сама.

const FILE_DRAG_MAX_MS = 60_000;

let fileDrag: { timer: ReturnType<typeof setTimeout>; unwatch: () => void } | null = null;

export function beginDownloadsFileDrag(sender: WebContents): void {
  if (!popoverView || popoverView.webContents !== sender) return;
  endDownloadsFileDrag();
  try { popoverView.setVisible(false); } catch { /* вью могла уже сняться */ }

  const win = attachedWin;
  const watched: WebContents[] = [];
  const startedAt = Date.now();
  const finish = (): void => { endDownloadsFileDrag(); };
  const onInput = (_e: Electron.Event, input: InputEvent): void => {
    // startDrag иногда синтезирует mouseUp в том же тике, что dragstart — это не конец жеста.
    if (Date.now() - startedAt < 250) return;
    if (input.type === 'mouseUp') finish();
  };
  if (win && !win.isDestroyed()) win.on('blur', finish);
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    wc.on('input-event', onInput);
    watched.push(wc);
  }
  fileDrag = {
    timer: setTimeout(finish, FILE_DRAG_MAX_MS),
    unwatch: () => {
      if (win && !win.isDestroyed()) win.removeListener('blur', finish);
      for (const wc of watched) {
        if (!wc.isDestroyed()) wc.removeListener('input-event', onInput);
      }
    },
  };
}

export function endDownloadsFileDrag(): void {
  if (fileDrag) {
    clearTimeout(fileDrag.timer);
    fileDrag.unwatch();
    fileDrag = null;
  }
  if (popoverView && !popoverView.webContents.isDestroyed() && isOpen) {
    try { popoverView.setVisible(true); } catch { /* окно могло закрыться */ }
  }
}

