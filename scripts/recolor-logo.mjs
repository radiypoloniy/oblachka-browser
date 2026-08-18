// Перекраска исходника логотипа: сиреневый хвост градиента уводится в голубой-мятный.
//
// ⚠️ Зачем скрипт, а не «перерисовать в редакторе». Присланный логотип хорош по форме, но его
// градиент уходит в сиреневый и розовый, а в системе фиолетового нет вообще — ни токена, ни
// литерала, и правило распространяется на сгенерированный цвет тоже (см. цветовой закон в
// CLAUDE.md). Перекраска нужна повторяемая: если пришлют новую версию логотипа, её надо будет
// прогнать тем же преобразованием, а не подбирать пипеткой заново.
//
// Как работает: каждый пиксель переводится в HSL; всё, что попало в сектор «сине-фиолетовый и
// дальше» (оттенок больше HUE_START), сжимается обратно к синему краю. Светлота и насыщенность не
// трогаются вовсе — иначе потеряется объём облака, ради которого логотип и брали.
//
// Запуск: node scripts/recolor-logo.mjs <исходник.png> [приёмник.png]
//         (по умолчанию приёмник — build/logo-source.png, дальше npm run make-icon)
import { decodePng, encodePng } from './pngLite.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Сектор, который считаем «уехавшим в сиреневый», и куда его складываем.
// 250° — граница синего; всё, что правее (фиолет, розовый, пурпур), сжимается в диапазон
// HUE_MIN…HUE_START, то есть в голубой-синий. 190° — бирюзовый край, дальше уходить незачем:
// логотип должен остаться синим облаком, а не стать мятным.
// ⚠️ Порог 232, а не 250, и это замер, а не вкус. С порогом 250 правый край логотипа оставался
// на 244–247° — формально синий, глазом лавандовый, и логотип читался двухцветным. У земли окна
// мы уже держим правило «разброс тона по ступеням ≤ 14°» (chrome-ground-check); логотипу нужна та
// же дисциплина: весь круг теперь укладывается примерно в 205…232°.
const HUE_START = 232;
const HUE_MIN = 205;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;
  const ch = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [ch(hk + 1 / 3) * 255, ch(hk) * 255, ch(hk - 1 / 3) * 255];
}

const src = process.argv[2];
if (!src) {
  console.error('Использование: node scripts/recolor-logo.mjs <исходник.png> [приёмник.png]');
  process.exit(1);
}
const dest = process.argv[3] ?? resolve(ROOT, 'build', 'logo-source.png');

const img = decodePng(readFileSync(src));
const { width, height, data } = img;
// ⚠️ Исходник может быть и RGB, и RGBA: генераторы картинок отдают без альфы, а наш кодер
// пишет строго RGBA. Считаем шаг по факту, а не по вере — иначе перекраска поедет по каналам и
// картинка превратится в цветной шум (ровно так и вышло на первом прогоне).
const stride = data.length / (width * height);
if (stride !== 3 && stride !== 4) throw new Error(`неожиданный формат: ${stride} канала на пиксель`);
let touched = 0;

for (let i = 0; i < data.length; i += stride) {
  const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
  if (s < 0.06) continue;             // почти серое — оттенок там случайный, не трогаем
  // Сектор 250…330° — сиреневый и розовый. 330…360 это уже красный край, он в логотипе не
  // встречается, но если встретится — оставляем: перекрашивать красное в синее незачем.
  if (h < HUE_START || h > 330) continue;
  // Линейно складываем 250…330 в 190…250: чем дальше пиксель ушёл в фиолет, тем ближе к
  // бирюзовому краю он окажется. Так сохраняется ХОД градиента, а не заливается одним тоном.
  const k = Math.min(1, (h - HUE_START) / (330 - HUE_START));
  const nh = HUE_START - k * (HUE_START - HUE_MIN);
  const [r, g, b] = hslToRgb(nh, s, l);
  data[i] = Math.round(r); data[i + 1] = Math.round(g); data[i + 2] = Math.round(b);
  touched++;
}

// ⚠️ Кодек проекта пишет КВАДРАТ и ждёт Buffer (см. scripts/pngLite.mjs): логотип и так
// квадратный, но проверить дешевле, чем получить сдвинутую картинку.
if (width !== height) throw new Error(`ожидался квадрат, получено ${width}×${height}`);
// В RGBA: либо как есть, либо дополняем непрозрачной альфой.
const rgba = stride === 4 ? Buffer.from(data) : Buffer.alloc(width * height * 4);
if (stride === 3) {
  for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
    rgba[q] = data[p]; rgba[q + 1] = data[p + 1]; rgba[q + 2] = data[p + 2]; rgba[q + 3] = 255;
  }
}
writeFileSync(dest, encodePng(width, rgba));
console.log(`Перекрашено пикселей: ${touched} из ${width * height}`);
console.log(`Записано: ${dest}`);
console.log('Дальше: npm run make-icon');
