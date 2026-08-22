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
   * Сколько слоёв в backgroundImage. Нужно зерну: `backgroundSize` иначе циклится и кроит
   * пятна сетки под плитку 180 px (см. chromeTintStyle).
   */
  paintLayers: number;
  /**
   * Цвет ВЕРХНЕЙ КРОМКИ окна.
   *
   * ⚠️ Полосу кнопок Windows рисует ОС одним hex, веб-градиент туда не заезжает.
   * Для палитры ось строго вертикальная — верх равен первой ступени. Для сетки кромка
   * берётся справа (там кнопки) и держится CHROME_OVERLAY_PX пикселей.
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

/** Светлота тона земли в тёмной теме при полностью выкрученном ползунке. */
const DARK_TINT_LIGHTNESS = 0.22;
/**
 * Во сколько раз ползунок насыщенности весит больше в тёмной теме.
 *
 * ⚠️ Не подгонка «покрасивее». В светлой теме земля строится подмешиванием тона в `#F2F2F7`, и
 * доли в 27% там хватает с запасом: примесь и фон далеко друг от друга. В тёмной те же 27% тонут —
 * 73% результата остаются почти чёрным `#121214`, и замер давал контраст кромки к фону 1,09–1,14
 * при ползунке НА МАКСИМУМЕ, то есть ниже порога различимости и крутить уже некуда. Множитель
 * доводит край ползунка до почти чистого тона; ниже по шкале ослабление остаётся.
 */
const DARK_AMOUNT_GAIN = 3;
/** Минимальный подъём цветной земли над землёй ПАЛИТРЫ в тёмной теме (см. darkTargetLightness). */
const DARK_TINT_MIN_LIFT = 0.15;
/** Насколько остров обязан быть светлее самого насыщенного места земли. */
export const ISLAND_LIFT = 1.35;

/**
 * Тон, которым красится земля ЭТОЙ темы на полной насыщенности.
 *
 * ⚠️ В тёмной теме тон палитры ЯРЧЕ земли (`#0A84FF` против `#121214`), и брать его как есть
 * нельзя. Но и притемнять умножением каналов нельзя — так теряется цвет, земля выходит почти
 * чёрной. Светлота задаётся в HSL: оттенок и насыщенность сохраняются целиком.
 * ⚠️ Потолка по светимости здесь БОЛЬШЕ НЕТ. Он был привязан к острову, а тот в тёмной теме сам
 * почти неотличим от `--app-bg` — под землю не оставалось места, и градиент пропадал совсем
 * (замерено: контраст кромки к фону 1,038). Теперь ведёт земля, а расходится с ней остров.
 */
export function groundTint(tint: string, dark: boolean, appBg = '#121214'): string {
  return dark ? withLightness(tint, darkTargetLightness(appBg)) : tint;
}

/**
 * Светлота, до которой поднимается тон земли в тёмной теме.
 *
 * ⚠️ Считается ОТ ЗЕМЛИ ПАЛИТРЫ, а не константой, и это не запас «на всякий случай». Тёмные
 * палитры расходятся по светлоте втрое: «Уголь» 0.075, а «Сланец» 0.216 — то есть фиксированные
 * 0.22 давали цветной земле подняться над «Сланцем» ровно ни на сколько. Замер: контраст земли к
 * фону НА МАКСИМУМЕ ползунка 1.208 у «Сланца» и 1.317 у «Графита» при пороге видимости 1.35 —
 * цветной фон там просто не работал, и заметить это мешала проверка, гонявшая ВСЕ тона по земле
 * базовой тёмной темы. Теперь у каждого тона своя земля, а подъём — не меньше DARK_TINT_MIN_LIFT
 * над ней.
 */
function darkTargetLightness(appBg: string): number {
  return Math.max(DARK_TINT_LIGHTNESS, lightnessOf(appBg) + DARK_TINT_MIN_LIFT);
}

