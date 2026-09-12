// Оформление кадра на canvas: бумага, тень, скругление. То, что человек видит, то и в файл.

import { SHOT_PAPER, shotFrame } from '../../shared/screenshotDecorate';

export function decorate(raw: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx || !w || !h) { resolve(raw); return; }
      const { pad, radius, width, height } = shotFrame(w, h);
      ctx.canvas.width = width;
      ctx.canvas.height = height;

      ctx.fillStyle = SHOT_PAPER;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
      ctx.shadowBlur = pad * 1.1;
      ctx.shadowOffsetY = Math.round(pad * 0.35);
      ctx.beginPath();
      ctx.roundRect(pad, pad, w, h, radius);
      ctx.fillStyle = SHOT_PAPER;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(pad, pad, w, h, radius);
      ctx.clip();
      ctx.drawImage(img, pad, pad, w, h);
      ctx.restore();

      resolve(ctx.canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(raw);
    img.src = raw;
  });
}
