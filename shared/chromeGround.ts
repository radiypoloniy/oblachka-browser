// Цветной фон окна («Цветной фон» в настройках) — вся математика, без React и без DOM.
//
// Зачем отдельным модулем и под проверкой: за этот фон трижды пришлось переделывать интерфейс, и
// каждый раз ломалось не «красиво/некрасиво», а ЧИТАЕМОСТЬ — земля догоняла острова по светлоте,
// и адресная строка с кнопками превращались в пятна. Проверяется это числом, а не глазом, поэтому
// числа живут здесь: scripts/chrome-ground-check.mjs гоняет их на всех тонах палитр и обеих темах.
//
// ⚠️ Значимых импортов тут быть НЕ должно, только типовые — проверка гоняет модуль голым node
// (та же причина, что в shared/sessionTree.ts и shared/nodeTree.ts).

export type GroundPattern = 'blobs' | 'dawn';

export interface GroundInput {
  /** Тон палитры (--sidebar-tint) в #rrggbb. */
  tint: string;
  /** Земля темы (--app-bg) в #rrggbb. */
  appBg: string;
  /** Насыщенность в процентах, см. TINT_AMOUNT_* в src/newtab/settings.ts. */
  amount: number;
  pattern: GroundPattern;
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

// ── Тон, пригодный для земли ───────────────────────────────────────────────────

/**
 * Тон, которым можно красить землю ЭТОЙ темы.
 *
 * ⚠️ В светлой теме земля (`#F2F2F7`) темнее островов, и подмешанный тон её только темнит — брать
 * можно как есть. В ТЁМНОЙ наоборот: тон палитры бывает заметно ЯРЧЕ земли (`#121214`), и
 * подмешивание делает её светлее островов — иерархия выворачивается, адресная строка читается
 * тёмной дырой на цветном.
 *
 * ⚠️ Фиксированной поправки тут быть не может, и это проверено числом: притемнение на 45% спасает
 * синий, но у «Сепии» (`#C9A227`) оставляет тон в ОДИННАДЦАТЬ раз ярче земли. Поэтому притемняем
 * не на долю, а ДО СВЕТИМОСТИ — пока тон не станет темнее земли. Тогда правило работает на любой
 * палитре само и настраивать его человеку не нужно (да и нечем: это ограничение, а не вкус).
 */
export function groundTint(tint: string, appBg: string, dark: boolean): string {
  if (!dark) return tint;
  const target = relLuminance(appBg) * 0.9;
  if (relLuminance(tint) <= target) return tint;
  // Двоичный поиск по доле исходного тона: светимость монотонна по ней, 24 шагов хватает с запасом.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const probe = rgbToHex(hexToRgb(tint).map((v) => v * mid) as [number, number, number]);
    if (relLuminance(probe) > target) hi = mid; else lo = mid;
  }
  return rgbToHex(hexToRgb(tint).map((v) => v * lo) as [number, number, number]);
}

/**
 * Цвет ОСТРОВА (адресная строка, кнопки, активная вкладка) при цветном фоне.
 * Намёк тона по поверхности: остров принадлежит палитре, но остаётся светлее земли.
 */
export function islandColor(tint: string, surface: string): string {
  return blend(tint, surface, 6);
}

// ── Сборка ─────────────────────────────────────────────────────────────────────

/**
 * ⚠️ Оттенки — АНАЛОГОВЫЕ: повороты тона в пределах ±30°. Грязь на градиентах берётся из
 * дополнительных цветов (поворот к 180°), поэтому их здесь нет вовсе.
 */
export function buildChromeGround(input: GroundInput): Ground {
  const { appBg, amount, pattern, dark } = input;
  const t = groundTint(input.tint, appBg, dark);
  const mix = (hex: string, pct: number): string => blend(hex, appBg, pct);

  if (pattern === 'dawn') {
    const top = mix(rotateHue(t, -16), amount * 0.9);
    return {
      top,
      backgroundImage:
        `linear-gradient(180deg, ${top} 0%, ${mix(t, amount * 0.5)} 38%, ${mix(rotateHue(t, 30), amount * 0.85)} 100%)`,
    };
  }

  // 'blobs' — три мягких пятна снизу поверх спокойной вертикальной подложки. Пятна намеренно
  // посажены ниже середины: верх окна остаётся ровным, и его цвет известен точно (см. Ground.top).
  //
  // ⚠️ Пятна гаснут в СВОЙ ЖЕ цвет с нулевой альфой, а НЕ в `transparent`. По спецификации
  // `transparent` это `rgba(0,0,0,0)` — прозрачный ЧЁРНЫЙ, и градиент к нему идёт через серое:
  // по краям пятен проступает грязная кайма, а на стыке появляется видимое кольцо. Ровно это и
  // было видно на первом снимке. Гашение по альфе одного цвета таких артефактов не даёт.
  // ⚠️ Промежуточная ступень на 42% — тоже против кольца: без неё альфа падает линейно и край
  // читается ободком. С ней спад мягкий.
  const top = mix(t, amount * 0.42);
  const blob = (hex: string, k: number, geom: string): string => {
    const a = Math.min(0.45, (amount * k) / 100);
    return `radial-gradient(${geom}, ${rgba(hex, a)} 0%, ${rgba(hex, a * 0.45)} 42%, ${rgba(hex, 0)} 74%)`;
  };
  return {
    top,
    backgroundImage: [
      blob(rotateHue(t, -28), 1.25, '72% 58% at 4% 94%'),
      blob(t, 1.05, '64% 52% at 52% 114%'),
      blob(rotateHue(t, 24), 1.1, '68% 56% at 98% 88%'),
      `linear-gradient(180deg, ${top} 0%, ${mix(t, amount * 0.18)} 100%)`,
    ].join(', '),
  };
}

/** Самое насыщенное место земли — по нему и судят о читаемости островов. */
export function deepestGround(input: GroundInput): string {
  const { appBg, amount, pattern, dark } = input;
  const t = groundTint(input.tint, appBg, dark);
  if (pattern === 'dawn') return blend(rotateHue(t, -16), appBg, amount * 0.9);
  // У пятен глубина берётся альфой поверх подложки, а не смешиванием с землёй, — считаем так же,
  // иначе замер читаемости разъедется с тем, что реально нарисовано.
  const base = blend(t, appBg, amount * 0.18);
  const alpha = Math.min(0.45, (amount * 1.25) / 100);
  return blend(rotateHue(t, -28), base, alpha * 100);
}
