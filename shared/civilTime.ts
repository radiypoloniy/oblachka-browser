// Гражданские часы в поясе: «18:45 в Москве» → один момент, и обратно.
//
// ⚠️ Без таблицы сдвигов. Летнее время, Индия (+5:30) и Непал (+5:45) иначе врут ровно
// на тех случаях, ради которых человек и открыл конвертер. Считаем через Intl.
//
// Значимых импортов нет — проверка scripts/civil-time-check.mjs гоняет модуль голым node.

/** Шаг шкалы суток. Четверть часа закрывает живые договорённости и не дробит полосу. */
export const CLOCK_STEP_MIN = 15;
export const DAY_MINUTES = 24 * 60;
/** Правый край шкалы — 23:45, не 24:00. 24:00 это следующие сутки, и курсор на краю
 *  накручивал дни пачками (живой кадр: сентябрь уехал в декабрь, EDT стал EST). */
export const DAY_MAX_MINUTES = DAY_MINUTES - CLOCK_STEP_MIN;

export interface ClockHm {
  h: number;
  m: number;
}

/** Стена в поясе: дата и часы, как их написали бы на бумаге. */
export interface ZoneWall {
  y: number;
  mo: number;
  d: number;
  h: number;
  m: number;
}

export function formatHm(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 11:45 pm — как пишут в США. 12 am это полночь, 12 pm это полдень. */
export function formatClock(h: number, m: number, hour12: boolean): string {
  if (!hour12) return formatHm(h, m);
  const period = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Разбор того, что человек набрал в поле времени.
 *
 * ⚠️ Принимаем 18:45, 1845, 18.45, голое 18 и американское 11:45pm. 24:00 на шкале нет:
 * это следующие сутки, и ввод «24:00» даёт 23:45 — последний слот этих суток.
 */
export function parseClock(raw: string): ClockHm | null {
  let t = raw.trim().toLowerCase().replace('.', ':').replace(/\s/g, '');
  let period: 'am' | 'pm' | null = null;
  if (t.endsWith('am') || t.endsWith('pm')) {
    period = t.endsWith('am') ? 'am' : 'pm';
    t = t.slice(0, -2);
  }
  let h: number;
  let m = 0;
  if (/^\d{3,4}$/.test(t)) {
    const n = t.padStart(4, '0');
    h = Number(n.slice(0, 2));
    m = Number(n.slice(2));
  } else {
    const mm = t.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if (!mm) return null;
    h = Number(mm[1]);
    m = mm[2] !== undefined ? Number(mm[2]) : 0;
  }
  if (m < 0 || m > 59) return null;
  if (period) {
    if (h < 1 || h > 12) return null;
    if (period === 'am') h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h === 24 && m === 0) {
    return clampClock({ h: 24, m: 0 });
  } else if (h < 0 || h > 23) {
    return null;
  }
  return clampClock({ h, m });
}

function clockSuffix(raw: string): { body: string; suffix: string } {
  const t = raw.trim().toLowerCase();
  if (t.endsWith('am') || t.endsWith('pm')) return { body: t.slice(0, -2), suffix: t.slice(-2) };
  if (t.endsWith('a') || t.endsWith('p')) return { body: t.slice(0, -1), suffix: t.slice(-1) };
  return { body: t, suffix: '' };
}

/**
 * Черновик поля: после двух цифр часов сами ставим двоеточие.
 *
 * ⚠️ Не при стирании. Иначе «18:» → Backspace → «18» → снова «18:», и двоеточие нельзя убрать.
 */
export function maskClockInput(raw: string, previous = ''): string {
  const cur = clockSuffix(raw);
  const prev = clockSuffix(previous);
  const digits = cur.body.replace(/\D/g, '').slice(0, 4);
  const prevDigits = prev.body.replace(/\D/g, '').slice(0, 4);
  const suffix = cur.suffix ? ` ${cur.suffix}` : '';
  if (digits.length < 2) return digits + suffix;
  if (digits.length === 2) {
    // Стёрли только автодвоеточие — не возвращаем его, иначе Backspace зациклится.
    const droppedColon = prevDigits === digits && prev.body.includes(':') && !cur.body.includes(':');
    return droppedColon ? digits + suffix : `${digits}:${suffix}`;
  }
  return `${digits.slice(0, 2)}:${digits.slice(2)}${suffix}`;
}

/**
 * Держит часы в сутках. Не путать со snap: набор «9:05» обязан остаться 9:05,
 * шаг 15 минут — только у полосы.
 *
 * ⚠️ 24:00 на шкале нет. Это следующие сутки, и ввод «24:00» даёт последний слот
 * этих суток (23:45), а не полночь завтра.
 */
export function clampClock(hm: ClockHm): ClockHm {
  if (hm.h === 24 && hm.m === 0) {
    return { h: Math.floor(DAY_MAX_MINUTES / 60), m: DAY_MAX_MINUTES % 60 };
  }
  return {
    h: Math.min(Math.max(Math.trunc(hm.h), 0), 23),
    m: Math.min(Math.max(Math.trunc(hm.m), 0), 59),
  };
}

export function snapClockMinutes(min: number): number {
  const clamped = Math.min(Math.max(min, 0), DAY_MAX_MINUTES);
  return Math.round(clamped / CLOCK_STEP_MIN) * CLOCK_STEP_MIN;
}

export function minutesOfDay(h: number, m: number): number {
  if (h === 24 && m === 0) return DAY_MINUTES;
  return h * 60 + m;
}

export function hmFromMinutes(min: number): ClockHm {
  const snapped = snapClockMinutes(min);
  return { h: Math.floor(snapped / 60), m: snapped % 60 };
}

function wallUtcMs(zone: string, at: Date): number {
  const p = wallParts(zone, at);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.m);
}

export function wallParts(zone: string, at: Date): ZoneWall {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
    return {
      y: Number(p.year),
      mo: Number(p.month),
      d: Number(p.day),
      h: Number(p.hour) % 24,
      m: Number(p.minute),
    };
  } catch {
    return { y: 1970, mo: 1, d: 1, h: 0, m: 0 };
  }
}

