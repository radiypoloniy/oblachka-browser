// Геометрия разметки снимка: перевод клика в пиксели кадра и нормализация рамки.
//
// Без импортов — прогон scripts/screenshot-markup-check.mjs гоняет голым node.
// Цвет разметки — литерал --danger-500 светлой темы: снимок уйдёт из браузера, акцент палитры
// там потеряет смысл (на «Мяте» круги стали бы зелёными).

/** Цвет овала и стрелки на кадре. Совпадает с --danger-500 светлой шкалы. */
export const SHOT_MARK = '#FF3B30';

/** Чернила подписи. Нейтральный чёрный: снимок уйдёт из браузера, тема его не красит. */
export const SHOT_TEXT = '#1C1C1E';

/** Голос интерфейса. Canvas не видит CSS-переменную, поэтому семейство строкой. */
export const SHOT_FONT = '"Golos Text", "Segoe UI", sans-serif';

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

function sincos(a: number): { c: number; s: number } {
  return { c: Math.cos(a), s: Math.sin(a) };
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

/**
 * То же отображение, но без отсечения полем. Ручка поворота торчит НАД кадром,
 * и clip вернул бы null на половине жеста.
 */
export function mapContainCoords(box: Box, natural: Box, local: Point): Point | null {
  if (box.width <= 0 || box.height <= 0 || natural.width <= 0 || natural.height <= 0) return null;
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  if (scale <= 0) return null;
  const dw = natural.width * scale;
  const dh = natural.height * scale;
  const ox = (box.width - dw) / 2;
  const oy = (box.height - dh) / 2;
  return { x: (local.x - ox) / scale, y: (local.y - oy) / scale };
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

/** Поле вокруг элемента: иначе глифы первой/последней буквы срезает getBoundingClientRect. */
export const PICK_PAD = 10;

export function cropReady(r: ShotRect): boolean {
  return r.w >= MIN_CROP && r.h >= MIN_CROP;
}

/** Рамка, расширенная на pad по краям и зажатая во вьюпорт. Не clampRect: у края
 *  левый pad срезается, и прибавка к w иначе уезжает вправо. */
export function expandCssRect(r: ShotRect, pad: number, view: Box): ShotRect {
  const x = clamp(r.x - pad, 0, view.width);
  const y = clamp(r.y - pad, 0, view.height);
  const right = clamp(r.x + r.w + pad, 0, view.width);
  const bottom = clamp(r.y + r.h + pad, 0, view.height);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
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

/** Есть ли у рамки пересечение с вьюпортом [0,1]². Иначе клик ушёл за снятый кадр. */
export function fracOverlapsView(f: ViewportFrac): boolean {
  return f.x < 1 && f.y < 1 && f.x + f.w > 0 && f.y + f.h > 0;
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

export interface CropFrame extends ShotRect {
  angle: number;
}

export type EdgeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export type CropHandle = EdgeHandle | 'rot' | 'move';

export const EDGE_HANDLES: readonly EdgeHandle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** Зазор ручки поворота над верхней стороной, в пикселях кадра. */
export const ROTATE_GAP = 28;

export function frameCenter(f: CropFrame): Point {
  return { x: f.x + f.w / 2, y: f.y + f.h / 2 };
}

export function toFrameLocal(f: CropFrame, p: Point): Point {
  const mid = frameCenter(f);
  const dx = p.x - mid.x;
  const dy = p.y - mid.y;
  const { c, s } = sincos(-f.angle);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function fromFrameLocal(f: CropFrame, p: Point): Point {
  const mid = frameCenter(f);
  const { c, s } = sincos(f.angle);
  return { x: mid.x + p.x * c - p.y * s, y: mid.y + p.x * s + p.y * c };
}

export function frameCorners(f: CropFrame): [Point, Point, Point, Point] {
  const hx = f.w / 2;
  const hy = f.h / 2;
  return [
    fromFrameLocal(f, { x: -hx, y: -hy }),
    fromFrameLocal(f, { x: hx, y: -hy }),
    fromFrameLocal(f, { x: hx, y: hy }),
    fromFrameLocal(f, { x: -hx, y: hy }),
  ];
}

export function rotateHandle(f: CropFrame): Point {
  return fromFrameLocal(f, { x: 0, y: -f.h / 2 - ROTATE_GAP });
}

export function handlePoint(f: CropFrame, handle: EdgeHandle): Point {
  const hx = f.w / 2;
  const hy = f.h / 2;
  const x = handle.includes('e') ? hx : handle.includes('w') ? -hx : 0;
  const y = handle.includes('s') ? hy : handle.includes('n') ? -hy : 0;
  return fromFrameLocal(f, { x, y });
}

/** Противоположный угол зафиксирован: жест считается от исходной рамки, не от предыдущего кадра. */
export function resizeCrop(f: CropFrame, handle: EdgeHandle, p: Point): CropFrame {
  const local = toFrameLocal(f, p);
  let left = -f.w / 2;
  let right = f.w / 2;
  let top = -f.h / 2;
  let bot = f.h / 2;
  if (handle.includes('e')) right = Math.max(left + MIN_CROP, local.x);
  if (handle.includes('w')) left = Math.min(right - MIN_CROP, local.x);
  if (handle.includes('s')) bot = Math.max(top + MIN_CROP, local.y);
  if (handle.includes('n')) top = Math.min(bot - MIN_CROP, local.y);
  const w = right - left;
  const h = bot - top;
  const mid = fromFrameLocal(f, { x: (left + right) / 2, y: (top + bot) / 2 });
  return { x: mid.x - w / 2, y: mid.y - h / 2, w, h, angle: f.angle };
}

/** Верх рамки смотрит на указатель. Ноль — ручка строго сверху. */
export function rotateCrop(f: CropFrame, p: Point): CropFrame {
  const mid = frameCenter(f);
  return { ...f, angle: Math.atan2(p.y - mid.y, p.x - mid.x) + Math.PI / 2 };
}

export function clampFrame(f: CropFrame, box: Box): CropFrame {
  const c = frameCenter(f);
  const cx = clamp(c.x, 0, box.width);
  const cy = clamp(c.y, 0, box.height);
  return { ...f, x: f.x + (cx - c.x), y: f.y + (cy - c.y) };
}

export function moveCrop(f: CropFrame, from: Point, to: Point, box: Box): CropFrame {
  return clampFrame({ ...f, x: f.x + (to.x - from.x), y: f.y + (to.y - from.y) }, box);
}
