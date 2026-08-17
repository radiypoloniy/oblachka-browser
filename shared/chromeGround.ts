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
  /** Светимость острова — потолок для земли в тёмной теме, см. groundTint. */
  islandLum: number;
  dark: boolean;
}

export interface Ground {
  /** Готовое значение background-image (без слоя шума — его добавляет вызывающий). */
  backgroundImage: string;
  /**
   * Цвет ВЕРХНЕЙ КРОМКИ окна.
   *
   * ⚠️ Он же уходит в полосу системных кнопок Windows (setTitleBarOverlay): её рисует ОС, а не
   * веб-слой, поэтому цвет обязан совпадать с нарисованным под ней. Оба рисунка сделаны так, что
   * верх РОВНЫЙ по горизонтали — у «пятен» они начинаются ниже титлбара, у «рассвета» ось строго
   * вертикальная. Иначе это значение было бы неопределимо (проверено: у диагональной оси угол
   * отличался от первой ступени и полоса читалась чужой заплаткой).
   */
  top: string;
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

/** Тот же тон с заданной светлотой HSL. Насыщенность и оттенок сохраняются. */
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

// ── Тон, пригодный для земли ───────────────────────────────────────────────────

/** Светлота тона земли в тёмной теме. Тёмный, но НЕ обесцвеченный — см. groundTint. */
const DARK_TINT_LIGHTNESS = 0.24;

/**
 * Цвет ОСТРОВА (адресная строка, кнопки, активная вкладка) при цветном фоне.
 * Намёк тона по поверхности: остров принадлежит палитре, но остаётся светлее земли.
 */
export function islandColor(tint: string, surface: string): string {
  return blend(tint, surface, 6);
}

/**
 * Тон, которым можно красить землю ЭТОЙ темы.
 *
 * ⚠️ В светлой теме земля (`#F2F2F7`) темнее островов, и подмешанный тон её только темнит — берём
 * как есть. В ТЁМНОЙ наоборот: тон палитры бывает заметно ЯРЧЕ земли (`#121214`), и подмешивание
 * делает её светлее островов — иерархия выворачивается, адресная строка читается тёмной дырой.
 *
 * ⚠️ Фиксированной поправки тут быть не может, это проверено числом: притемнение на 45% спасает
 * синий, но у «Сепии» (`#C9A227`) оставляет тон в ОДИННАДЦАТЬ раз ярче земли.
 *
 * ⚠️ И притемнять НЕЛЬЗЯ умножением каналов на долю — так тон теряет не только светлоту, но и
 * цвет: тёмная земля выходила невзрачной, почти чёрной (живая жалоба «тёмные градиенты очень
 * невзрачные»). Поэтому светлота задаётся в HSL, а оттенок и насыщенность сохраняются целиком.
 * Потолок при этом считается от ОСТРОВА, а не от земли: земле разрешено быть заметно светлее
 * `--app-bg`, ей нельзя лишь догонять острова.
 */
export function groundTint(tint: string, dark: boolean, islandLum: number): string {
  if (!dark) return tint;
  const ceiling = islandLum * 0.62;
  const vivid = withLightness(tint, DARK_TINT_LIGHTNESS);
  if (relLuminance(vivid) <= ceiling) return vivid;
  // Не влез (очень светлый тон вроде жёлтого) — опускаем светлоту, пока не влезет. Двоичный поиск:
  // светимость по светлоте монотонна, 20 шагов с запасом.
  let lo = 0;
  let hi = DARK_TINT_LIGHTNESS;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (relLuminance(withLightness(tint, mid)) > ceiling) hi = mid; else lo = mid;
  }
  return withLightness(tint, lo);
}

// ── Сборка ─────────────────────────────────────────────────────────────────────

/**
 * Земля: вертикальная растяжка из трёх ступеней по АНАЛОГОВЫМ оттенкам (повороты в пределах ±30°).
 * Грязь на градиентах берётся из дополнительных цветов, поэтому их здесь нет вовсе.
 *
 * ⚠️ Радиальных ПЯТЕН здесь больше нет, и это не откат «на всякий случай». На размер окна пятна
 * ложились видимыми артефактами: большой радиальный градиент с малой разницей цвета в 8-битном
 * sRGB даёт кольца, и никакой дизеринг зерном их не спасал. Линейная растяжка тех же оттенков той
 * же болезни не имеет — у неё ступени идут вдоль одной оси и зерна хватает.
 */
export function buildChromeGround(input: GroundInput): Ground {
  const { appBg, amount, dark } = input;
  const t = groundTint(input.tint, dark, input.islandLum);
  const mix = (hex: string, pct: number): string => blend(hex, appBg, pct);
  const top = mix(rotateHue(t, -16), amount * 0.9);
  return {
    top,
    backgroundImage:
      `linear-gradient(180deg, ${top} 0%, ${mix(t, amount * 0.55)} 42%, ${mix(rotateHue(t, 30), amount * 0.85)} 100%)`,
  };
}

/** Самое насыщенное место земли — по нему и судят о читаемости островов. */
export function deepestGround(input: GroundInput): string {
  const t = groundTint(input.tint, input.dark, input.islandLum);
  return blend(rotateHue(t, -16), input.appBg, input.amount * 0.9);
}
