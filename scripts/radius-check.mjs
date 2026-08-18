// Сторож радиусов: скругления берутся из шкалы, а не пишутся числом.
//
// ⚠️ Замер до правки: в компонентах стояло 77 литеральных радиусов и ЧЕТЫРНАДЦАТЬ разных
// значений — 0, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 14, 99, 999. Из них 99 и 999 — два способа
// написать пилюлю, а 2/3/4/5 — четыре значения на одну роль «внутри контрола».
//
// ⚠️ Почему это не мелочь: вложенные скругления глаз ловит с точностью до пикселя. Правило
// системы — ВНЕШНИЙ = ВНУТРЕННИЙ + ОТСТУП; при произвольных числах оно не выполняется нигде,
// и углы «разъезжаются» даже там, где каждое значение по отдельности выглядит разумным.
//
// Запуск: npm run radius-check (или npm test -- radius)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

console.log('— радиусы берутся из шкалы —');
const raw = [];
for (const f of walk(path.join(ROOT, 'src'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/borderRadius: (\d+)\b/g)) {
    // Ноль — это не радиус, а его отсутствие: осознанно квадратный угол.
    if (m[1] === '0') continue;
    raw.push(`${path.relative(ROOT, f)}: ${m[1]}`);
  }
}
check('литеральных радиусов в компонентах нет', raw, []);

console.log('\n— шкала связная —');
// ⚠️ Правило вложенности проверяем на самой шкале: между соседними ступенями обязан помещаться
// хотя бы один шаг отступа (4 px), иначе «внешний = внутренний + отступ» невыполнимо в принципе.
const system = fs.readFileSync(path.join(ROOT, 'src/styles/system.ts'), 'utf8');
const block = /export const RADIUS = \{([\s\S]*?)\} as const;/.exec(system);
if (!block) throw new Error('не нашёл RADIUS в system.ts');
const steps = [...block[1].matchAll(/(\w+): (\d+)/g)].map((m) => ({ name: m[1], v: Number(m[2]) }))
  .filter((s) => s.v < 900) // пилюля вне шкалы по построению
  .sort((a, b) => a.v - b.v);
const tooClose = steps.filter((s, i) => i > 0 && s.v - steps[i - 1].v < 4)
  .map((s) => `${steps[steps.indexOf(s) - 1].name}→${s.name}`);
check('ступени различимы (шаг не меньше 4)', tooClose, []);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