/**
 * Смещение пояса относительно другого, в минутах.
 *
 * ⚠️ Через сравнение стен, не таблицу: иначе Индия и переход на летнее врут.
 */
export function offsetMinutes(zone: string, base: string, at: Date): number {
  return Math.round((wallUtcMs(zone, at) - wallUtcMs(base, at)) / 60_000);
}

export function formatOffset(min: number): string {
  if (min === 0) return 'как у вас';
  const sign = min > 0 ? '+' : '−';
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''} ч`;
}

/**
 * Момент, в который в поясе на стене написаны эти дата и часы.
 *
 * ⚠️ Итерация, потому что смещение само зависит от момента (летнее время). Двух-трёх
 * шагов хватает; дыра весной (2:30, которого нет) сходится в ближайший существующий час.
 */
export function instantFromCivil(zone: string, y: number, mo: number, d: number, h: number, m: number): number {
  const clock = clampClock({ h, m });
  const target = Date.UTC(y, mo - 1, d, clock.h, clock.m);
  let t = target;
  for (let i = 0; i < 4; i++) t += target - wallUtcMs(zone, new Date(t));
  return t;
}

/**
 * Тот же календарный день в поясе, но другие часы.
 *
 * ⚠️ Край суток не переносит дату. 24:00 на шкале — это 23:45 этих же суток: иначе курсор,
 * зажатый у правого края, накручивает дни (сентябрь уезжал в декабрь).
 */
export function instantWithClock(zone: string, instant: number, h: number, m: number): number {
  const p = wallParts(zone, new Date(instant));
  const clock = clampClock({ h, m });
  return instantFromCivil(zone, p.y, p.mo, p.d, clock.h, clock.m);
}
