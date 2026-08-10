// Картинки мастера установки: build/installer-sidebar.bmp (164×314) и build/installer-header.bmp
// (150×57). Рисуются из того же build/logo-source.png, что и иконка приложения, — палитра
// установщика обязана быть палитрой логотипа, а не «похожей на неё».
//
// ⚠️ ПОТОЛОК NSIS назван прямо, чтобы никто не ждал большего: мастер рисует Windows штатными
// контролами, и своей вёрстки в нём быть не может. Настраиваются ровно три вещи — две картинки
// (боковина страницы приветствия и полоска шапки), цвета фона и текста через MUI, и собственные
// заголовки. Всё «нежное и воздушное» здесь живёт в этих картинках и в цветах, а не в раскладке.
//
// ⚠️ BMP 24 бита без альфы — требование мастера (см. encodeBmp24). Поэтому мягкость краёв
// достигается не прозрачностью, а тем, что всё рисуется поверх непрозрачного градиента.
//
// Запуск: npm run make-installer-art (после замены build/logo-source.png).
import { decodePng, encodeBmp24 } from './pngLite.mjs';
import { extractLogo } from './logoMask.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'build', 'logo-source.png');

// Размеры заданы самим NSIS/MUI и произвольными быть не могут.
const SIDEBAR_W = 164, SIDEBAR_H = 314;
const HEADER_W = 150, HEADER_H = 57;
const SS = 3; // рисуем в 3× и усредняем: у мастера картинки крошечные, лесенка на них заметна

// Палитра снята с самого логотипа: небо сверху — голубой, к середине уходит в сиреневый, снизу
// растворяется в белом облаке. Значения держим светлыми: установщик должен читаться как
// продолжение интерфейса, а не как рекламный баннер.
// ⚠️ Небо заметно НАСЫЩЕННЕЕ логотипа, и это не вкус, а необходимость: у знака внутри такая же
// пастель, и на равном по светлоте фоне его круг просто исчезал — оставалось бледное пятно.
// Разница по светлоте между небом и знаком и есть то, что делает знак знаком.
const SKY_TOP = [0xAF, 0xC6, 0xEF];
const SKY_MID = [0xCE, 0xC4, 0xE8];
const SKY_LOW = [0xEC, 0xE0, 0xF0];
const FOG = [0xFA, 0xFB, 0xFE];

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Плавная ступенька (smoothstep): без неё края облаков выглядят вырезанными ножницами.
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// ── логотип: читаем и отделяем от белой подложки заливкой от краёв ────────────
// Тот же приём, что в make-icon.mjs: порог по цвету выел бы и светлые места внутри облака,
// а заливка убирает только внешнюю связную подложку.
const src = decodePng(readFileSync(SRC));
// Отделение знака от подложки — общий модуль: маска самое хрупкое место цепочки, и две её
// версии разъехались бы на первой же смене логотипа (см. scripts/logoMask.mjs).
const { px, alphaAt, minX, minY, logoW, logoH } = extractLogo(src);

/** Логотип, вписанный в квадрат box×box с левым верхним углом (ox, oy). Возвращает [r,g,b,a]. */
function sampleLogo(fxPix, fyPix, ox, oy, box) {
  const scale = box / Math.max(logoW, logoH);
  const drawW = logoW * scale, drawH = logoH * scale;
  const x0f = ox + (box - drawW) / 2, y0f = oy + (box - drawH) / 2;
  if (fxPix < x0f || fxPix >= x0f + drawW || fyPix < y0f || fyPix >= y0f + drawH) return null;
  const fx = minX + ((fxPix - x0f) / drawW) * (logoW - 1);
  const fy = minY + ((fyPix - y0f) / drawH) * (logoH - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, src.width - 1), y1 = Math.min(y0 + 1, src.height - 1);
  const tx = fx - x0, ty = fy - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (const [sx, sy, w] of [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]]) {
    const c = px(sx, sy), al = alphaAt(sx, sy);
    r += c[0] * al * w; g += c[1] * al * w; b += c[2] * al * w; a += al * w;
  }
  if (a <= 0.001) return null;
  return [r / a, g / a, b / a, a];
}

/**
 * Общая отрисовка одной картинки. `paint(x, y, w, h)` возвращает цвет фона в точке,
 * `logo` описывает, куда вписать логотип (или null, если он не нужен).
 */
