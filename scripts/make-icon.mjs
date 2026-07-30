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
import { deflateSync, inflateSync } from 'node:zlib';
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

// ── декодер PNG (8 бит/канал, без интерлейса, colorType 2/6) ──────────────────
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('не PNG');
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  const depth = buf[24], colorType = buf[25], interlace = buf[28];
  if (depth !== 8) throw new Error(`ожидалось 8 бит на канал, получено ${depth}`);
  if (interlace !== 0) throw new Error('интерлейс не поддерживается');
  if (colorType !== 2 && colorType !== 6) throw new Error(`colorType ${colorType} не поддерживается`);
  const channels = colorType === 6 ? 4 : 3;

  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));

  // Обратные фильтры PNG (спека, §9.2): каждая строка префиксована байтом типа фильтра.
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;   // левый
      const b = prev ? prev[i] : 0;                       // верхний
      const c = prev && i >= channels ? prev[i - channels] : 0; // верхне-левый
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

// ── кодер PNG (RGBA8) ────────────────────────────────────────────────────────
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 1. читаем логотип ────────────────────────────────────────────────────────
const src = decodePng(readFileSync(SRC));
const sc = src.channels;
const px = (x, y) => { const o = (y * src.width + x) * sc; return [src.data[o], src.data[o + 1], src.data[o + 2]]; };

// ── 2. отделяем логотип от подложки ──────────────────────────────────────────
// Заливкой ОТ КРАЁВ, а не «все белые пиксели прозрачные»: внутри облака тоже есть почти
// белые области, и порог по цвету выел бы их вместе с фоном. Заливка убирает только
// внешнюю связную подложку.
const bg = px(0, 0);
const dist = (c) => Math.max(Math.abs(c[0] - bg[0]), Math.abs(c[1] - bg[1]), Math.abs(c[2] - bg[2]));
const TOL = 10;
const isBg = new Uint8Array(src.width * src.height);
{
  const stack = [];
  const push = (x, y) => {
    const i = y * src.width + x;
    if (isBg[i] || dist(px(x, y)) > TOL) return;
    isBg[i] = 1; stack.push(i);
  };
  for (let x = 0; x < src.width; x++) { push(x, 0); push(x, src.height - 1); }
  for (let y = 0; y < src.height; y++) { push(0, y); push(src.width - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % src.width, y = (i / src.width) | 0;
    if (x > 0) push(x - 1, y);
    if (x < src.width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < src.height - 1) push(x, y + 1);
  }
}
// Мягкий край: у самой границы альфа берётся по удалённости от цвета подложки, иначе
// после масштабирования вылезет «пила».
const alphaAt = (x, y) => {
  if (isBg[y * src.width + x]) return 0;
  return Math.min(1, dist(px(x, y)) / TOL);
};

// Габариты логотипа — центрируем по реальному содержимому, а не по центру исходника.
let minX = src.width, minY = src.height, maxX = -1, maxY = -1;
for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
  if (!isBg[y * src.width + x]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
const logoW = maxX - minX + 1, logoH = maxY - minY + 1;

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

writeFileSync(DEST, encodePng(OUT, out));
console.log(`[make-icon] ${DEST} — ${OUT}×${OUT}, логотип ${logoW}×${logoH} из исходника ${src.width}×${src.height}`);