/**
 * Одна ступень земли: тон, повёрнутый на `deg`, ослабленный долей `weight` от ползунка.
 *
 * ⚠️ Темы считаются РАЗНЫМИ способами, и это следствие того, где лежит фон. В светлой ослабление —
 * это подмешивание в светлый `--app-bg`: оно уводит и светлоту, и насыщенность, и обе в нужную
 * сторону. В тёмной подмешивание в почти чёрный съедает цвет раньше, чем становится видно ступень,
 * поэтому светлота задаётся ОТДЕЛЬНО (лестницей от фона к `groundTint`), а подмешивание оставлено
 * только ради насыщенности — на малых значениях ползунка земля обязана оставаться почти серой.
 */
function groundStop(input: GroundInput, deg: number, weight: number): string {
  const { tint, appBg, amount, dark } = input;
  const hue = rotateHue(tint, deg);
  if (!dark) return blend(hue, appBg, amount * weight);
  const full = Math.min(100, amount * DARK_AMOUNT_GAIN);
  const floor = lightnessOf(appBg);
  const deepest = floor + (darkTargetLightness(appBg) - floor) * (full / 100);
  return withLightness(blend(hue, appBg, full), floor + (deepest - floor) * weight);
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

/**
 * ⚠️ Ступени идут в ОДНУ сторону: сверху самое насыщенное место земли (0.9), к низу тон тает
 * (0.7 → 0.5). Раньше веса были 0.9 / 0.55 / 0.85 — то есть верх и низ почти совпадали по
 * светлоте, и различимыми концы делал ПОВОРОТ ТОНА. Стоило сузить поворот до честных единиц
 * градусов (см. ниже), как проверка «верх и низ градиента различимы» тут же провалилась на
 * серо-синем тоне: 1,067 против нужных 1,1. Теперь ход держит светлота, а цвет остаётся один.
 *
 * Повороты тона у крайних ступеней. ⚠️ Держим их УЗКИМИ (счёт на единицы градусов), и это
 * оплачено живой жалобой «палитра в настройках выглядит уродливо».
 *
 * Было -16° и +30°: формально «аналоговые оттенки», а на деле нижняя ступень уезжала от тона
 * палитры на 31° и попадала в чужой цвет. Замер по живым тонам: синий 211° → 242° (сиреневый
 * угол — то, чего в системе нет вовсе), «Сепия» 46° → 76° (болотно-зелёный). Глазом это читается
 * не как «оживший градиент», а как грязь и как вторая, незваная палитра.
 *
 * Сектор в 250–310° сторожила проверка, но 242° в него не попадали — поэтому теперь ограничен и
 * САМ СДВИГ (см. scripts/chrome-ground-check.mjs): ни одна ступень не уходит от тона палитры
 * дальше HUE_MAX_DRIFT. Живость градиента держится светлотой ступеней, а не сменой цвета.
 */
const HUE_TOP = -4;
const HUE_BOTTOM = 6;
/**
 * Предел РАЗБРОСА тона между ступенями — им и меряет проверка.
 *
 * ⚠️ Меряется разброс ступеней между собой, а не сдвиг от тона палитры, и это не придирка к
 * формулировке. Ослабление ступени — подмешивание в `--app-bg` обычным RGB, а оно само уводит
 * тон: у серо-синего «Сланца» ступени расходятся на 13° даже при НУЛЕВОМ повороте. Глазу этот
 * увод не виден (насыщенность там 0,13), а вот второй цвет ВНУТРИ градиента виден сразу — его и
 * сторожим.
 */
export const HUE_MAX_SPREAD = 14;

/** Самое насыщенное место земли — по нему и считается островной подъём. Это верхняя ступень. */
export function deepestGround(input: GroundInput): string {
  return groundStop(input, HUE_TOP, 0.9);
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
  const top = groundStop(input, HUE_TOP, 0.9);
  return {
    top,
    island: islandOver(top, input.tint, input.surface, input.dark),
    paintLayers: 1,
    backgroundImage:
      `linear-gradient(180deg, ${top} 0%, ${groundStop(input, 0, 0.7)} 42%, ${groundStop(input, HUE_BOTTOM, 0.5)} 100%)`,
  };
}

// ── Сетчатый градиент (обои и земля окна) ─────────────────────────────────────
//
// ⚠️ Это ТО ЖЕ ядро, что и земля палитры выше, а не второй движок. Цвет, светимость, островной
// подъём — те же функции. Разница только в рисунке: палитра даёт вертикальную растяжку одного
// тона (иначе полоса кнопок Windows расходится с кромкой), а сетка — крупные эллипсы из цветов,
// которые выбрал человек. Обои — содержимое и выбор человека: сиреневый здесь законен, это не
// системный хром (см. docs/design-system-color.md).
//
// Модель как у Arc Spaces / Stripe Mesh: сплошная тёплая база и 2–5 мягких пятен. Линейная
// «растяжка из трёх hex» выглядит дешёвой именно потому, что границу между цветами видно.

export interface MeshBlob {
  color: string;
  /** Центр, 0…100 по ширине. */
  x: number;
  /** Центр, 0…100 по высоте. */
  y: number;
  /** Горизонтальный радиус эллипса в % ширины. Вертикальный = 0.78 от него. */
  size: number;
}

export interface MeshGradient {
  id: string;
  name: string;
  /** Цвета, которые выбрал человек. Пятна и база считаются из них. */
  seeds: string[];
  base: string;
  blobs: MeshBlob[];
  /** 0…100: насколько пятно держит свой цвет, а не растворяется в базе. */
  intensity: number;
  /** 40…90: где пятно становится прозрачным, в % радиуса. */
  softness: number;
}

export const MESH_SEEDS_MIN = 2;
export const MESH_SEEDS_MAX = 5;
export const MESH_SOFTNESS_MIN = 40;
export const MESH_SOFTNESS_MAX = 90;
export const MESH_INTENSITY_DEFAULT = 78;
export const MESH_SOFTNESS_DEFAULT = 72;

/** Тёплая бумага и чернила — не холодный серый iOS. Разбор: docs/roadmap-2026-08-20.md §6. */
const MESH_PAPER = '#efe8dc';
const MESH_INK = '#141216';

export function parseHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return '#' + [...s].map((c) => (c + c).toLowerCase()).join('');
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s.toLowerCase();
  return null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function clampSize(n: number): number {
  return Math.max(28, Math.min(120, n));
}

/** Раскладка пятен: треугольник / углы, крупные радиусы — иначе это конфетти, а не «пространство». */
const BLOB_LAYOUT: Record<number, { x: number; y: number; size: number }[]> = {
  2: [
    { x: 18, y: 22, size: 86 },
    { x: 84, y: 78, size: 82 },
  ],
  3: [
    { x: 16, y: 18, size: 80 },
    { x: 88, y: 26, size: 74 },
    { x: 46, y: 88, size: 84 },
  ],
  4: [
    { x: 14, y: 16, size: 74 },
    { x: 88, y: 18, size: 70 },
    { x: 16, y: 86, size: 76 },
    { x: 86, y: 84, size: 72 },
  ],
  5: [
    { x: 14, y: 16, size: 68 },
    { x: 88, y: 16, size: 66 },
    { x: 12, y: 86, size: 70 },
    { x: 88, y: 86, size: 68 },
    { x: 50, y: 48, size: 58 },
  ],
};

function mixBase(seeds: string[], dark?: boolean): string {
  let acc = seeds[0] ?? MESH_PAPER;
  for (let i = 1; i < seeds.length; i++) acc = blend(seeds[i]!, acc, 50);
  if (dark === true) return blend(acc, MESH_INK, 48);
  if (dark === false) return blend(acc, MESH_PAPER, 36);
  return relLuminance(acc) > 0.36 ? blend(acc, MESH_PAPER, 30) : blend(acc, MESH_INK, 40);
}

function layoutBlobs(colors: string[]): MeshBlob[] {
  const slots = BLOB_LAYOUT[Math.max(MESH_SEEDS_MIN, Math.min(MESH_SEEDS_MAX, colors.length))]
    ?? BLOB_LAYOUT[3]!;
  return colors.map((color, i) => {
    const slot = slots[i] ?? { x: 50, y: 50, size: 64 };
    return { color, x: slot.x, y: slot.y, size: slot.size };
  });
}

export function mixFromSeeds(
  seeds: string[],
  opts: { intensity?: number; softness?: number; blobs?: MeshBlob[]; dark?: boolean } = {},
): Pick<MeshGradient, 'base' | 'blobs' | 'intensity' | 'softness' | 'seeds'> {
  const parsed = seeds.map(parseHex).filter((x): x is string => x !== null)
    .slice(0, MESH_SEEDS_MAX);
  const ready = parsed.length >= MESH_SEEDS_MIN ? parsed : [...parsed, MESH_PAPER, MESH_INK].slice(0, MESH_SEEDS_MIN);
  const intensity = Math.max(0, Math.min(100, opts.intensity ?? MESH_INTENSITY_DEFAULT));
  const softness = Math.max(MESH_SOFTNESS_MIN, Math.min(MESH_SOFTNESS_MAX, opts.softness ?? MESH_SOFTNESS_DEFAULT));
  const base = mixBase(ready, opts.dark);
  const colors = ready.map((s) => blend(s, base, intensity));
  const keep = opts.blobs && opts.blobs.length === colors.length;
  const blobs = keep
    ? opts.blobs!.map((b, i) => ({
      color: colors[i]!,
      x: clamp01(b.x),
      y: clamp01(b.y),
      size: clampSize(b.size),
    }))
    : layoutBlobs(colors);
  return { seeds: ready, base, blobs, intensity, softness };
}

export function createMeshDraft(seeds: string[], name = 'Градиент'): MeshGradient {
  return { id: '', name, ...mixFromSeeds(seeds) };
}

function blobAlpha(blob: MeshBlob, x: number, y: number, softness: number): number {
  const rx = Math.max(1, blob.size);
  const ry = Math.max(1, blob.size * 0.78);
  const d = Math.hypot((x - blob.x) / rx, (y - blob.y) / ry);
  const end = (52 + softness * 0.38) / 100;
  const mid = end * 0.42;
  if (d >= end) return 0;
  if (d <= 0) return 1;
  if (d <= mid) return 1 - (d / mid) * 0.48;
  return 0.52 * (1 - (d - mid) / (end - mid));
}

/** Цвет сетки в точке 0…100. Нужен кромке окна и решению «стекло или заливка». */
export function sampleMesh(mesh: MeshGradient, x: number, y: number): string {
  let color = mesh.base;
  for (let i = mesh.blobs.length - 1; i >= 0; i--) {
    const blob = mesh.blobs[i]!;
    const a = blobAlpha(blob, x, y, mesh.softness);
    if (a > 0) color = blend(blob.color, color, a * 100);
  }
  return color;
}

export function meshIsLight(mesh: MeshGradient): boolean {
  const samples = [sampleMesh(mesh, 50, 40), sampleMesh(mesh, 20, 20), sampleMesh(mesh, 80, 70), mesh.base];
  const avg = samples.reduce((s, c) => s + relLuminance(c), 0) / samples.length;
  return avg > 0.45;
}

export function meshPaintLayers(mesh: MeshGradient): string[] {
  const end = 52 + mesh.softness * 0.38;
  const mid = end * 0.42;
  const blobs = mesh.blobs.map((b) =>
    `radial-gradient(ellipse ${b.size}% ${(b.size * 0.78).toFixed(1)}% at ${b.x}% ${b.y}%, ${b.color} 0%, ${rgba(b.color, 0.52)} ${mid.toFixed(1)}%, transparent ${end.toFixed(1)}%)`,
  );
  return [...blobs, `linear-gradient(180deg, ${mesh.base} 0%, ${mesh.base} 100%)`];
}

export function compileMeshBackground(mesh: MeshGradient): string {
  return meshPaintLayers(mesh).join(', ');
}

/**
 * Высота полосы системных кнопок Windows (`titleBarOverlay.height`) и тулбара.
 * ⚠️ Кромка сетки красится в ПИКСЕЛЯХ, не в процентах: 14% от окна то выше, то ниже кнопок,
 * и прямоугольник ОС расходится с землёй. Число одно — здесь, в main.ts и в Toolbar.tsx.
 */
export const CHROME_OVERLAY_PX = 56;

/**
 * Сетка под тему: те же семена, другая атмосфера. Без этого тёмная сетка на светлом хроме
 * (и наоборот) не «складывается», и человек вынужден руками переключать тему.
 * Семена в сохранённом объекте НЕ меняются — это только рисунок.
 */
export function adaptMeshToTheme(mesh: MeshGradient, dark: boolean): MeshGradient {
  const seeds = mesh.seeds.map((s) => {
    const l = lightnessOf(s);
    return dark
      ? withLightness(s, Math.min(Math.max(l, 0.20), 0.56))
      : withLightness(s, Math.min(Math.max(l, 0.40), 0.78));
  });
  const mixed = mixFromSeeds(seeds, {
    intensity: mesh.intensity,
    softness: mesh.softness,
    blobs: mesh.blobs,
    dark,
  });
  return { ...mesh, base: mixed.base, blobs: mixed.blobs };
}

/** Цвет кромки ТАМ, где Windows рисует кнопки — правый верх, не середина окна. */
export function meshCaptionTop(mesh: MeshGradient): string {
  const a = sampleMesh(mesh, 88, 0);
  const b = sampleMesh(mesh, 96, 0);
  const c = sampleMesh(mesh, 99, 2);
  return blend(blend(a, b, 50), c, 35);
}

/** Символ кнопок Windows: от фактической кромки, не от темы. Иначе светлая сетка в тёмной теме гасит иконки. */
export function overlaySymbolColor(top: string): string {
  return relLuminance(top) > 0.42 ? '#3C3C43' : '#EBEBF5';
}

export function hslSaturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  return l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
}

