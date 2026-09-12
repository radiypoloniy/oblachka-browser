// Геометрия разметки снимка: перевод клика в пиксели кадра и нормализация рамки.
//
// Без импортов — прогон scripts/screenshot-markup-check.mjs гоняет голым node.
// Цвет разметки — литерал --danger-500 светлой темы: снимок уйдёт из браузера, акцент палитры
// там потеряет смысл (на «Мяте» круги стали бы зелёными).

/** Цвет овала, стрелки и текста на кадре. Совпадает с --danger-500 светлой шкалы. */
export const SHOT_MARK = '#FF3B30';

export type ShotTool = 'crop' | 'oval' | 'arrow' | 'text';

export interface ShotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Box {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Клиентская точка внутри коробки с object-fit:contain → пиксели натурального кадра.
 * Снаружи картинки — null: жест по полям бумаги не рисует.
 */
export function mapContainPoint(box: Box, natural: Box, local: Point): Point | null {
  if (box.width <= 0 || box.height <= 0 || natural.width <= 0 || natural.height <= 0) return null;
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  if (scale <= 0) return null;
  const dw = natural.width * scale;
  const dh = natural.height * scale;
  const ox = (box.width - dw) / 2;
  const oy = (box.height - dh) / 2;
  const x = (local.x - ox) / scale;
  const y = (local.y - oy) / scale;
  if (x < 0 || y < 0 || x > natural.width || y > natural.height) return null;
  return { x, y };
}

/** Две точки → рамка с неотрицательными сторонами. */
export function rectFromPoints(a: Point, b: Point): ShotRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Рамка, зажатая в кадр. Нулевая, если после зажима ничего не осталось. */
export function clampRect(r: ShotRect, frame: Box): ShotRect {
  const x = clamp(r.x, 0, frame.width);
  const y = clamp(r.y, 0, frame.height);
  const w = clamp(r.w, 0, frame.width - x);
  const h = clamp(r.h, 0, frame.height - y);
  return { x, y, w, h };
}

/** Мельче этого кроп не имеет смысла — пальцем промахнулись, а не вырезали. */
export const MIN_CROP = 16;

export function cropReady(r: ShotRect): boolean {
  return r.w >= MIN_CROP && r.h >= MIN_CROP;
}

/** Доля вьюпорта, которую отдал клик по элементу. Не CSS×dpr: зум тогда разъедется с кадром. */
export interface ViewportFrac {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function parseViewportFrac(raw: unknown): ViewportFrac | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const w = Number(o.w);
  const h = Number(o.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/** Доли вьюпорта → пиксели уже снятого кадра. */
export function viewportFracToShot(frac: ViewportFrac, shot: Box): ShotRect {
  return clampRect({
    x: Math.round(frac.x * shot.width),
    y: Math.round(frac.y * shot.height),
    w: Math.round(frac.w * shot.width),
    h: Math.round(frac.h * shot.height),
  }, shot);
}