function render(w, h, paint, logo) {
  const W = w * SS, H = h * SS;
  const acc = new Float32Array(w * h * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / SS, fy = (y + 0.5) / SS;
      let c = paint(fx, fy, w, h);
      if (logo) {
        // Мягкое свечение под знаком: отделяет его от неба, не рисуя ни рамки, ни подложки —
        // именно так знак «висит в воздухе», а не наклеен на прямоугольник.
        const gx = logo.x + logo.box / 2, gy = logo.y + logo.box / 2;
        const glow = 1 - smooth(logo.box * 0.34, logo.box * 0.78, Math.hypot(fx - gx, fy - gy));
        if (glow > 0) c = mix(c, [0xFF, 0xFF, 0xFF], glow * (logo.glow ?? 0.45));
        const s = sampleLogo(fx, fy, logo.x, logo.y, logo.box);
        if (s) c = mix(c, [s[0], s[1], s[2]], s[3]);
      }
      const o = (((y / SS) | 0) * w + ((x / SS) | 0)) * 3;
      acc[o] += c[0]; acc[o + 1] += c[1]; acc[o + 2] += c[2];
    }
  }
  const out = Buffer.alloc(w * h * 3);
  const n = SS * SS;
  for (let i = 0; i < w * h * 3; i++) out[i] = Math.max(0, Math.min(255, Math.round(acc[i] / n)));
  return out;
}

// ── боковина страницы приветствия ────────────────────────────────────────────
// Небо сверху вниз, снизу — гряда облаков мягкими окружностями, логотип чуть выше центра.
// Облака рисуются полем «сколько облака в этой точке», а не силуэтами: у пересечений тогда не
// возникает швов, и вся гряда читается как одно целое.
const CLOUDS = [
  { cx: 26, cy: 292, r: 44 },
  { cx: 80, cy: 280, r: 54 },
  { cx: 136, cy: 296, r: 48 },
  { cx: 112, cy: 314, r: 42 },
  { cx: 4, cy: 320, r: 38 },
];
function paintSidebar(x, y) {
  const t = y / SIDEBAR_H;
  let c = t < 0.55 ? mix(SKY_TOP, SKY_MID, smooth(0, 0.55, t)) : mix(SKY_MID, SKY_LOW, smooth(0.55, 1, t));
  // Дымка у нижнего края — чтобы картинка растворялась в белом фоне мастера, а не обрывалась.
  c = mix(c, FOG, smooth(0.72, 1.0, t) * 0.55);
  let cloud = 0;
  for (const { cx, cy, r } of CLOUDS) {
    const d = Math.hypot(x - cx, y - cy);
    cloud = Math.max(cloud, 1 - smooth(r * 0.72, r, d));
  }
  return mix(c, [0xFF, 0xFF, 0xFF], cloud * 0.92);
}

// ── полоска шапки ────────────────────────────────────────────────────────────
// Шапку Windows рисует на белом, поэтому слева она должна быть почти белой и лишь к правому
// краю набирать цвет — иначе полоска выглядит наклейкой поверх диалога. Логотип справа: там же,
// где его ставит стандартный мастер.
function paintHeader(x, _y, w) {
  const t = smooth(0.25, 1, x / w);
  return mix([0xFF, 0xFF, 0xFF], mix(SKY_LOW, SKY_TOP, 0.45), t * 0.85);
}

const sidebar = render(SIDEBAR_W, SIDEBAR_H, paintSidebar, { x: 26, y: 62, box: 112, glow: 0.5 });
writeFileSync(resolve(ROOT, 'build', 'installer-sidebar.bmp'), encodeBmp24(SIDEBAR_W, SIDEBAR_H, sidebar));

// В шапке свечение почти не нужно: фон там и так светлый, а лишний ореол на 57 пикселях высоты
// читается грязью.
const header = render(HEADER_W, HEADER_H, paintHeader, { x: HEADER_W - 54, y: 4, box: 48, glow: 0.18 });
writeFileSync(resolve(ROOT, 'build', 'installer-header.bmp'), encodeBmp24(HEADER_W, HEADER_H, header));

console.log(`[installer-art] боковина ${SIDEBAR_W}×${SIDEBAR_H}, шапка ${HEADER_W}×${HEADER_H} — из логотипа ${logoW}×${logoH}`);
