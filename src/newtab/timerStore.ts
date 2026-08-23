// Состояние таймера рабочего стола.
//
// ⚠️ Живёт в localStorage, а не в раскладке стола (`desktop.ts`). Раскладка описывает, ЧТО и ГДЕ
// стоит, и переживает переезды между профилями и импорт; идущий таймер — это состояние МОМЕНТА,
// и попадать в файл раскладки ему незачем. Заодно так он не поднимает запись раскладки на диск
// каждую секунду.
//
// ⚠️ Хранится МОМЕНТ СРАБАТЫВАНИЯ (endAt), а не остаток. Остаток пришлось бы тикать в файле, и
// после закрытия вкладки таймер «замирал» бы: открыл через полчаса — на нём те же 4:59. С
// абсолютным временем закрытая вкладка ничего не ломает, а протухший таймер видно сразу.

const KEY = 'oblako-desktop-timer';
const EVENT = 'oblako-timer-store';

export interface TimerState {
  /** Выбранная длительность, мс. */
  durationMs: number;
  /** Когда сработает, epoch ms. 0 — не идёт (пауза или сброс). */
  endAt: number;
  /** Остаток на паузе, мс. Смысл имеет только при endAt === 0. */
  leftMs: number;
}

export const TIMER_PRESETS: { id: string; label: string; ms: number }[] = [
  { id: '5', label: '5', ms: 5 * 60_000 },
  { id: '10', label: '10', ms: 10 * 60_000 },
  { id: '20', label: '20', ms: 20 * 60_000 },
];

const DEFAULT_MS = TIMER_PRESETS[1]!.ms;

export function emptyTimer(): TimerState {
  return { durationMs: DEFAULT_MS, endAt: 0, leftMs: DEFAULT_MS };
}

export function loadTimer(): TimerState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyTimer();
    const o = JSON.parse(raw) as Partial<TimerState>;
    const durationMs = num(o.durationMs, DEFAULT_MS);
    return {
      durationMs,
      endAt: num(o.endAt, 0),
      leftMs: Math.min(num(o.leftMs, durationMs), durationMs),
    };
  } catch {
    return emptyTimer();
  }
}

export function saveTimer(state: TimerState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* приватный режим или переполнение — таймер просто не переживёт перезагрузку */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Подписка на изменения — в том числе из другой вкладки (событие storage). */
export function subscribeTimer(cb: () => void): () => void {
  const handler = (): void => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

/** Сколько осталось прямо сейчас, мс. */
export function timerLeftMs(state: TimerState, now = Date.now()): number {
  if (state.endAt > 0) return Math.max(0, state.endAt - now);
  return Math.max(0, state.leftMs);
}

/** Идёт ли отсчёт (пауза и ноль — не идёт). */
export function timerRunning(state: TimerState, now = Date.now()): boolean {
  return state.endAt > now;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}
