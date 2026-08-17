// Цветной фон окна («Цветной фон» в настройках) — вся математика, без React и без DOM.
//
// Зачем отдельным модулем и под проверкой: за этот фон трижды пришлось переделывать интерфейс, и
// каждый раз ломалось не «красиво/некрасиво», а ЧИТАЕМОСТЬ — земля догоняла острова по светлоте,
// и адресная строка с кнопками превращались в пятна. Проверяется это числом, а не глазом, поэтому
// числа живут здесь: scripts/chrome-ground-check.mjs гоняет их на всех тонах палитр и обеих темах.
//
// ⚠️ Значимых импортов тут быть НЕ должно, только типовые — проверка гоняет модуль голым node
// (та же причина, что в shared/sessionTree.ts и shared/nodeTree.ts).



export interface GroundInput {
  /** Тон палитры (--sidebar-tint) в #rrggbb. */
  tint: string;
  /** Земля темы (--app-bg) в #rrggbb. */
  appBg: string;
  /** Насыщенность в процентах, см. TINT_AMOUNT_* в src/newtab/settings.ts. */
  amount: number;
  /** Поверхность темы (--surface) в #rrggbb. */
  surface: string;
  dark: boolean;
}

export interface Ground {
  /** Готовое значение background-image (без слоя шума — его добавляет вызывающий). */
  backgroundImage: string;
  /**
   * Цвет ВЕРХНЕЙ КРОМКИ окна.
   *
   * ⚠️ Он же уходит в полосу системных кнопок Windows (setTitleBarOverlay): её рисует ОС, а не
   * веб-слой, поэтому цвет обязан совпадать с нарисованным под ней. Ось градиента поэтому строго
   * ВЕРТИКАЛЬНАЯ: цвет постоянен вдоль каждой горизонтали, и верхняя кромка точно равна первой
   * ступени. У диагональной оси угол отличался от неё и полоса читалась чужой заплаткой.
   */
  top: string;
  /**
   * Цвет ОСТРОВА над этой землёй.
   *
   * ⚠️ Считается ОТ ЗЕМЛИ, а не сам по себе. Раньше было наоборот — земля зажималась под остров, —
   * и в тёмной теме это давало контраст кромки к фону 1,038: остров там сам почти неотличим от
   * `--app-bg` (`#1C1C1E` против `#121214` это 1,10), места под землю не оставалось, и градиент
   * пропадал совсем. Теперь ведёт земля, а расходится с ней остров.
   */
  island: string;
}

// ── Цвет ───────────────────────────────────────────────────────────────────────

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

/** Смешивает a в b долей pct процентов. */
export function blend(a: string, b: string, pct: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const k = Math.max(0, Math.min(100, pct)) / 100;
  return rgbToHex([0, 1, 2].map((i) => A[i]! * k + B[i]! * (1 - k)) as [number, number, number]);
}

