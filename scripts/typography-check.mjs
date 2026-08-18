// Сторож типографики: мелкий кегль берётся из шкалы, а не пишется числом.
//
// ⚠️ Граница правила проходит по 18 пикселям, и она содержательная. Всё, что МЕНЬШЕ, — это
// интерфейс: подписи, строки списков, кнопки. Там кегль обязан быть одним из четырёх ролей
// (см. TEXT в system.ts), иначе иерархия перестаёт читаться: разница в полтора пункта между
// заголовком блока и его описанием не создаёт уровня, а создаёт ощущение серой массы.
//
// Всё, что БОЛЬШЕ, — дисплейная роль: часы новой вкладки, приветствие, крупные числа виджетов,
// пустые состояния. Там размер подбирается под конкретное «лицо» продукта, и загонять его в
// шкалу интерфейса бессмысленно — это разные миры (см. DISPLAY в system.ts).
//
// Запуск: npm run typography-check (или npm test -- typo)
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

console.log('— интерфейсный кегль из шкалы —');
const raw = [];
for (const f of walk(path.join(ROOT, 'src'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/fontSize: ([\d.]+)\b/g)) {
    if (Number(m[1]) >= 18) continue; // дисплейная роль — своя территория
    raw.push(`${path.relative(ROOT, f)}: ${m[1]}`);
  }
}
check('литеральных интерфейсных кеглей нет', raw, []);

console.log('\n— роли различимы —');
// ⚠️ Проверяем не сами числа, а РАЗНИЦУ между соседними ролями: пока она меньше полутора
// пунктов, уровень не читается, сколько бы ролей ни объявили.
const system = fs.readFileSync(path.join(ROOT, 'src/styles/system.ts'), 'utf8');
const sizes = [...system.matchAll(/(title|section|body|caption): \{ fontSize: ([\d.]+)/g)]
  .map((m) => ({ name: m[1], v: Number(m[2]) }))
  .sort((a, b) => b.v - a.v);
const flat = sizes.filter((s, i) => i > 0 && sizes[i - 1].v - s.v < 1.5)
  .map((s) => `${sizes[sizes.indexOf(s) - 1].name}→${s.name}`);
check('соседние роли различаются кеглем', flat, []);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
