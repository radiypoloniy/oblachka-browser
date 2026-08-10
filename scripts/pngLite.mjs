// Минимальные декодер и кодер PNG для скриптов сборки (иконка приложения, картинки установщика).
//
// Почему свой кодек, а не sharp/jimp: ради нескольких файлов на этапе сборки тащить в проект
// нативную графическую зависимость не хочется (см. CLAUDE.md про зависимости). PNG здесь без
// интерлейса, 8 бит на канал — этого достаточно, чтобы обойтись zlib из стандартной библиотеки.
//
// ⚠️ Вынесено из scripts/make-icon.mjs, когда понадобился второй потребитель (make-installer-art).
// Копировать шестьдесят строк разбора формата во второй файл — верный способ получить два
// декодера, которые разойдутся на первой же правке.
import { deflateSync, inflateSync } from 'node:zlib';

/** Декодер PNG: 8 бит/канал, без интерлейса, colorType 2 (RGB) или 6 (RGBA). */
export function decodePng(buf) {
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

/** Кодер PNG (RGBA8, квадрат size×size). */
export function encodePng(size, rgba) {
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

/**
 * Кодер BMP, 24 бита на пиксель, без сжатия — формат картинок мастера NSIS.
 *
 * ⚠️ Именно 24 бита и никакой альфы: MUI рисует эти картинки штатным Windows-контролом, который
 * альфа-канал BMP игнорирует, а 32-битный файл частью сборок NSIS не читается вовсе. Поэтому
 * прозрачности здесь нет по определению — всё сводится к непрозрачному фону ещё при отрисовке.
 * ⚠️ Строки идут СНИЗУ ВВЕРХ и выравниваются до 4 байт — это требование формата, а не стиль.
 */
export function encodeBmp24(width, height, rgb) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const dst = (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 3, d = dst + x * 3;
      pixels[d] = rgb[s + 2];      // BMP хранит цвет как BGR
      pixels[d + 1] = rgb[s + 1];
      pixels[d + 2] = rgb[s];
    }
  }
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);
  header.writeInt32LE(2835, 38); // 72 dpi
  header.writeInt32LE(2835, 42);
  return Buffer.concat([header, pixels]);
}
