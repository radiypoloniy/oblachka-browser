// Прогон контраста текста по ВСЕМ палитрам и обеим темам — без electron, обычным node.
//
// Зачем машина, если цвет «видно глазами»: палитр шесть, тем две, ролей текста четыре,
// поверхностей шесть — это под три сотни сочетаний, и человек физически не проверит их после
// правки одного оттенка. А правка одного оттенка тут обычное дело: акцент палитры питает
// --card/--card-high формулой, то есть смена акцента молча двигает фон под текстом виджетов.
//
// ⚠️ Проверяется ЧИТАЕМОСТЬ, а не вкус. Пороги — WCAG 2.1: 4.5 для основного текста, 3.0 для
// крупного и нетекстовых меток. Роль --text-faint держим по 3.0 осознанно: это подписи-компаньоны
// (единицы, даты, «ещё 4»), у которых задача НЕ читаться первыми.
//
// ⚠️ Читает CSS напрямую, а не копию значений: копия разъедется с файлом на первой же правке,
// и проверка начнёт охранять цвета, которых в приложении уже нет.
//
// Запуск: npm run contrast-check (или npm test -- contrast); с --report печатает таблицы замеров.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrast } from '../shared/chromeGround.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = path.join(ROOT, 'src', 'styles', 'tokens');

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

// ── разбор CSS ───────────────────────────────────────────────────────
// Порядок файлов = порядок @import в global.css: последний выигрывает при равной весомости.
const FILES = ['colors.css', 'theme-dark.css', 'palettes.css'];

/** Блоки «селектор { --токен: значение; }» с вырезанными комментариями. */
function readBlocks(file) {
  const css = fs.readFileSync(path.join(TOKENS, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map();
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      decls.set(name, value.trim());
    }
    if (decls.size) out.push({ selector: selector.trim(), decls });
  }
  return out;
}

const BLOCKS = FILES.flatMap(readBlocks);

/**
 * Подходит ли блок контексту. Селекторы здесь — только «:root» и цепочки атрибутов, возможно
 * с «:not(...)»; разбираем их буквально, чтобы не гадать по подстрокам.
 */
