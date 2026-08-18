// Сторож движения: в переходах допускаются только токены длительности и одна кривая.
//
// ⚠️ Правило появилось после замера: в компонентах вручную было написано ВОСЕМЬ длительностей
// (70, 140, 160, 180, 220, 240, 260, 520 мс) и ПЯТЬ записей кривых, включая две пружинящие и
// дубль одной и той же с разным форматированием. Поодиночке каждая «чуть точнее» соседней, а
// вместе разнобой ускорений читается как разнобой материалов — будто части окна из разного.
//
// ⚠️ Граница правила: transition — это СОСТОЯНИЕ (наведение, раскрытие, переключение), и оно
// обязано жить на общей шкале. animation — ХОРЕОГРАФИЯ (полёт файла в кнопку загрузок, спиннер,
// вход новой вкладки): у неё своя длительность по смыслу жеста, и загонять её в три ступени
// значит ломать сам жест. Поэтому проверяются только переходы.
//
// Запуск: npm run motion-check (или npm test -- motion)
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
    else if (/\.(tsx|ts|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(path.join(ROOT, 'src')).filter((f) => !f.includes(`tokens${path.sep}`));

console.log('— длительность переходов берётся из шкалы —');
const rawDur = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/transition[^;\n]*/g)) {
    for (const d of m[0].matchAll(/(\d+)ms/g)) {
      rawDur.push(`${path.relative(ROOT, f)}: ${d[0]}`);
    }
  }
}
check('литералов длительности в transition нет', rawDur, []);

console.log('\n— кривая одна —');
const curves = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/cubic-bezier\([^)]*\)/g)) curves.add(m[0].replace(/\s+/g, ''));
}
// ⚠️ Пружина (второй коэффициент больше 1) — не «другая кривая», а другой ХАРАКТЕР: перелёт за
// конечную точку каждый раз просит внимания. В браузере, открытом на восемь часов, это утомляет.
check('пружинящих кривых в компонентах нет', [...curves].filter((c) => /,1\.\d/.test(c)), []);
check('кривых в компонентах не больше одной', [...curves].length <= 1, true);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
