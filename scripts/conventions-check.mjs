// Правила именно этого проекта — то, чего не проверяет ни tsc, ни один готовый линтер.
//
// ⚠️ Почему не ESLint. Правила ниже специфичны для Oblako: «фиолетового в системе нет»,
// «renderer ходит через window.oblako», «модуль под проверкой не тянет значимых импортов». В
// ESLint это всё равно пришлось бы писать своим плагином — то есть тот же код, плюс зависимость,
// плюс конфиг. Готовые правила (react-hooks, no-floating-promises) — отдельный разговор и
// отдельная установка; здесь только то, что стоит ноль и работает сегодня.
//
// Запуск: npm test -- conventions
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let passed = 0;
let failed = 0;

function checkEmpty(what, hits, hint) {
  const ok = hits.length === 0;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}${ok ? '' : ` — ${hits.length}`}`);
  if (!ok) {
    for (const h of hits.slice(0, 20)) console.log(`         ${h}`);
    if (hits.length > 20) console.log(`         …ещё ${hits.length - 20}`);
    if (hint) console.log(`         → ${hint}`);
  }
}

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n === 'dist-electron') continue;
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => n.endsWith(e))) out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

// Комментарии из проверки исключаем: в них как раз и объясняют, почему чего-то нельзя, — и сами
// объяснения не должны срабатывать как нарушения.
//
// ⚠️ Разбор с СОСТОЯНИЕМ, а не построчный: и в CSS, и в JSX запреты объясняются многострочными
// блоками /* … */, и построчная чистка ловила их середину как нарушение — первая же версия этой
// проверки покраснела на собственных комментариях про запрет фиолетового.
function codeLines(text) {
  const out = [];
  let inBlock = false;
  for (const raw of text.split('\n')) {
    let line = '';
    for (let i = 0; i < raw.length; i++) {
      if (inBlock) {
        if (raw[i] === '*' && raw[i + 1] === '/') { inBlock = false; i++; }
        continue;
      }
      if (raw[i] === '/' && raw[i + 1] === '*') { inBlock = true; i++; continue; }
      if (raw[i] === '/' && raw[i + 1] === '/') break; // строчный комментарий — остаток строки
      line += raw[i];
    }
    out.push(line);
  }
  return out;
}

// ── 1. Фиолетового в СИСТЕМНЫХ цветах нет ───────────────────────────────────
//
// Правило из CLAUDE.md: «Фиолетового в системе нет вообще — ни токена, ни литерала». Оно уже
// дважды нарушалось через значки (--tile-purple/--tile-indigo, литерал #AF52DE у глифа «Цвета»)
// и один раз через СГЕНЕРИРОВАННЫЙ оттенок (подложка иконки сайта выводилась из домена как
// hash % 360 и раздавала весь круг вместе с сиреневым сектором).
//
// ⚠️ Закон про цвета САМОЙ СИСТЕМЫ, а не про то, что выбирает человек. Два исключения ниже
// законны и проверены: палитра групп вкладок (фиолетовый прямо предусмотрен контрактом
// GroupNode.color, ровно как в Chrome) и обои домашнего экрана (это картинка, а не роль).
const USER_CHOSEN = [
  /--wallpaper-/,                                        // обои: человек выбирает сам
  /\b(red|orange|yellow|green|blue|purple)\s*:\s*'#/,    // палитра групп вкладок (GroupNode.color)
];

function hueSat(hex) {
  const parts = hex.length === 4
    ? [hex[1] + hex[1], hex[2] + hex[2], hex[3] + hex[3]]
    : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
  const [r, g, b] = parts.map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / max };
}

{
  const hits = [];
  for (const f of walk(path.join(ROOT, 'src'), ['.ts', '.tsx', '.css'])) {
    codeLines(fs.readFileSync(f, 'utf8')).forEach((line, i) => {
      if (USER_CHOSEN.some((re) => re.test(line))) return;
      if (/\b(purple|violet|magenta|fuchsia)\b/i.test(line)) {
        hits.push(`${rel(f)}:${i + 1}  имя: ${line.trim().slice(0, 70)}`);
      }
      for (const m of line.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
        const { h, s } = hueSat(m[0]);
        // Сиреневый сектор круга. Порог по насыщенности отсекает почти-серые оттенки, которые
        // формально попадают в диапазон, но фиолетовыми не выглядят.
        if (h >= 265 && h <= 320 && s > 0.25) hits.push(`${rel(f)}:${i + 1}  оттенок ${Math.round(h)}°: ${m[0]}`);
      }
    });
  }
  checkEmpty('фиолетового нет в системных цветах src/', hits,
    'цветовой закон в CLAUDE.md; нужен ещё один цвет значка — брать из --tile-red/brown/slate');
}

// ── 2. Renderer не трогает ipcRenderer напрямую ─────────────────────────────
{
  const hits = [];
  for (const f of walk(path.join(ROOT, 'src'), ['.ts', '.tsx'])) {
    codeLines(fs.readFileSync(f, 'utf8')).forEach((line, i) => {
      if (/\bipcRenderer\b/.test(line)) hits.push(`${rel(f)}:${i + 1}`);
    });
  }
  checkEmpty('renderer ходит только через window.oblako', hits,
    'мост живёт в preload; прямой ipcRenderer в src/ обходит контракт и типы OblakoApi');
}

// ── 3. any и @ts-ignore — только с объяснением ──────────────────────────────
// Из CLAUDE.md: «Не глуши ошибки через any/@ts-ignore без причины и комментария, почему иначе
// нельзя». Проверяем наличие комментария на той же или предыдущей строке — не сам текст: судить
// о качестве объяснения машина не может, а вот заметить его отсутствие вполне.
{
  const hits = [];
  const files = [
    ...walk(path.join(ROOT, 'src'), ['.ts', '.tsx']),
    ...walk(path.join(ROOT, 'electron'), ['.ts']),
    ...walk(path.join(ROOT, 'shared'), ['.ts']),
  ];
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    const code = codeLines(fs.readFileSync(f, 'utf8'));
    lines.forEach((raw, i) => {
      const isAny = /(:\s*any\b|as\s+any\b|<any>)/.test(code[i] ?? '');
      const isIgnore = /@ts-(ignore|expect-error|nocheck)/.test(raw);
      if (!isAny && !isIgnore) return;
      const prev = (lines[i - 1] ?? '').trim();
      const explained = raw.includes('//') || prev.startsWith('//') || prev.startsWith('*') || prev.startsWith('/*');
      if (!explained) hits.push(`${rel(f)}:${i + 1}  ${raw.trim().slice(0, 70)}`);
    });
  }
  checkEmpty('any и @ts-ignore объяснены комментарием', hits,
    'напиши рядом, почему иначе нельзя — иначе через месяц это неотличимо от лени');
}

// ── 4. Модули shared/ под проверками не тянут значимых импортов ─────────────
//
// ⚠️ Правило неочевидное, но железное: проверки гоняются голым node
// (--experimental-strip-types), а он требует расширения в пути импорта — которого tsc с эмитом
// не примет. Типовые импорты стираются и потому безвредны, а вот `import { X } from './layout'`
// внутри такого модуля ломает прогон целиком. Ошибка вылезет не там, где её сделали, поэтому
// правило проверяется машиной, а не памятью.
{
  const underCheck = new Set();
  for (const c of walk(path.join(ROOT, 'scripts'), ['-check.mjs'])) {
    for (const m of fs.readFileSync(c, 'utf8').matchAll(/from\s+'\.\.\/shared\/([\w/]+)\.ts'/g)) underCheck.add(m[1]);
  }
  const hits = [];
  for (const name of underCheck) {
    const f = path.join(ROOT, 'shared', `${name}.ts`);
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((raw, i) => {
      if (/^import\s+(?!type\b)/.test(raw)) hits.push(`shared/${name}.ts:${i + 1}  ${raw.trim().slice(0, 70)}`);
    });
  }
  console.log(`         (модулей shared/ под проверками: ${underCheck.size})`);
  checkEmpty('модули shared/ под проверками — только типовые импорты', hits,
    'значимый импорт сломает прогон на голом node; вынеси константу в тот же модуль');
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
