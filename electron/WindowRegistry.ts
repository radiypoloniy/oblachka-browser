import { BrowserWindow, webContents } from 'electron';
import type { WebContents, WebContentsView } from 'electron';
import type { TabManager } from './TabManager';

// ── Реестр окон ───────────────────────────────────────────────────────────────
//
// Оконные команды разрешаются только по явному владельцу вью интерфейса; неизвестный
// отправитель не выбирает главное окно. Владение страницами и политика внешних ссылок
// отделены от этого разрешения. Роли main/light пока остаются до миграции сессии и AI.

// Тип роли живёт в общем контракте: её знает и renderer (лёгкое окно рисует меньше).
export type { WindowRole } from '../shared/ipc';
import type { WindowRole } from '../shared/ipc';

export interface WindowContext {
  win: BrowserWindow;
  // Слой нашего интерфейса поверх окна. У лёгкого окна он тоже свой — просто рисует
  // хром без сайдбара.
  chromeView: WebContentsView;
  tabs: TabManager;
  role: WindowRole;
}

const contexts = new Map<number, WindowContext>();
// Только вью нашего интерфейса регистрируются как отправители оконных команд.
// Страницы сайтов разрешаются отдельно и не получают права chrome через владение окном.
const interfaceOwners = new WeakMap<WebContents, BrowserWindow>();
const pageOwners = new WeakMap<WebContents, BrowserWindow>();
const focusOrder: number[] = [];

export function registerWindowContents(win: BrowserWindow, contents: WebContents): void {
  interfaceOwners.set(contents, win);
}

// Веб-приложения панели не входят в дерево TabManager, но имеют владельца для разрешений.
export function registerPageContents(win: BrowserWindow, contents: WebContents): void {
  pageOwners.set(contents, win);
}

export function registerWindow(ctx: WindowContext): void {
  contexts.set(ctx.win.id, ctx);
  registerWindowContents(ctx.win, ctx.chromeView.webContents);
  focusOrder.push(ctx.win.id);
  ctx.win.on('focus', () => {
    const index = focusOrder.indexOf(ctx.win.id);
    if (index >= 0) focusOrder.splice(index, 1);
    focusOrder.unshift(ctx.win.id);
  });
  ctx.win.once('closed', () => {
    contexts.delete(ctx.win.id);
    const index = focusOrder.indexOf(ctx.win.id);
    if (index >= 0) focusOrder.splice(index, 1);
  });
}

export function contextForWindow(win: BrowserWindow | null): WindowContext | null {
  return win && !win.isDestroyed() ? contexts.get(win.id) ?? null : null;
}

// Контекст доверенной вью интерфейса. fromWebContents не определяет права отправителя:
// в разных версиях Electron он может находить окно и для страницы сайта.
export function contextFromSender(sender: WebContents): WindowContext | null {
  if (sender.isDestroyed()) return null;
  return contextForWindow(interfaceOwners.get(sender) ?? null);
}

// Разрешения и загрузки приходят от страницы, даже когда её view не прикреплена к окну.
export function contextForPageWebContents(wcId: number): WindowContext | null {
  const tabOwner = allContexts().find((ctx) => !ctx.win.isDestroyed() && ctx.tabs.ownsWebContents(wcId));
  if (tabOwner) return tabOwner;
  const contents = webContents.fromId(wcId);
  return contents ? contextForWindow(pageOwners.get(contents) ?? null) : null;
}

// Политика для внешних ссылок и общих уведомлений; не fallback для неизвестного IPC.
export function preferredContext(): WindowContext | null {
  const focused = contextForWindow(BrowserWindow.getFocusedWindow());
  if (focused) return focused;
  for (const id of focusOrder) {
    const ctx = contexts.get(id);
    if (ctx && !ctx.win.isDestroyed()) return ctx;
  }
  return null;
}

// Полное окно ровно одно — оно владеет деревом вкладок и, что важнее, сессией.
export function mainContext(): WindowContext | null {
  for (const ctx of contexts.values()) if (ctx.role === 'main') return ctx;
  return null;
}

export function allContexts(): WindowContext[] {
  return [...contexts.values()];
}

// Пуш в слой хрома ВСЕХ окон. Состояние приложения — закладки, пароли, автозаполнение, VPN,
// адблок, загрузки, модели, обновления — окну не принадлежит: файл на диске один, а копия списка
// у каждого окна своя. Окно, не получившее сообщение, показывало бы устаревшее, и «добавил
// закладку тут — её нет там» выглядело бы как потеря данных.
//
// ⚠️ Оконное состояние так рассылать НЕЛЬЗЯ: дерево вкладок, фокус омнибокса, поповеры, прогресс
// перевода страницы принадлежат конкретному окну — для них есть contextFromSender.
export function broadcastToChrome(channel: string, ...args: unknown[]): void {
  for (const ctx of contexts.values()) {
    const wc = ctx.chromeView.webContents;
    if (!wc.isDestroyed()) wc.send(channel, ...args);
  }
}
