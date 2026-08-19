// Генератор ПРОСТРАНСТВА палитры: маршрут градиента земли из трёх остановок.
//
// Запуск руками: node scripts/palette-space.mjs — пересчитывает --space-1..3 во всех палитрах.
//
// ⚠️ ГРАДИЕНТ ИДЁТ ПО ОТТЕНКУ, А НЕ ПО СВЕТЛОТЕ, и это главное правило. Контраст считается из
// светлот, поэтому любой перепад светлоты тратит бюджет читаемости — в тёмной теме втрое дороже,
// чем в светлой (замер: 5 % света отнимают 0,144 у пары «земля → сцена» в тёмной и 0,011 в
// светлой). Оттенок же не стоит ничего: цвет гуляет, а все контрасты остаются на месте.
//
// ⚠️ КОРИДОР СВЕТЛОТЫ. Полностью запретить перепад нельзя — совсем ровная заливка читается
// пластиком, — поэтому остановки живут в узком коридоре: ±2 % в светлой теме и ±1 % в тёмной.
// Этого хватает, чтобы поверхность «дышала», и мало, чтобы что-то сломать.
//
// ⚠️ ПОВОРОТ ОТТЕНКА ±18°, не больше. Дальше начинается вторая беда градиентов: дополнительные
// цвета дают грязь на переходе. Аналоговые (соседние по кругу) смешиваются чисто — этим же
// правилом живёт chromeGround для цветной подкраски.
import fs from 'node:fs';
import path from 'node:path';

const TOKENS = path.join('src', 'styles', 'tokens');

// Земля палитры: от неё берётся оттенок маршрута.
const GROUND = {
  charcoal: { light: '#E9EAEF', dark: '#121214' },
  graphite: { light: '#E4E5E7', dark: '#1E1E1E' },
  slate: { light: '#DBE1EB', dark: '#2E3440' },
  paper: { light: '#E8E2D5', dark: '#14120F' },
  mint: { light: '#DEEAE2', dark: '#101613' },
  sky: { light: '#DCE5F6', dark: '#0F1319' },
};

// Насыщенность маршрута. ⚠️ В светлой теме цвет на большой площади читается СИЛЬНЕЕ, чем он есть
// (светлые оттенки воспринимаются насыщеннее), поэтому там доля втрое меньше: иначе окно уходит
// в цветную бумагу. В тёмной наоборот — ниже 18 % цвета не видно вовсе.
const SAT = { light: 0.075, dark: 0.20 };
const HUE_SWING = 18 / 360;
const CORRIDOR = { light: 0.020, dark: 0.010 };

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
function hsl(hex) {
  const [r, g, b] = hex2rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0.62, s: 0, l }; // нейтраль: оттенок берём холодный, иначе маршрут некуда вести
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}
function toHex({ h, s, l }) {
  if (s === 0) return rgb2hex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
  const ch = (t) => { let x = t; if (x < 0) x += 1; if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x; if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6; return p; };
  return rgb2hex([ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255]);
}

/** Три остановки маршрута: верх — холоднее, низ — теплее, светлота в коридоре. */
function space(ground, dark) {
  const base = hsl(ground);
  const s = dark ? SAT.dark : SAT.light;
  const dL = dark ? CORRIDOR.dark : CORRIDOR.light;
  const wrap = (h) => ((h % 1) + 1) % 1;
  return [
    toHex({ h: wrap(base.h - HUE_SWING), s, l: base.l + dL }).toUpperCase(),
    toHex({ h: base.h, s: s * 0.85, l: base.l }).toUpperCase(),
    toHex({ h: wrap(base.h + HUE_SWING), s, l: base.l - dL }).toUpperCase(),
  ];
}

function declare(stops, indent = 2) {
  const pad = ' '.repeat(indent);
  return stops.map((c, i) => `${pad}--space-${i + 1}: ${c};`).join('\n');
}

function patch(text, stops) {
  if (/--space-1:/.test(text)) {
    return text.replace(/--space-(\d): #[0-9A-Fa-f]{6};/g, (m, n) => `--space-${n}: ${stops[Number(n) - 1]};`);
  }
  return null;
}

// База — «Уголь».
{
  const p = path.join(TOKENS, 'colors.css');
  let css = fs.readFileSync(p, 'utf8');
  const stops = space(GROUND.charcoal.light, false);
  const patched = patch(css, stops);
  if (patched) css = patched;
  else {
    css = css.replace('  /* ── ШКАЛА НЕЙТРАЛИ', `  /* ── ПРОСТРАНСТВО ─────────────────────────────────────────────────
     Маршрут градиента земли: три остановки, идущие по ОТТЕНКУ при почти неизменной светлоте
     (разбор и числа — scripts/palette-space.mjs). Палитра перестаёт быть набором серых и
     становится пространством со своим характером, как у Arc, — но не ценой читаемости. */
${declare(stops)}

  /* ── ШКАЛА НЕЙТРАЛИ`);
  }
  fs.writeFileSync(p, css);
}
{
  const p = path.join(TOKENS, 'theme-dark.css');
  let css = fs.readFileSync(p, 'utf8');
  const stops = space(GROUND.charcoal.dark, true);
  const patched = patch(css, stops);
  if (patched) css = patched;
  else {
    css = css.replace('  /* Шкала нейтрали тёмной темы', `  /* Пространство тёмной темы: тот же маршрут по оттенку, коридор светлоты вдвое у́же — в тёмной
     теме перепад светлоты стоит втрое дороже (см. scripts/palette-space.mjs). */
${declare(stops)}

  /* Шкала нейтрали тёмной темы`);
  }
  fs.writeFileSync(p, css);
}

// Палитры.
{
  const p = path.join(TOKENS, 'palettes.css');
  let css = fs.readFileSync(p, 'utf8');
  for (const name of ['graphite', 'slate', 'paper', 'mint', 'sky']) {
    for (const dark of [false, true]) {
      const opener = dark
        ? `[data-palette="${name}"][data-theme="dark"]:not([data-incognito="true"]) {`
        : `[data-palette="${name}"]:not([data-theme="dark"]) {`;
      const start = css.indexOf(opener);
      if (start === -1) continue;
      const end = css.indexOf('\n}', start);
      let body = css.slice(start + opener.length, end);
      const stops = space(GROUND[name][dark ? 'dark' : 'light'], dark);
      const patched = patch(body, stops);
      body = patched ?? `\n  /* Пространство палитры — маршрут градиента земли (см. scripts/palette-space.mjs). */\n${declare(stops)}\n${body}`;
      css = css.slice(0, start + opener.length) + body + css.slice(end);
    }
  }
  fs.writeFileSync(p, css);
}
console.log('пространства пересчитаны');
for (const [name, g] of Object.entries(GROUND)) {
  console.log(`  ${name.padEnd(9)} св ${space(g.light, false).join(' ')}   тм ${space(g.dark, true).join(' ')}`);
}