function matches(selector, ctx) {
  const attrs = {
    theme: ctx.dark ? 'dark' : 'light',
    palette: ctx.palette,
    incognito: ctx.incognito ? 'true' : 'false',
  };
  const nots = [...selector.matchAll(/:not\(\[data-(\w+)="([^"]+)"\]\)/g)];
  const bare = selector.replace(/:not\([^)]*\)/g, '');
  for (const [, key, value] of bare.matchAll(/\[data-(\w+)="([^"]+)"\]/g)) {
    if (attrs[key] !== value) return false;
  }
  for (const [, key, value] of nots) {
    if (attrs[key] === value) return false;
  }
  return true;
}

/** Итоговая таблица токенов для контекста. */
function tokensFor(ctx) {
  const out = new Map();
  for (const b of BLOCKS) {
    if (!matches(b.selector, ctx)) continue;
    for (const [k, v] of b.decls) out.set(k, v);
  }
  return out;
}

// ── цвет ─────────────────────────────────────────────────────────────
function parseColor(str) {
  const s = str.trim();
  if (s === 'transparent') return [0, 0, 0, 0];
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return null;
}

const toHex = (c) =>
  '#' + c.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');

/** Раскрытие var() и color-mix(in srgb, A p%, B) до четвёрки rgba. */
function resolve(value, tokens, depth = 0) {
  if (depth > 12) throw new Error(`цикл в значении: ${value}`);
  const s = value.trim();

  const v = /^var\((--[\w-]+)(?:\s*,\s*(.+))?\)$/.exec(s);
  if (v) {
    const next = tokens.get(v[1]) ?? v[2];
    if (next == null) throw new Error(`токен ${v[1]} не определён`);
    return resolve(next, tokens, depth + 1);
  }

  const mix = /^color-mix\(\s*in srgb\s*,\s*(.+)\)$/i.exec(s);
  if (mix) {
    // Аргументы делим по запятым ВЕРХНЕГО уровня: внутри бывает свой var()/color-mix().
    const parts = [];
    let level = 0;
    let buf = '';
    for (const ch of mix[1]) {
      if (ch === '(') level++;
      if (ch === ')') level--;
      if (ch === ',' && level === 0) { parts.push(buf); buf = ''; continue; }
      buf += ch;
    }
    parts.push(buf);
    const read = (p) => {
      const pm = /(.+?)\s+(\d+(?:\.\d+)?)%$/.exec(p.trim());
      return pm ? { color: pm[1], pct: parseFloat(pm[2]) / 100 } : { color: p.trim(), pct: null };
    };
    const a = read(parts[0]);
    const b = read(parts[1]);
    const pa = a.pct ?? (b.pct != null ? 1 - b.pct : 0.5);
    const ca = resolve(a.color, tokens, depth + 1);
    const cb = resolve(b.color, tokens, depth + 1);
    // Прозрачная составляющая уменьшает альфу результата — это нужно для --accent-soft.
    const alpha = ca[3] * pa + cb[3] * (1 - pa);
    return [ca[0] * pa + cb[0] * (1 - pa), ca[1] * pa + cb[1] * (1 - pa), ca[2] * pa + cb[2] * (1 - pa), alpha];
  }

  const direct = parseColor(s);
  if (direct) return direct;
  throw new Error(`не разобрал цвет: ${s}`);
}

/** Композит поверх непрозрачной подложки — полупрозрачные острова и текст живут не в вакууме. */
function over(color, backdrop) {
  const a = color[3];
  return [
    color[0] * a + backdrop[0] * (1 - a),
    color[1] * a + backdrop[1] * (1 - a),
    color[2] * a + backdrop[2] * (1 - a),
    1,
  ];
}

// ── что меряем ───────────────────────────────────────────────────────
const PALETTES = [
  ['Уголь', 'charcoal'], ['Графит', 'graphite'], ['Сланец', 'slate'],
  ['Бумага', 'paper'], ['Мята', 'mint'], ['Небо', 'sky'],
];

// Пороги на роль. strong/body/muted — основной текст (4.5), faint — компаньон (3.0).
const ROLES = [
  ['--text-strong', 4.5], ['--text-body', 4.5], ['--text-muted', 4.5], ['--text-faint', 3.0],
];

// Поверхности, на которых текст реально лежит. Полупрозрачные кладём на землю палитры.
const GROUNDS = [
  ['остров', '--surface'],
  ['земля', '--app-bg'],
  ['колодец', '--surface-sunken'],
  ['карточка', '--card'],
  ['карточка+', '--card-high'],
  ['стекло', '--surface-island'],
];

const rows = [];

for (const [label, palette] of PALETTES) {
  for (const dark of [false, true]) {
    const ctx = { palette, dark, incognito: false };
    const t = tokensFor(ctx);
    const bg = new Map();
    for (const [name, token] of GROUNDS) {
      bg.set(name, over(resolve(`var(${token})`, t), resolve('var(--app-bg)', t)));
    }
    for (const [role, min] of ROLES) {
      const ink = over(resolve(`var(${role})`, t), bg.get('остров'));
      for (const [name] of GROUNDS) {
        rows.push({
          label, dark, role, ground: name, min, ink: toHex(ink),
          ratio: contrast(toHex(ink), toHex(bg.get(name))),
        });
      }
    }
    // Текст на акценте и сам акцент как нетекстовая метка — отдельная пара ролей.
    const accent = resolve('var(--accent)', t);
    const onAccent = resolve('var(--on-accent)', t);
    rows.push({
      label, dark, role: '--on-accent', ground: 'акцент', min: 4.5, ink: toHex(accent),
      ratio: contrast(toHex(over(onAccent, accent)), toHex(accent)),
    });
    rows.push({
      label, dark, role: '--accent', ground: 'остров', min: 3.0, ink: toHex(accent),
      ratio: contrast(toHex(accent), toHex(bg.get('остров'))),
    });
  }
}

// ── ступени поверхностей ─────────────────────────────────────────────
// ⚠️ Мерим НЕ читаемость текста, а различимость самих плоскостей. Земля, остров, колодец и
// карточка обязаны отличаться друг от друга: когда ступени сходятся, экран читается сплошным
// пятном, элементы перестают иметь границы — «всё сливается». В тёмных темах это случается
// раньше, потому что разница светлоты на тёмном конце шкалы воспринимается слабее.
const steps = [];
for (const [label, palette] of PALETTES) {
  for (const dark of [false, true]) {
    const t = tokensFor({ palette, dark, incognito: false });
    const bg = (token) => over(resolve(`var(${token})`, t), resolve('var(--app-bg)', t));
    const pairs = [
      ['земля → остров', '--app-bg', '--surface'],
      ['остров → колодец', '--surface', '--surface-sunken'],
      ['остров → карточка', '--surface', '--card'],
      ['карточка → карточка+', '--card', '--card-high'],
    ];
    for (const [name, a, b] of pairs) {
      steps.push({ label, dark, name, ratio: contrast(toHex(bg(a)), toHex(bg(b))) });
    }
  }
}

// ── отчёт ────────────────────────────────────────────────────────────
if (process.argv.includes('--report')) {
  for (const [label] of PALETTES) {
    for (const dark of [false, true]) {
      const mine = rows.filter((r) => r.label === label && r.dark === dark);
      const roles = [...new Set(mine.map((r) => r.role))];
      const grounds = [...new Set(mine.map((r) => r.ground))];
      console.log(`\n── ${label}, ${dark ? 'тёмная' : 'светлая'} ──`);
      console.log('  роль'.padEnd(16) + grounds.map((g) => g.padStart(10)).join(''));
      for (const role of roles) {
        const cells = grounds.map((g) => {
          const r = mine.find((x) => x.role === role && x.ground === g);
          return (r ? (r.ratio < r.min ? '!' : ' ') + r.ratio.toFixed(2) : '·').padStart(10);
        });
        console.log(('  ' + role.replace('--text-', '').replace('--', '')).padEnd(16) + cells.join(''));
      }
    }
  }
  console.log('\n── ступени поверхностей (различимость плоскостей) ──');
  const names = [...new Set(steps.map((s) => s.name))];
  console.log('  палитра'.padEnd(18) + names.map((n) => n.padStart(20)).join(''));
  for (const [label] of PALETTES) {
    for (const dark of [false, true]) {
      const cells = names.map((n) => {
        const r = steps.find((s) => s.label === label && s.dark === dark && s.name === n);
        return r.ratio.toFixed(3).padStart(20);
      });
      console.log(`  ${label} ${dark ? 'тм' : 'св'}`.padEnd(18) + cells.join(''));
    }
  }
  console.log('');
}

// ── ассерты ──────────────────────────────────────────────────────────
console.log('— читаемость текста на поверхностях —');
for (const [label] of PALETTES) {
  for (const dark of [false, true]) {
    const bad = rows
      .filter((r) => r.label === label && r.dark === dark && r.ratio < r.min)
      .map((r) => `${r.role} на «${r.ground}» ${r.ratio.toFixed(2)} < ${r.min}`);
    check(`${label}, ${dark ? 'тёмная' : 'светлая'}: все пары держат порог`, bad, []);
  }
}

console.log('\n— плоскости различимы —');
// ⚠️ Отдельная величина от читаемости текста, и её отсутствие читается как «в тёмной теме всё
// сливается»: замер до правки давал 1,069 между землёй и островом у «Бумаги» и 1,089 у «Неба» —
// панель не отделялась от фона окна вовсе. Пороги — нижняя граница, на которой ступень ещё видно;
// поднимать их «на всякий случай» нельзя: выше начинает проваливаться текст НА этих поверхностях,
// то есть две проверки держат друг друга за руки.
const STEP_MIN = {
  'земля → остров': 1.20,
  'остров → колодец': 1.15,
  'остров → карточка': 1.10,
  'карточка → карточка+': 1.10,
};
for (const [label] of PALETTES) {
  for (const dark of [false, true]) {
    const bad = steps
      .filter((r) => r.label === label && r.dark === dark && r.ratio < STEP_MIN[r.name])
      .map((r) => `${r.name} ${r.ratio.toFixed(3)} < ${STEP_MIN[r.name]}`);
    check(`${label}, ${dark ? 'тёмная' : 'светлая'}: ступени видны`, bad, []);
  }
}

console.log('\n— иерархия ролей не перепутана —');
// ⚠️ Это важнее абсолютных цифр: ступень, вставшая не по порядку, ломает чтение экрана, даже
// когда каждая по отдельности проходит порог.
for (const [label] of PALETTES) {
  for (const dark of [false, true]) {
    const on = (role) =>
      rows.find((r) => r.label === label && r.dark === dark && r.role === role && r.ground === 'остров').ratio;
    const ladder = [on('--text-strong'), on('--text-body'), on('--text-muted'), on('--text-faint')];
    check(
      `${label}, ${dark ? 'тёмная' : 'светлая'}: strong > body > muted > faint`,
      ladder.every((v, i) => i === 0 || ladder[i - 1] > v),
      true,
    );
  }
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