export function hslToHex(hDeg: number, s: number, l: number): string {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  if (sat === 0) return rgbToHex([light * 255, light * 255, light * 255]);
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
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

/**
 * Акцент кнопок и поповеров от сетки — как палитра «Мята» красит хром в зелёный.
 * В светлой теме уводится вниз по светлоте, пока белый текст не проходит 4.5.
 */
export function accentFromMesh(mesh: MeshGradient, dark: boolean): string {
  let best = mesh.seeds[0] ?? '#2C4BD8';
  let bestSat = -1;
  for (const s of mesh.seeds) {
    const sat = hslSaturation(s);
    if (sat > bestSat) { bestSat = sat; best = s; }
  }
  if (dark) {
    const l = lightnessOf(best);
    return withLightness(best, Math.min(0.64, Math.max(0.46, l)));
  }
  let lo = 0;
  let hi = Math.min(0.48, lightnessOf(best));
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(withLightness(best, mid), '#FFFFFF') < 4.5) hi = mid; else lo = mid;
  }
  return withLightness(best, lo);
}

/** Случайная гармония, не три случайных hex: аналоги + один сдвиг, пастельная светлота. */
export function randomMesh(rand: () => number = Math.random): MeshGradient {
  const hue = Math.floor(rand() * 360);
  const n = rand() < 0.45 ? 2 : 3;
  const deltas = n === 2 ? [0, 32 + rand() * 18] : [0, 28 + rand() * 16, 168 + rand() * 24];
  const seeds = deltas.map((d, i) => hslToHex(
    hue + d,
    0.38 + rand() * 0.28,
    0.48 + rand() * 0.18 + (i === 1 ? 0.06 : 0),
  ));
  const mixed = mixFromSeeds(seeds, {
    intensity: 68 + Math.floor(rand() * 20),
    softness: 64 + Math.floor(rand() * 16),
  });
  return { id: '', name: 'Случайный', ...mixed };
}

