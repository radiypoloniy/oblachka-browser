// Храповик ESLint — два готовых правила, которых нет у наших собственных сторожей.
//
// ⚠️ ЗАЧЕМ ХРАПОВИК, А НЕ ЗАПРЕТ. На момент включения (01.09.2026) в проекте 91 срабатывание в
// 62 файлах. Чинить их разом — это одна правка на весь `src/` и `electron/` без единой живой
// проверки под ней, то есть ровно тот заход, после которого «что-то перестало работать, и
// непонятно что». Поэтому текущее состояние зафиксировано в fixtures/lint-baseline.json:
//   • файл, которого в базе нет, обязан быть ЧИСТЫМ;
//   • файл из базы не имеет права дать БОЛЬШЕ замечаний, чем записано;
//   • стало меньше — фиксируем новый уровень (--update), и назад дороги нет.
// Тот же приём, что у structure-check, и по той же причине.
//
// ⚠️ Что именно проверяется и почему только это:
//   • react-hooks/rules-of-hooks — хук вызван условно. `tsc` этого не видит вовсе.
//   • react-hooks/exhaustive-deps — забытая зависимость: не падение, а ЗАМЫКАНИЕ НА УСТАРЕВШЕМ
//     значении. Работает через раз и «само чинится» на следующем рендере — худший вид бага.
//   • @typescript-eslint/no-floating-promises — забытый await.
// Стиль сюда не входит: его держат conventions-check и structure-check, и второй источник правды
// по стилю означал бы спор двух сторожей на каждой правке.
//
// ⚠️ Прогон стоит ~13 секунд (разбор типов обязателен для no-floating-promises) — это дороже всех
// остальных проверок вместе взятых. Терпимо: столько же стоит tsc, который pre-commit и так гоняет.
//
// Запуск: npm test -- lint   ·   обновить базу: node scripts/lint-check.mjs --update
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASELINE = 'scripts/fixtures/lint-baseline.json';
const ROOTS = ['shared', 'electron', 'src'];

function run() {
  let out = '';
  try {
    out = execFileSync('npx', ['eslint', '--format', 'json', ...ROOTS], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true,
    });
  } catch (e) {
    // ⚠️ Ненулевой код — ШТАТНЫЙ исход: ESLint так сообщает о найденных ошибках. Отчёт при этом
    // лежит в stdout, и разбирать надо именно его. Падать здесь значило бы падать всегда, пока в
    // базе есть хоть одна запись.
    out = e.stdout ?? '';
    if (!out) {
      console.log(' FAIL  eslint не запустился');
      console.log(String(e.stderr ?? e.message).slice(0, 600));
      process.exit(1);
    }
  }
  return JSON.parse(out);
}

const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/');

const current = {};
for (const f of run()) {
  if (f.messages.length === 0) continue;
  current[rel(f.filePath)] = f.messages.length;
}

if (process.argv.includes('--update')) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  const total = Object.values(current).reduce((s, n) => s + n, 0);
  console.log(`база обновлена: ${Object.keys(current).length} файлов, ${total} замечаний`);
  process.exit(0);
}

const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};

let passed = 0;
let failed = 0;
const check = (what, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

console.log('\n— новые файлы чисты —');
const dirty = Object.keys(current).filter((f) => !(f in base));
if (dirty.length === 0) check('да', true);
else for (const f of dirty) check(`${f}: ${current[f]} замечаний, а файла нет в базе`, false);

console.log('\n— файлы из базы не стали хуже —');
const worse = Object.keys(current).filter((f) => f in base && current[f] > base[f]);
if (worse.length === 0) check('да', true);
else for (const f of worse) check(`${f}: ${current[f]} замечаний (было ${base[f]})`, false);

const better = Object.keys(base).filter((f) => (current[f] ?? 0) < base[f]);
if (better.length > 0) {
  console.log('\n— стало лучше, база отстала (не ошибка) —');
  for (const f of better) console.log(`  ..   ${f}: ${base[f]} → ${current[f] ?? 0}`);
  console.log('       зафиксировать: node scripts/lint-check.mjs --update');
}

const total = Object.values(current).reduce((s, n) => s + n, 0);
console.log(`\nЗамечаний сейчас: ${total} в ${Object.keys(current).length} файлах`);
console.log(`Итого: ${passed} ок, ${failed} провалено\n`);
process.exit(failed === 0 ? 0 : 1);
