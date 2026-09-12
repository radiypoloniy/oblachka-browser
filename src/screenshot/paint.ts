// Рисование разметки на кадре. Живёт в renderer: нужен Canvas 2D, shared/ его не имеет.

import { SHOT_MARK, type Point, type ShotRect } from '../../shared/screenshotMarkup';

export function loadShot(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('shot'));
    img.src = src;
  });
}

function stroke(ctx: CanvasRenderingContext2D, minSide: number): void {
  ctx.strokeStyle = SHOT_MARK;
  ctx.fillStyle = SHOT_MARK;
  ctx.lineWidth = Math.max(3, Math.round(minSide * 0.006));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

export function paintOval(ctx: CanvasRenderingContext2D, r: ShotRect, minSide: number): void {
  if (r.w < 2 || r.h < 2) return;
  stroke(ctx, minSide);
  ctx.beginPath();
  ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
}

export function paintArrow(ctx: CanvasRenderingContext2D, a: Point, b: Point, minSide: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return;
  stroke(ctx, minSide);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  const head = Math.max(10, Math.min(28, len * 0.22));
  const ang = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
  ctx.stroke();
}

export function paintText(ctx: CanvasRenderingContext2D, at: Point, text: string, minSide: number): void {
  const t = text.trim();
  if (!t) return;
  const size = Math.max(16, Math.round(minSide * 0.032));
  ctx.font = `700 ${size}px "Golos Text", "Segoe UI", sans-serif`;
  ctx.fillStyle = SHOT_MARK;
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, Math.round(size * 0.18));
  ctx.strokeStyle = '#fff';
  ctx.strokeText(t, at.x, at.y);
  ctx.fillText(t, at.x, at.y);
}

export async function cropShot(src: string, r: ShotRect): Promise<string> {
  const img = await loadShot(src);
  const w = Math.max(1, Math.round(r.w));
  const h = Math.max(1, Math.round(r.h));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(img, Math.round(r.x), Math.round(r.y), w, h, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}

export async function withPaint(
  src: string,
  paint: (ctx: CanvasRenderingContext2D, minSide: number) => void,
): Promise<string> {
  const img = await loadShot(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0);
  paint(ctx, Math.min(img.naturalWidth, img.naturalHeight));
  return canvas.toDataURL('image/png');
}