/** Тот же цвет с заданной альфой. Нужен пятнам: см. разбор про `transparent` в buildChromeGround. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Относительная светимость по WCAG. */
export function relLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст по WCAG, всегда ≥ 1. */
export function contrast(a: string, b: string): number {
  const x = relLuminance(a);
  const y = relLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Поворот тона на deg градусов при той же насыщенности и светлоте. */
export function rotateHue(hex: string, deg: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const hh = (((h * 360 + deg) % 360) + 360) % 360 / 360;
  if (s === 0) return rgbToHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return rgbToHex([ch(hh + 1 / 3) * 255, ch(hh) * 255, ch(hh - 1 / 3) * 255]);
}

/** Светлота HSL. Нужна, чтобы поднимать остров над землёй на заданную величину. */
export function lightnessOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

/** Тот же тон с заданной светлотой HSL. Оттенок и насыщенность сохраняются. */
export function withLightness(hex: string, lightness: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l0 = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l0 > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const l = Math.max(0, Math.min(1, lightness));
  if (s === 0) return rgbToHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return rgbToHex([ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255]);
}

// ── Земля ведёт, остров поднимается над ней ────────────────────────────────────

/** Светлота тона земли в тёмной теме: тёмный, но НЕ обесцвеченный и НЕ невидимый. */
const DARK_TINT_LIGHTNESS = 0.20;
/** Насколько остров обязан быть светлее самого насыщенного места земли. */
export const ISLAND_LIFT = 1.35;

/**
 * Тон, которым красится земля ЭТОЙ темы.
 *
 * ⚠️ В тёмной теме тон палитры ЯРЧЕ земли (`#0A84FF` против `#121214`), и брать его как есть
 * нельзя. Но и притемнять умножением каналов нельзя — так теряется цвет, земля выходит почти
 * чёрной. Светлота задаётся в HSL: оттенок и насыщенность сохраняются целиком.
 * ⚠️ Потолка по светимости здесь БОЛЬШЕ НЕТ. Он был привязан к острову, а тот в тёмной теме сам
 * почти неотличим от `--app-bg` — под землю не оставалось места, и градиент пропадал совсем
 * (замерено: контраст кромки к фону 1,038). Теперь ведёт земля, а расходится с ней остров.
 */
export function groundTint(tint: string, dark: boolean): string {
  return dark ? withLightness(tint, DARK_TINT_LIGHTNESS) : tint;
}

/**
 * Цвет острова над готовой землёй.
 *
 * ⚠️ Светлая и тёмная тема считаются РАЗНЫМИ способами, и это не небрежность. В светлой
 * поверхность (`#FFFFFF`) сама заметно светлее любой земли — достаточно намёка тона, чтобы остров
 * принадлежал палитре. В тёмной поверхность (`#1C1C1E`) почти совпадает с фоном, поэтому остров
 * строится ОТ ЗЕМЛИ: поднимается по светлоте, пока не станет светлее её самого насыщенного места
 * в ISLAND_LIFT раз. Тогда он читается при любом тоне и любой насыщенности — по построению.
 */
export function islandOver(deepest: string, tint: string, surface: string, dark: boolean): string {
  if (!dark) return blend(tint, surface, 6);
  let lo = lightnessOf(deepest);
  let hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(withLightness(deepest, mid), deepest) < ISLAND_LIFT) lo = mid; else hi = mid;
  }
  // ⚠️ К нейтрали НЕ уводим: подмешивание тёмной поверхности съедало бы только что набранный
  // подъём. Лёгкая окраска острова здесь уместна — он принадлежит той же палитре, что и земля.
  return withLightness(deepest, hi);
}

// ── Сборка ─────────────────────────────────────────────────────────────────────

/** Самое насыщенное место земли — по нему и считается островной подъём. */
export function deepestGround(input: GroundInput): string {
  const t = groundTint(input.tint, input.dark);
  return blend(rotateHue(t, -16), input.appBg, input.amount * 0.9);
}

/**
 * Земля: вертикальная растяжка из трёх ступеней по АНАЛОГОВЫМ оттенкам (повороты в пределах ±30°).
 * Грязь на градиентах берётся из дополнительных цветов, поэтому их здесь нет вовсе.
 *
 * ⚠️ Радиальных ПЯТЕН здесь нет, и это не откат «на всякий случай». На размер окна пятна ложились
 * видимыми кольцами: большой радиальный градиент с малой разницей цвета в 8-битном sRGB, и
 * дизеринг зерном их не спасал. Линейная растяжка тех же оттенков этой болезни не имеет — у неё
 * ступени идут вдоль одной оси.
 * ⚠️ Ось строго ВЕРТИКАЛЬНАЯ: только тогда цвет постоянен вдоль горизонтали и верхняя кромка
 * определима точно — её отдаём в полосу системных кнопок Windows (см. Ground.top).
 */
export function buildChromeGround(input: GroundInput): Ground {
  const { appBg, amount, dark, surface } = input;
  const t = groundTint(input.tint, dark);
  const mix = (hex: string, pct: number): string => blend(hex, appBg, pct);
  const top = mix(rotateHue(t, -16), amount * 0.9);
  return {
    top,
    island: islandOver(deepestGround(input), input.tint, surface, dark),
    backgroundImage:
      `linear-gradient(180deg, ${top} 0%, ${mix(t, amount * 0.55)} 42%, ${mix(rotateHue(t, 30), amount * 0.85)} 100%)`,
  };
}
