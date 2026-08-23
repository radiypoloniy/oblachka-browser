// Пресеты таймера и чтение его состояния.
//
// ⚠️ САМО СОСТОЯНИЕ ЗДЕСЬ БОЛЬШЕ НЕ ХРАНИТСЯ. Оно переехало в главный процесс
// (electron/TimerService.ts), потому что счётчик в рендерере досчитывал только пока открыта
// новая вкладка: ушёл на сайт — сработать некому, и таймер молчал ровно в том случае, ради
// которого его заводят. Здесь остались длительности кнопок и две чистые функции чтения — их
// зовёт виджет, и держать их рядом с интерфейсом дешевле, чем гонять за ними в main.
import type { TimerState } from '../../shared/ipc';

export const TIMER_PRESETS: { id: string; label: string; ms: number }[] = [
  { id: '5', label: '5', ms: 5 * 60_000 },
  { id: '10', label: '10', ms: 10 * 60_000 },
  { id: '20', label: '20', ms: 20 * 60_000 },
];

/** Сколько осталось прямо сейчас, мс. */
export function timerLeftMs(state: TimerState, now = Date.now()): number {
  if (state.endAt > 0) return Math.max(0, state.endAt - now);
  return Math.max(0, state.leftMs);
}

/** Идёт ли отсчёт (пауза и ноль — не идёт). */
export function timerRunning(state: TimerState, now = Date.now()): boolean {
  return state.endAt > now;
}

