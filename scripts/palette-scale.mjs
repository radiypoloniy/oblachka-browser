// Генератор шкалы нейтрали для палитр Oblako.
//
// Запуск руками: node scripts/palette-scale.mjs — пересчитывает --n1..--n12 во всех палитрах и
// обеих темах прямо в CSS. В npm test НЕ входит: это инструмент, а не проверка (проверяет
// результат contrast-check).
//
// ⚠️ ЗАЧЕМ ШКАЛА. Роли (поверхность, колодец, текст) раньше подбирались каждая отдельно и каждая
// со своим замером — двенадцать контекстов × восемь ролей, и любая новая пара означала новый
// подбор. Теперь ступеней двенадцать с закреплённым назначением (1-2 поверхности, 3-5 земля и
// колодец, 6-8 границы, 9-12 текст), а роль — ссылка на ступень. Так устроены Radix и Geist.
//
// ⚠️ ДВЕ ЧАСТИ ШКАЛЫ СЧИТАЮТСЯ ПО-РАЗНОМУ, и это не непоследовательность:
//  • ступени 1-8 (поверхности и границы) — по фиксированной светлоте: их задача держать
//    РАЗЛИЧИМОСТЬ ПЛОСКОСТЕЙ, а она одинакова во всех палитрах;
//  • ступени 9-12 (текст) — подбором под целевой контраст на ХУДШЕЙ поверхности палитры. Худшая
//    у всех разная: это «карточка+» (остров плюс доля акцента), а акценты свои — у «Мяты» он
//    светло-зелёный, у «Бумаги» тёплый. Одна кривая светлоты на всех честно проваливалась именно
//    там, и поймал это contrast-check, а не глаз.
//
// ⚠️ Тон берётся у ЗЕМЛИ палитры, насыщенность зажата потолком и падает к краям шкалы: без этого
// самые светлые и самые тёмные ступени «цветут» — там глаз к оттенку чувствительнее всего.
import fs from 'node:fs';
import path from 'node:path';

