import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { TimerState } from '../shared/ipc';

// Таймер стола: срок живёт ЗДЕСЬ, а не в виджете.
//
// ⚠️ Почему пришлось переносить. Счётчик жил в рендерере новой вкладки, то есть досчитывал
// только пока эта вкладка открыта: ушёл на сайт — некому сработать. Таймер, который молчит,
// когда человек занят чем-то другим, бесполезен ровно в том случае, ради которого его и
// заводят («отвлеки меня через двадцать минут»).
//
// ⚠️ Таймер ОБЩИЙ на приложение, а не на профиль. История, закладки и товары профильные, потому
// что это следы и рабочий контекст; таймер — не след, а просьба человека к самому себе, и терять
// её при переключении профиля было бы странно.
//
// ⚠️ Хранится МОМЕНТ СРАБАТЫВАНИЯ (endAt), а не остаток: остаток пришлось бы тикать на диск, и
// после перезапуска таймер «замирал» бы на том же числе. С абсолютным временем перезапуск
// ничего не ломает, а протухший таймер видно сразу.

const FILE = 'timer.json';

/** Длительности кнопок. Держим здесь: они же уезжают в интерфейс через состояние. */
export const TIMER_PRESETS_MS = [5 * 60_000, 10 * 60_000, 20 * 60_000];
const DEFAULT_MS = TIMER_PRESETS_MS[1]!;

let state: TimerState = { durationMs: DEFAULT_MS, endAt: 0, leftMs: DEFAULT_MS };
let handle: NodeJS.Timeout | null = null;
let onFire: ((state: TimerState) => void) | null = null;
let onChange: ((state: TimerState) => void) | null = null;
let loaded = false;

function filePath(): string {
  return path.join(app.getPath('userData'), FILE);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * Поднять состояние с диска.
 *
 * ⚠️ Уже просроченный таймер НЕ стреляет уведомлением при запуске. Сигнал через час после
 * события — это не напоминание, а недоумение: человек уже давно занят другим. Просроченный
 * просто считается остановленным на нуле, и виджет честно показывает 0:00.
 */
export function initTimer(handlers: {
  onFire: (state: TimerState) => void;
  onChange: (state: TimerState) => void;
}): void {
  onFire = handlers.onFire;
  onChange = handlers.onChange;
  if (!loaded) {
    loaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as Partial<TimerState>;
      const durationMs = num(raw.durationMs, DEFAULT_MS);
      state = {
        durationMs,
        endAt: num(raw.endAt, 0),
        leftMs: Math.min(num(raw.leftMs, durationMs), durationMs),
      };
    } catch { /* файла нет или он битый — таймер просто не идёт */ }
    if (state.endAt > 0 && state.endAt <= Date.now()) state = { ...state, endAt: 0, leftMs: 0 };
  }
  schedule();
}

export function getTimer(): TimerState {
  return state;
}

/**
 * Поставить состояние целиком — старт, пауза, сброс и выбор длительности приходят одним каналом.
 *
 * ⚠️ Один канал, а не четыре: состояние таймера это три числа, и любая операция над ним —
 * просто другая тройка. Четыре канала означали бы четыре места, где можно разойтись с
 * инвариантом «endAt и leftMs не бывают заданы одновременно».
 */
export function setTimer(next: Partial<TimerState>): TimerState {
  const durationMs = num(next.durationMs, state.durationMs);
  const endAt = num(next.endAt, 0);
  state = {
    durationMs,
    endAt,
    // Пока таймер идёт, остаток не хранится — он вычисляется из endAt (см. шапку).
    leftMs: endAt > 0 ? 0 : Math.min(num(next.leftMs, state.leftMs), durationMs),
  };
  persist();
  schedule();
  onChange?.(state);
  return state;
}

function persist(): void {
  try {
    fs.writeFileSync(filePath(), JSON.stringify(state), 'utf8');
  } catch (e) {
    console.warn('[timer] не удалось сохранить состояние:', (e as Error).message);
  }
}

/**
 * Завести системный таймер до срабатывания.
 *
 * ⚠️ setTimeout, а не опрос раз в секунду: главный процесс не должен просыпаться шестьдесят раз
 * в минуту ради числа, которое и так известно. Отсчёт для глаз рисует виджет у себя.
 *
 * ⚠️ Дальний срок ставится ЧАСТЯМИ. setTimeout в Node переполняется на 2^31 мс (~24,8 суток) и
 * срабатывает НЕМЕДЛЕННО — таймер на месяц выстрелил бы сразу. Наши кнопки столько не дают, но
 * состояние приходит из рендерера, и опираться на «оттуда не придёт» нельзя.
 */
const MAX_DELAY = 2_147_483_000;
function schedule(): void {
  if (handle) { clearTimeout(handle); handle = null; }
  if (state.endAt <= 0) return;
  const left = state.endAt - Date.now();
  if (left <= 0) { fire(); return; }
  handle = setTimeout(() => { handle = null; schedule(); }, Math.min(left, MAX_DELAY));
}

function fire(): void {
  state = { ...state, endAt: 0, leftMs: 0 };
  persist();
  onFire?.(state);
  onChange?.(state);
}
