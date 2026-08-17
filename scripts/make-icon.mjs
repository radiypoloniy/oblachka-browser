// Сборка иконки приложения: build/logo-source.png (логотип-облако на белой подложке)
// → build/icon.png (512×512, squircle в духе iOS 26). Из этого PNG electron-builder сам
// нарезает все размеры .ico для установщика и ярлыков.
//
// Почему свой кодек, а не sharp/jimp: ради одного файла на этапе сборки тащить в проект
// нативную графическую зависимость не хочется (см. CLAUDE.md про зависимости). PNG здесь
// без интерлейса, 8 бит на канал — этого достаточно, чтобы обойтись zlib из стандартной
// библиотеки.
//
// Запуск: npm run make-icon (после замены build/logo-source.png на новую версию логотипа).
import { decodePng, encodePng } from './pngLite.mjs';
import { extractLogo } from './logoMask.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'build', 'logo-source.png');
const DEST = resolve(ROOT, 'build', 'icon.png');

const OUT = 512;
const SS = 2;                 // рисуем в 2× и усредняем — сглаживает край круга
const W = OUT * SS;
// Логотип занимает всю плитку: он сам по себе круг, отдельная подложка ему не нужна —
// собственная форма и есть форма иконки, вокруг прозрачность.
const LOGO_SCALE = 1.0;

// Декодер и кодер PNG — общие со скриптом картинок установщика (см. scripts/pngLite.mjs).

// ── 1. читаем логотип ────────────────────────────────────────────────────────
const src = decodePng(readFileSync(SRC));
// Отделение знака от подложки — общий модуль: маска самое хрупкое место цепочки, и две её
// версии разъехались бы на первой же смене логотипа (см. scripts/logoMask.mjs).
const { px, alphaAt, minX, minY, logoW, logoH } = extractLogo(src);

// ── 3. рисуем плитку ─────────────────────────────────────────────────────────
// Холст полностью прозрачный: подложки нет, форму задаёт сам логотип.
const canvas = new Float32Array(W * W * 4);

// Логотип: вписываем по большей стороне, центрируем по габаритам.
const target = W * LOGO_SCALE;
const scale = target / Math.max(logoW, logoH);
const drawW = logoW * scale, drawH = logoH * scale;
const originX = (W - drawW) / 2, originY = (W - drawH) / 2;
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    if (x < originX || x >= originX + drawW || y < originY || y >= originY + drawH) continue;
    // Билинейная выборка из исходника — источник крупнее цели, поэтому этого достаточно.
    const fx = minX + ((x - originX) / drawW) * (logoW - 1);
    const fy = minY + ((y - originY) / drawH) * (logoH - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, src.width - 1), y1 = Math.min(y0 + 1, src.height - 1);
    const tx = fx - x0, ty = fy - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (const [sx, sy, wgt] of [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]]) {
      const c = px(sx, sy), al = alphaAt(sx, sy);
      r += c[0] * al * wgt; g += c[1] * al * wgt; b += c[2] * al * wgt; a += al * wgt;
    }
    if (a <= 0) continue;
    const o = (y * W + x) * 4;
    // Полная формула source-over с учётом альфы ПРИЁМНИКА. Упрощённый вариант
    // (src*a + dst*(1−a)) верен только поверх непрозрачного фона; на прозрачном холсте
    // он оставил бы цвет домноженным на альфу — по краю круга полез бы тёмный ореол.
    const dstA = canvas[o + 3];
    const outA = a + dstA * (1 - a);
    canvas[o] = ((r / a) * a + canvas[o] * dstA * (1 - a)) / outA;
    canvas[o + 1] = ((g / a) * a + canvas[o + 1] * dstA * (1 - a)) / outA;
    canvas[o + 2] = ((b / a) * a + canvas[o + 2] * dstA * (1 - a)) / outA;
    canvas[o + 3] = outA;
  }
}

// ── 4. даунсэмплинг и запись ─────────────────────────────────────────────────
const out = Buffer.alloc(OUT * OUT * 4);
for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
  let r = 0, g = 0, b = 0, a = 0;
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
    const o = ((y * SS + sy) * W + (x * SS + sx)) * 4, al = canvas[o + 3];
    r += canvas[o] * al; g += canvas[o + 1] * al; b += canvas[o + 2] * al; a += al;
  }
  const n = SS * SS, o = (y * OUT + x) * 4;
  out[o] = a > 0 ? Math.round(r / a) : 0;
  out[o + 1] = a > 0 ? Math.round(g / a) : 0;
  out[o + 2] = a > 0 ? Math.round(b / a) : 0;
  out[o + 3] = Math.round((a / n) * 255);
}

// ── 5. дуотон: светлота → «глубокий синий … белый» ───────────────────────────
// Зачем: в исходном логотипе облако лежит на бледном лавандово-РОЗОВОМ круге. Две беды сразу.
// (1) Контраст: бледный круг сливается с панелью задач (живая жалоба). (2) Цветовой закон: розово-
// сиреневый фон — это ровно тот фиолетовый, которого в системе быть не должно (см. CLAUDE.md).
//
// ⚠️ Разделить облако и фон по НАСЫЩЕННОСТИ не выходит: оба почти белые, и HSL-S у обоих высокая
// (артефакт светлых тонов — замер: фон S≈0.87, облако S≈0.60). Единственный разделитель —
// СВЕТЛОТА: облако чуть светлее фона (L≈0.95–0.98 против 0.91). Поэтому не красим пиксели по классу,
// а прогоняем ВСЮ картинку через дуотон: светлоту раскладываем на градиент от глубокого синего
// (--system) к белому. Облако выходит светлым, фон — насыщенно-синим, оба конца шкалы синие —
// сиреневому взяться неоткуда, крапинок от частичного смешения тоже. Контраст задаёт растяжка
// узкого исходного диапазона [LO..HI] на всю шкалу.
const LO = 0.895, HI = 0.975;        // реальный диапазон светлоты исходника (замер)
const DEEP = [18, 96, 206];          // #1260CE — глубокий синий, читается на любой панели задач
const LITE = [255, 255, 255];
for (let i = 0; i < OUT * OUT; i++) {
  const o = i * 4;
  if (out[o + 3] === 0) continue;
  const r = out[o], g = out[o + 1], b = out[o + 2];
  const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 510; // светлота HSL в 0..1
  let t = Math.max(0, Math.min(1, (l - LO) / (HI - LO)));
  t = t * t * (3 - 2 * t);                                 // smoothstep — тянет края к концам шкалы
  out[o]     = Math.round(DEEP[0] + (LITE[0] - DEEP[0]) * t);
  out[o + 1] = Math.round(DEEP[1] + (LITE[1] - DEEP[1]) * t);
  out[o + 2] = Math.round(DEEP[2] + (LITE[2] - DEEP[2]) * t);
}

writeFileSync(DEST, encodePng(OUT, out));
console.log(`[make-icon] ${DEST} — ${OUT}×${OUT}, логотип ${logoW}×${logoH} из исходника ${src.width}×${src.height}`);