/**
 * Земля окна из сетки. ⚠️ Сверху полоса в ПИКСЕЛЯХ высотой CHROME_OVERLAY_PX: её рисует ОС
 * одним hex (setTitleBarOverlay), и процент от окна с ней никогда не совпадёт.
 * Цвет кромки берётся справа — там кнопки, не по центру.
 */
export function buildChromeGroundFromMesh(mesh: MeshGradient, input: GroundInput): Ground {
  const live = adaptMeshToTheme(mesh, input.dark);
  const top = meshCaptionTop(live);
  const deep = sampleMesh(live, 50, 18);
  const fade = `linear-gradient(180deg, ${top} 0px, ${top} ${CHROME_OVERLAY_PX}px, ${rgba(top, 0)} ${CHROME_OVERLAY_PX + 64}px)`;
  const layers = [fade, ...meshPaintLayers(live)];
  return {
    top,
    island: islandOver(deep, live.seeds[0] ?? input.tint, input.surface, input.dark),
    paintLayers: layers.length,
    backgroundImage: layers.join(', '),
  };
}

export function validateMesh(raw: unknown): MeshGradient | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 64) return null;
  if (typeof r.name !== 'string') return null;
  const name = r.name.slice(0, 48);
  const seeds = Array.isArray(r.seeds)
    ? r.seeds.map((s) => typeof s === 'string' ? parseHex(s) : null).filter((s): s is string => s !== null)
    : [];
  if (seeds.length < MESH_SEEDS_MIN || seeds.length > MESH_SEEDS_MAX) return null;
  const blobsRaw = Array.isArray(r.blobs) ? r.blobs : [];
  const blobs: MeshBlob[] = [];
  for (const b of blobsRaw) {
    if (typeof b !== 'object' || b === null) continue;
    const o = b as Record<string, unknown>;
    const color = typeof o.color === 'string' ? parseHex(o.color) : null;
    if (!color || typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.size !== 'number') continue;
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.size)) continue;
    blobs.push({ color, x: clamp01(o.x), y: clamp01(o.y), size: clampSize(o.size) });
  }
  const mixed = mixFromSeeds(seeds, {
    intensity: typeof r.intensity === 'number' && Number.isFinite(r.intensity) ? r.intensity : MESH_INTENSITY_DEFAULT,
    softness: typeof r.softness === 'number' && Number.isFinite(r.softness) ? r.softness : MESH_SOFTNESS_DEFAULT,
    blobs: blobs.length === seeds.length ? blobs : undefined,
  });
  return { id: r.id, name: name.trim() || 'Градиент', ...mixed };
}

