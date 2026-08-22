// Фаза суток и положение светила на дуге — чистая логика для виджета часов.
//
// ⚠️ ГЛАВНОЕ ИСПРАВЛЕНИЕ 22.08: НОЧЬЮ ПО ДУГЕ ИДЁТ ЛУНА. Раньше ночная позиция считалась
// «ниже горизонта», и луна лежала на линии в углу плитки — со стороны это читалось как баг
// («луна хрен знает где»), а не как замысел. Так делают и настоящие приложения такого рода
// (Sundial, Sloww): у луны СВОЯ дуга по ночному небу, от заката к восходу.
//
// ⚠️ Фаз ШЕСТЬ, а не две. Небо «день/ночь» переключалось скачком и выглядело бедно: в 21:15
// рисовалась та же ночь, что в 3 часа. Сумерки — это отдельное состояние неба, и именно они
// дают картинке настроение.
//
// Значимых импортов нет — проверка scripts/day-phase-check.mjs гоняет модуль голым node.

export type DayPhase = 'night' | 'dawn' | 'sunrise' | 'day' | 'sunset' | 'dusk';

export const MINUTES_IN_DAY = 24 * 60;

/** Ширина сумеречного окна вокруг восхода и заката, минут. */
export const TWILIGHT_MIN = 45;

function norm(min: number): number {
  return ((min % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
}

/** Расстояние между двумя моментами суток по кругу (всегда 0…720). */
export function circularDistance(a: number, b: number): number {
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, MINUTES_IN_DAY - d);
}

/**
 * Какая сейчас фаза суток.
 *
 * ⚠️ Сумерки считаются ПО РАССТОЯНИЮ ДО СОБЫТИЯ, а не по отрезку «восход…восход+45»: иначе
 * рассвет заканчивался бы ровно в момент восхода, хотя небо светлеет и до, и после.
 */
export function dayPhase(nowMin: number, sunriseMin: number, sunsetMin: number): DayPhase {
  const now = norm(nowMin);
  const rise = norm(sunriseMin);
  const set = norm(sunsetMin);
  const isDay = rise < set ? now >= rise && now < set : now >= rise || now < set;

  if (circularDistance(now, rise) <= TWILIGHT_MIN) return isDay ? 'sunrise' : 'dawn';
  if (circularDistance(now, set) <= TWILIGHT_MIN) return isDay ? 'sunset' : 'dusk';
  return isDay ? 'day' : 'night';
}

export interface ArcPosition {
  /** Доля пути по ВИДИМОЙ дуге: 0 — только взошло, 1 — вот-вот сядет. */
  frac: number;
  /** Кто сейчас на дуге. */
  body: 'sun' | 'moon';
}

/**
 * Где светило на дуге.
 *
 * ⚠️ Дуга ОДНА и та же для солнца и луны — меняется только светило и небо под ним. Так проще
 * читается и так устроены референсы: человек видит «сколько прошло и сколько осталось»
 * одинаково днём и ночью.
 */
export function arcPosition(nowMin: number, sunriseMin: number, sunsetMin: number): ArcPosition {
  const now = norm(nowMin);
  const rise = norm(sunriseMin);
  const set = norm(sunsetMin);
  const isDay = rise < set ? now >= rise && now < set : now >= rise || now < set;

  if (isDay) {
    const len = norm(set - rise) || MINUTES_IN_DAY;
    return { frac: clamp01(norm(now - rise) / len), body: 'sun' };
  }
  const len = norm(rise - set) || MINUTES_IN_DAY;
  return { frac: clamp01(norm(now - set) / len), body: 'moon' };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Сколько минут осталось до заката (днём) или до восхода (ночью). Всегда положительное. */
export function minutesUntilNextEvent(nowMin: number, sunriseMin: number, sunsetMin: number): number {
  const now = norm(nowMin);
  const rise = norm(sunriseMin);
  const set = norm(sunsetMin);
  const isDay = rise < set ? now >= rise && now < set : now >= rise || now < set;
  return norm((isDay ? set : rise) - now);
}

/**
 * Небо фазы: снизу вверх, как в настоящем небе — у горизонта теплее и светлее.
 *
 * ⚠️ Это НЕ токены темы, и так задумано: небо здесь — носитель настроения, ровно как цвет у
 * погоды. Цветовой закон говорит про хром, а плитка часов — содержимое.
 */
export function skyStops(phase: DayPhase): [string, string, string] {
  switch (phase) {
    case 'dawn':    return ['#2A3358', '#5C5480', '#C97F8A'];
    case 'sunrise': return ['#5B8FD0', '#E39B77', '#F6C88B'];
    case 'day':     return ['#3C82D6', '#79B4E9', '#CFE6F7'];
    case 'sunset':  return ['#3D5A96', '#D8804F', '#F2B770'];
    case 'dusk':    return ['#1E2A50', '#3E3D6B', '#8A5E7E'];
    case 'night':   return ['#0F1836', '#1B2A4E', '#33456F'];
  }
}

/** Тёплое ли сейчас небо — от этого зависит, каким цветом рисуется пройденный путь. */
export function isWarmPhase(phase: DayPhase): boolean {
  return phase === 'sunrise' || phase === 'sunset' || phase === 'day';
}

/**
 * Звёзды: детерминированные позиции в долях 0…1.
 *
 * ⚠️ Не Math.random(): позиции обязаны быть ОДНИМИ И ТЕМИ ЖЕ между перерисовками, иначе небо
 * мерцает каждую минуту при обновлении времени. Простой хеш вместо генератора — здесь не нужна
 * статистика, нужна повторяемость.
 */
export function starField(count = 28): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 1; i <= count; i++) {
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const b = Math.sin(i * 78.233) * 12345.6789;
    const x = a - Math.floor(a);
    const y = b - Math.floor(b);
    out.push({
      x,
      // Звёзды жмутся к верхней половине: у горизонта их перекрывает свечение.
      y: y * 0.62,
      r: 0.5 + (x * 0.9),
    });
  }
  return out;
}
