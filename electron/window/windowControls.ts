import type { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc';
import { contextForWindow } from '../WindowRegistry';

/**
 * Состояние «развёрнуто» — из ОС в наш хром.
 *
 * ⚠️ Нужно потому, что кнопки окна рисует ХРОМ, а не Windows (окно создаётся с `frame: false`,
 * разбор — в src/components/toolbar/WindowControls.tsx). Глиф средней кнопки обязан меняться:
 * квадрат означает «развернуть», два наложенных квадрата — «вернуть размер». Без этой рассылки он
 * навсегда остался бы квадратом, и человек не понимал бы, что произойдёт по нажатию.
 *
 * ⚠️ Событиями, а не опросом. Развернуть окно можно мимо наших кнопок — двойным кликом по полосе,
 * Win+Стрелкой, перетаскиванием к верхнему краю, из меню окна. Опрос по таймеру отставал бы на
 * четверть секунды в самом заметном месте интерфейса, а любой «пересчитаем при рендере» промахнулся
 * бы мимо всех этих способов.
 *
 * ⚠️ Шлём В СВОЙ хром, а не broadcastToChrome: развёрнуто КАЖДОЕ окно по-своему, и общая рассылка
 * заставила бы соседнее окно нарисовать чужое состояние.
 */
export function wireWindowControls(win: BrowserWindow): void {
  const send = (): void => {
    const wc = contextForWindow(win)?.chromeView.webContents;
    if (wc && !wc.isDestroyed()) wc.send(IPC.WINDOW_MAXIMIZED, win.isMaximized());
  };
  win.on('maximize', send);
  win.on('unmaximize', send);
}