function builtin(id: string, name: string, seeds: string[], blobs: MeshBlob[]): MeshGradient {
  return { id, name, ...mixFromSeeds(seeds, { blobs, intensity: 82, softness: 74 }) };
}

/**
 * Готовые сетки. Не замена линейных `--wallpaper-*`: те уже выбраны у людей, id трогать нельзя.
 * Здесь — более «дорогой» рисунок, тот же каталог, что и у пользовательских.
 */
export const BUILTIN_MESHES: MeshGradient[] = [
  builtin('mesh-lagoon', 'Лагуна', ['#7ec8c8', '#2f6f8f', '#e7d5b8'], [
    { color: '#7ec8c8', x: 18, y: 20, size: 82 },
    { color: '#2f6f8f', x: 86, y: 30, size: 76 },
    { color: '#e7d5b8', x: 48, y: 88, size: 80 },
  ]),
  builtin('mesh-ember', 'Угольки', ['#e07a5f', '#f2cc8f', '#3d405b'], [
    { color: '#e07a5f', x: 22, y: 24, size: 84 },
    { color: '#f2cc8f', x: 78, y: 18, size: 70 },
    { color: '#3d405b', x: 70, y: 86, size: 88 },
  ]),
  builtin('mesh-meadow', 'Луг', ['#81b29a', '#f4f1de', '#3d5a45'], [
    { color: '#81b29a', x: 20, y: 28, size: 86 },
    { color: '#f4f1de', x: 82, y: 22, size: 68 },
    { color: '#3d5a45', x: 55, y: 90, size: 78 },
  ]),
  builtin('mesh-dusk', 'Сумерки', ['#c97b63', '#1d3557', '#f1e3d3'], [
    { color: '#c97b63', x: 16, y: 22, size: 78 },
    { color: '#1d3557', x: 88, y: 40, size: 90 },
    { color: '#f1e3d3', x: 40, y: 86, size: 72 },
  ]),
  builtin('mesh-fog', 'Туман', ['#cdd6dd', '#8aa2b4', '#f6f3ee'], [
    { color: '#cdd6dd', x: 24, y: 18, size: 88 },
    { color: '#8aa2b4', x: 80, y: 70, size: 80 },
    { color: '#f6f3ee', x: 48, y: 48, size: 64 },
  ]),
  builtin('mesh-citrus', 'Цитрус', ['#f4a261', '#e9c46a', '#2a9d8f'], [
    { color: '#f4a261', x: 18, y: 16, size: 80 },
    { color: '#e9c46a', x: 86, y: 24, size: 74 },
    { color: '#2a9d8f', x: 52, y: 88, size: 82 },
  ]),
];

export function findBuiltinMesh(id: string): MeshGradient | null {
  return BUILTIN_MESHES.find((m) => m.id === id) ?? null;
}