const TOKENS = path.join('src', 'styles', 'tokens');
const L_LIGHT = [0.998, 0.972, 0.938, 0.898, 0.874, 0.840, 0.770, 0.650, 0.495, 0.395, 0.255, 0.120];
const L_DARK = [0.072, 0.102, 0.132, 0.168, 0.215, 0.275, 0.350, 0.470, 0.615, 0.720, 0.825, 0.965];
const S_MUL = [0.35, 0.45, 0.6, 0.75, 0.85, 1.0, 1.0, 0.95, 0.9, 0.85, 0.8, 0.75];
const CAP = 0.17;
const GROUND = {
  charcoal: { light: '#E9EAEF', dark: '#121214' },
  graphite: { light: '#E4E5E7', dark: '#1E1E1E' },
  slate: { light: '#DBE1EB', dark: '#2E3440' },
  paper: { light: '#E8E2D5', dark: '#14120F' },
  mint: { light: '#DEEAE2', dark: '#101613' },
  sky: { light: '#DCE5F6', dark: '#0F1319' },
};

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, p) => rgb2hex([0, 1, 2].map((i) => hex2rgb(a)[i] * p + hex2rgb(b)[i] * (1 - p)));
const lum = (hex) => {
  const [r, g, b] = hex2rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

function hsl(hex) {
  const [r, g, b] = hex2rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
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
function scaleFor(ground, dark) {
  const base = hsl(ground); const s = Math.min(base.s, CAP);
  return (dark ? L_DARK : L_LIGHT).map((l, i) => toHex({ h: base.h, s: s * S_MUL[i], l }).toUpperCase());
}

/** Переписать значения --n1..--n12 внутри одного блока. */
function rewrite(text, scale) {
  return text.replace(/--n(\d+): #[0-9A-Fa-f]{6};/g, (m, n) => `--n${n}: ${scale[Number(n) - 1]};`);
}

// База.
const files = [
  ['colors.css', scaleFor(GROUND.charcoal.light, false)],
  ['theme-dark.css', scaleFor(GROUND.charcoal.dark, true)],
];
for (const [f, scale] of files) {
  const p = path.join(TOKENS, f);
  fs.writeFileSync(p, rewrite(fs.readFileSync(p, 'utf8'), scale));
}

// Палитры — по блокам.
const p = path.join(TOKENS, 'palettes.css');
let css = fs.readFileSync(p, 'utf8');
const BLOCKS = [
  ['graphite', false], ['graphite', true], ['slate', false], ['slate', true],
  ['paper', false], ['paper', true], ['mint', false], ['mint', true], ['sky', false], ['sky', true],
];
for (const [name, isDark] of BLOCKS) {
  const opener = isDark
    ? `[data-palette="${name}"][data-theme="dark"]:not([data-incognito="true"]) {`
    : `[data-palette="${name}"]:not([data-theme="dark"]) {`;
  const start = css.indexOf(opener);
  if (start === -1) continue;
  const end = css.indexOf('\n}', start);
  const body = rewrite(css.slice(start, end), scaleFor(GROUND[name][isDark ? 'dark' : 'light'], isDark));
  css = css.slice(0, start) + body + css.slice(end);
}
fs.writeFileSync(p, css);
console.log('шкалы подстроены');


// ── Ступени текста: подбор по контрасту ──
{

// Земля, остров и акцент каждой палитры — то, из чего считается худшая поверхность.
const SURFACES = {
  charcoal: { l: ['#E9EAEF', '#FDFDFD', '#2C4BD8'], d: ['#121214', '#28282C', '#6E8BFF'] },
  graphite: { l: ['#E4E5E7', '#FDFDFD', '#3F6FB5'], d: ['#1E1E1E', '#2A2A2A', '#628CC9'] },
  slate: { l: ['#DBE1EB', '#FDFDFD', '#4C6B92'], d: ['#2E3440', '#25282F', '#8BA4C2'] },
  paper: { l: ['#E8E2D5', '#FDFDFD', '#94502A'], d: ['#14120F', '#2F2B26', '#CC7A4C'] },
  mint: { l: ['#DEEAE2', '#FDFDFD', '#16794B'], d: ['#101613', '#252F2A', '#3DDC92'] },
  sky: { l: ['#DCE5F6', '#FDFDFD', '#1667CE'], d: ['#0F1319', '#25292F', '#3081E9'] },
};
// Целевой контраст ступени на худшей поверхности. Те же значения, что держали чернила.
const TARGET = { 9: 3.35, 10: 4.90, 11: 7.5, 12: 11.0 };
const S_TEXT = { 9: 0.9, 10: 0.85, 11: 0.8, 12: 0.75 };
const CAP_TEXT = 0.17;

function textSteps(ground, surface, accent, dark) {
  const worst = mix(accent, surface, dark ? 0.21 : 0.19);
  const base = hsl(ground);
  const out = {};
  for (const step of [9, 10, 11, 12]) {
    const s = Math.min(base.s, CAP_TEXT) * S_TEXT[step];
    let lo = 0; let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const ok = contrast(toHex({ h: base.h, s, l: mid }), worst) >= TARGET[step];
      if (dark) { if (ok) hi = mid; else lo = mid; } else { if (ok) lo = mid; else hi = mid; }
    }
    out[step] = toHex({ h: base.h, s, l: dark ? hi : lo }).toUpperCase();
  }
  return out;
}

function patchText(text, steps) {
  return text.replace(/--n(\d+): #[0-9A-Fa-f]{6};/g, (m, n) => (steps[n] ? `--n${n}: ${steps[n]};` : m));
}

for (const [file, name, dark] of [['colors.css', 'charcoal', false], ['theme-dark.css', 'charcoal', true]]) {
  const p = path.join(TOKENS, file);
  const [g, s, a] = SURFACES[name][dark ? 'd' : 'l'];
  fs.writeFileSync(p, patchText(fs.readFileSync(p, 'utf8'), textSteps(g, s, a, dark)));
}

const pp = path.join(TOKENS, 'palettes.css');
let css = fs.readFileSync(pp, 'utf8');
for (const name of ['graphite', 'slate', 'paper', 'mint', 'sky']) {
  for (const dark of [false, true]) {
    const opener = dark
      ? `[data-palette="${name}"][data-theme="dark"]:not([data-incognito="true"]) {`
      : `[data-palette="${name}"]:not([data-theme="dark"]) {`;
    const start = css.indexOf(opener);
    if (start === -1) continue;
    const end = css.indexOf('\n}', start);
    const [g, s, a] = SURFACES[name][dark ? 'd' : 'l'];
    css = css.slice(0, start) + patchText(css.slice(start, end), textSteps(g, s, a, dark)) + css.slice(end);
  }
}
fs.writeFileSync(pp, css);
console.log('текстовые ступени подобраны по контрасту');
}
