import { BrowserWindow } from 'electron';
import type { WebContents, WebContentsView } from 'electron';
import type { TabManager } from './TabManager';

// ── Реестр окон ───────────────────────────────────────────────────────────────
//
// Зачем. Сегодня окно ровно одно, и main.ts держит его вместе с менеджером вкладок и слоем
// хрома в модульных переменных. Пока окно одно — это работает; как только их станет два,
// каждый обработчик IPC обязан понимать, ОТ КАКОГО окна пришёл вызов, иначе клик в новом
// окне будет менять вкладки в старом.
//
// Здесь заведён контекст окна и способ найти его по отправителю сообщения. Сам переезд
// обработчиков на этот способ идёт постепенно: реестр появляется первым, чтобы переходить
// можно было по одному вызову, а не одним прыжком на шестьдесят.
//
// Разделение ролей окна — из замысла: полное окно с сайдбаром и деревом вкладок ровно одно,
// дополнительные лёгкие — без дерева. Отсюда роль в контексте, а не просто список окон.

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

export function registerWindow(ctx: WindowContext): void {
  contexts.set(ctx.win.id, ctx);
  ctx.win.once('closed', () => { contexts.delete(ctx.win.id); });
}

export function contextForWindow(win: BrowserWindow | null): WindowContext | null {
  return win ? contexts.get(win.id) ?? null : null;
}

// Контекст по отправителю IPC. ⚠️ Сообщения приходят не только из окна: слой хрома и все
// оверлеи (поповеры, панель, выпадашка) живут в собственных WebContents, у которых своё
// окно-владелец. fromWebContents для дочерней вью возвращает null, поэтому спускаемся к
// хозяину через сравнение с зарегистрированными слоями хрома.
export function contextFromSender(sender: WebContents): WindowContext | null {
  const direct = contextForWindow(BrowserWindow.fromWebContents(sender));
  if (direct) return direct;
  for (const ctx of contexts.values()) {
    if (ctx.chromeView.webContents === sender) return ctx;
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
