// Мутационный прогон по shared/: кто проверяет сами проверки.
//
// Зачем. У нас 47 проверок и полторы тысячи ассертов, но ни одна цифра не отвечает на вопрос
// «а они вообще что-нибудь держат?». Ассерт, который проверяет ровно то значение, ради которого
// написан, зелёный всегда — и когда логика цела, и когда её тихо сломали рядом. Мутационный
// прогон отвечает измерением: портим логику по одному месту за раз (`<` на `<=`, число на
// соседнее, `&&` на `||`) и смотрим, упадёт ли хоть одна проверка. Упала — мутант убит, место
// под охраной. Не упала — мутант ВЫЖИЛ, и там дыра: код можно менять как угодно, прогон зелёный.
//
// ⚠️ Выживший мутант — это НЕ автоматически баг в проверке. Часть мутаций эквивалентна исходному
// коду (зажим `Math.min(x, 100)` при заведомо меньшем x, граница, до которой не доходит ни один
// вход). Отчёт — список мест для ГЛАЗ, а не список задач. Смысл в другом: пока прогон не сделан,
// мы вообще не знаем, где охрана есть, а где её нет.
//
// ⚠️ Рабочее дерево НЕ ТРОГАЕТСЯ. Мутации пишутся в копию shared/ во временной папке, проверки
// гоняются оттуда же. Гонять безопасно при запущенном браузере и при открытом npm run dev —
// приложение не поднимается, боевой профиль не открывается, это статическая логика на голом node.
//
// Мишень — только shared/: там чистая логика без значимых импортов, и только её и покрывают
// scripts/*-check.mjs. Для electron/ и src/ мутационный прогон бессмысленен, пока нет тестов,
// которые могли бы убить мутанта.
//
// Запуск:
//   npm run mutate                      — все модули shared/, у которых есть проверка
//   npm run mutate -- layout            — только модули, чьё имя содержит «layout»
//   npm run mutate -- --limit 40        — не больше 40 мутантов на модуль (быстрый проход)
//   npm run mutate -- --op relational   — только один класс мутаций (см. OPS)
//   npm run mutate -- --op +string      — добавить мутацию строковых литералов (по умолчанию off)
//   npm run mutate -- --jobs 4          — сколько проверок гонять параллельно
//   npm run mutate -- --diff            — только модули, изменённые относительно HEAD
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHARED = path.join(ROOT, 'shared');

// Те же флаги, что у npm test: проверки импортируют shared/*.ts напрямую, без сборки.
const NODE_FLAGS = ['--experimental-strip-types', '--no-warnings'];

// ⚠️ Мутант может зациклить логику (снятый инкремент в while), и тогда проверка не вернётся
// никогда. Таймаут обязателен, иначе прогон встаёт намертво на одном мутанте.
const TIMEOUT_MS = 30_000;

// ── разбор аргументов ───────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opts = {};
const nameFilter = [];
// Разбираем одним проходом: «--limit 40 layout» иначе легко превращается в фильтр по имени «40».
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--diff') opts.diff = true;
  else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i] ?? '';
  else nameFilter.push(a);
}
const LIMIT = Number(opts.limit) || 0;
const JOBS = Math.max(1, Number(opts.jobs) || Math.max(1, os.cpus().length - 1));
const ONLY_DIFF = Boolean(opts.diff);

// ── что мутируем ────────────────────────────────────────────────────────────────────────────

// Классы мутаций. Разделены не для красоты: по классу видно ХАРАКТЕР дыры. Выжившие relational —
// непроверенные границы, выжившие literal — константа, которую можно поставить любой, выжившие
// logical — условие, вторая половина которого ни на что не влияет.
const OPS = ['relational', 'equality', 'logical', 'arith', 'literal', 'unary', 'string'];

// ⚠️ Строковые литералы по умолчанию выключены: в модулях-таблицах (countries, timeZones) их
// сотни, они дают тысячи мутантов и топят настоящий сигнал. Включается явно: --op +string.
const DEFAULT_OPS = OPS.filter((o) => o !== 'string');

const opArg = opts.op ?? '';
const enabledOps = new Set(
  !opArg ? DEFAULT_OPS
    : opArg.startsWith('+') ? [...DEFAULT_OPS, ...opArg.slice(1).split(',')]
      : opArg.split(','),
);

const BINARY = {
  [ts.SyntaxKind.LessThanToken]: ['<=', 'relational'],
  [ts.SyntaxKind.LessThanEqualsToken]: ['<', 'relational'],
  [ts.SyntaxKind.GreaterThanToken]: ['>=', 'relational'],
  [ts.SyntaxKind.GreaterThanEqualsToken]: ['>', 'relational'],
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: ['!==', 'equality'],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: ['===', 'equality'],
  [ts.SyntaxKind.EqualsEqualsToken]: ['!=', 'equality'],
  [ts.SyntaxKind.ExclamationEqualsToken]: ['==', 'equality'],
  [ts.SyntaxKind.AmpersandAmpersandToken]: ['||', 'logical'],
  [ts.SyntaxKind.BarBarToken]: ['&&', 'logical'],
  [ts.SyntaxKind.QuestionQuestionToken]: ['||', 'logical'],
  [ts.SyntaxKind.PlusToken]: ['-', 'arith'],
  [ts.SyntaxKind.MinusToken]: ['+', 'arith'],
  [ts.SyntaxKind.AsteriskToken]: ['/', 'arith'],
  [ts.SyntaxKind.SlashToken]: ['*', 'arith'],
  [ts.SyntaxKind.PercentToken]: ['*', 'arith'],
  [ts.SyntaxKind.PlusEqualsToken]: ['-=', 'arith'],
  [ts.SyntaxKind.MinusEqualsToken]: ['+=', 'arith'],
};

// ⚠️ Внутри типов не мутируем: `Record<string, 0 | 1>` при стриппинге типов вообще не доедет до
// рантайма, такой мутант выживет всегда и будет чистым шумом в отчёте. Импорты — по той же
// причине: подмена пути это не порча логики, а поломка сборки.
function insideTypeOrImport(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return true;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isEnumDeclaration(p)) return true;
  }
  return false;
}

function mutantsFor(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];

  const add = (op, start, end, text, was) => {
    if (!enabledOps.has(op)) return;
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    out.push({ op, start, end, text, was, line: line + 1, col: character + 1 });
  };

  const visit = (node) => {
    if (!insideTypeOrImport(node)) {
      if (ts.isBinaryExpression(node)) {
        const swap = BINARY[node.operatorToken.kind];
        if (swap) add(swap[1], node.operatorToken.getStart(sf), node.operatorToken.getEnd(), swap[0], node.operatorToken.getText(sf));
      } else if (ts.isNumericLiteral(node)) {
        const n = Number(node.text);
        // 0↔1 отдельным случаем: «+1» к нулю даёт ту же единицу, а вот единица в ноль — часто
        // ровно тот мутант, который ловит невыставленный минимум.
        const next = n === 0 ? '1' : n === 1 ? '0' : String(n + 1);
        add('literal', node.getStart(sf), node.getEnd(), next, node.getText(sf));
      } else if (node.kind === ts.SyntaxKind.TrueKeyword) {
        add('literal', node.getStart(sf), node.getEnd(), 'false', 'true');
      } else if (node.kind === ts.SyntaxKind.FalseKeyword) {
        add('literal', node.getStart(sf), node.getEnd(), 'true', 'false');
      } else if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
        add('unary', node.getStart(sf), node.getEnd(), node.operand.getText(sf), node.getText(sf));
      } else if (ts.isStringLiteral(node)) {
        const cur = node.text;
        add('string', node.getStart(sf), node.getEnd(), cur === '' ? "'мутант'" : "''", node.getText(sf));
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

// ── карта «модуль → проверки, которые его тянут» ────────────────────────────────────────────

const sharedFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) sharedFiles.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
})(SHARED);

// Кто кого тянет ВНУТРИ shared: проверка, импортирующая sessionTree, охраняет и session тоже.
// Без этого шага модуль-помощник выглядел бы непокрытым, хотя мутанты в нём прекрасно ловятся.
const importsOf = new Map();
for (const f of sharedFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const deps = new Set();
  // ⚠️ `import type` НЕ считается связью. Тип стирается при сборке, код модуля при прогоне
  // проверки не исполняется ни разу — а привязка по нему рисовала бы покрытие там, где его нет.
  // Живой случай: shared/graph.ts числился охраняемым через цепочку типовых импортов из ipc/,
  // и в отчёте выходил ряд «33 мутанта, убито 0» — то есть проверка, которой на деле нет.
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s+([^;]*?)\bfrom\s+'(\.[^']+)'/g)) {
    if (/^type\b/.test(m[1].trim())) continue;
    const raw = m[2].replace(/\.ts$/, '');
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(f), raw));
    for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (sharedFiles.includes(cand)) deps.add(cand);
  }
  importsOf.set(f, deps);
}

const checkFiles = fs.readdirSync(HERE).filter((f) => f.endsWith('-check.mjs')).sort();
const guardedBy = new Map(sharedFiles.map((f) => [f, new Set()]));

for (const check of checkFiles) {
  const src = fs.readFileSync(path.join(HERE, check), 'utf8');
  const direct = sharedFiles.filter((f) => src.includes(`'../${f}'`) || src.includes(`'../${f.replace(/\.ts$/, '')}'`));
  // Замыкание по импортам: обходим вглубь, чтобы помощники помощников тоже засчитались.
  const seen = new Set();
  const queue = [...direct];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    guardedBy.get(f).add(check);
    for (const d of importsOf.get(f) ?? []) queue.push(d);
  }
}

let changed = null;
if (ONLY_DIFF) {
  try {
    changed = new Set(execSync('git diff --name-only HEAD -- shared', { cwd: ROOT, encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean));
  } catch { changed = new Set(); }
}

const targets = sharedFiles.filter((f) => {
  if (guardedBy.get(f).size === 0) return false;
  if (nameFilter.length && !nameFilter.some((q) => f.toLowerCase().includes(q.toLowerCase()))) return false;
  if (changed && !changed.has(f)) return false;
  return true;
});

const unguarded = sharedFiles.filter((f) => guardedBy.get(f).size === 0);

if (targets.length === 0) {
  console.error(nameFilter.length ? `Ни один модуль shared/ не подошёл под «${nameFilter.join(' ')}»` : 'Мутировать нечего');
  process.exit(1);
}

// ── песочницы ───────────────────────────────────────────────────────────────────────────────

// По песочнице на параллельный слот: мутант — это ЗАПИСЬ в shared/*.ts, и два слота в одной
// папке затирали бы мутации друг друга, давая случайные результаты.
const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oblako-mutation-'));
const sandboxes = [];

function makeSandbox(i) {
  const dir = path.join(sandboxRoot, `slot-${i}`);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.cpSync(SHARED, path.join(dir, 'shared'), { recursive: true });
  // Копируем только сами проверки и их фикстуры: в scripts/ лежит ещё 8 МБ снимков экрана,
  // которые к мутационному прогону отношения не имеют.
  for (const f of fs.readdirSync(HERE)) {
    if (f.endsWith('.mjs')) fs.copyFileSync(path.join(HERE, f), path.join(dir, 'scripts', f));
  }
  const fixtures = path.join(HERE, 'fixtures');
  if (fs.existsSync(fixtures)) fs.cpSync(fixtures, path.join(dir, 'scripts', 'fixtures'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  // ⚠️ src/ и electron/ нужны не мутанту, а проверкам: contrast-check и overlay-shadow-check
  // читают токены из src/styles и менеджеры из electron/, и без них падают ещё на холостом
  // прогоне. Тогда охраняемые ими модули (overlayMetrics, chromeGround) молча выпадали из счёта —
  // то есть отчёт становился короче именно там, где надо было мерить.
  for (const d of ['src', 'electron']) {
    if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  }
  // Junction, а не копия: node_modules весит сотни мегабайт, а проверкам нужен только typescript.
  // На Windows junction создаётся без прав администратора, в отличие от символьной ссылки.
  try {
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  } catch {
    // Если не вышло — не смертельно: проверки, которым нужен typescript, отсеются на холостом
    // прогоне ниже, остальные отработают.
  }
  return dir;
}

function cleanup() {
  try { fs.rmSync(sandboxRoot, { recursive: true, force: true }); } catch { /* временная папка, переживём */ }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// ── прогон одной проверки в песочнице ───────────────────────────────────────────────────────

function runCheck(sandbox, check) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...NODE_FLAGS, path.join(sandbox, 'scripts', check)], {
      cwd: sandbox,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => { child.kill(); resolve({ code: 'timeout' }); }, TIMEOUT_MS);
    child.on('error', () => { clearTimeout(timer); resolve({ code: 'error' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code }); });
  });
}

// ── холостой прогон: какие проверки вообще живут в песочнице ────────────────────────────────

console.log(`\n  Мутационный прогон по shared/ — ${targets.length} модулей, ${JOBS} потоков`);
console.log(`  Классы мутаций: ${[...enabledOps].join(', ')}\n`);

for (let i = 0; i < JOBS; i++) sandboxes.push(makeSandbox(i));

const neededChecks = new Set(targets.flatMap((f) => [...guardedBy.get(f)]));
const aliveChecks = new Set();
const deadChecks = [];

process.stdout.write('  холостой прогон… ');
for (const check of neededChecks) {
  const r = await runCheck(sandboxes[0], check);
  if (r.code === 0) aliveChecks.add(check);
  else deadChecks.push(check);
}
console.log(`${aliveChecks.size} проверок годны${deadChecks.length ? `, ${deadChecks.length} не заводятся в песочнице` : ''}\n`);

// ⚠️ Проверка, красная ещё до мутации, «убивала» бы любого мутанта и рисовала бы 100% там, где
// не проверено ничего. Такие исключаем целиком, а не молча — иначе отчёт врёт в лучшую сторону.
for (const f of targets) for (const c of [...guardedBy.get(f)]) if (!aliveChecks.has(c)) guardedBy.get(f).delete(c);
const runnable = targets.filter((f) => guardedBy.get(f).size > 0);
// Модуль, у которого все охраняющие проверки не завелись, не должен исчезать из отчёта молча:
// «его тут нет» человек читает как «всё хорошо», а на деле это непромеренное место.
const lostGuard = targets.filter((f) => guardedBy.get(f).size === 0);

// ── очередь мутантов ────────────────────────────────────────────────────────────────────────

const jobs = [];
const perModule = new Map();

for (const f of runnable) {
  const source = fs.readFileSync(path.join(ROOT, f), 'utf8');
  let list = mutantsFor(f, source);
  if (LIMIT && list.length > LIMIT) {
    // Прореживаем равномерно, а не первые N: первые N — это верх файла, обычно константы.
    const step = list.length / LIMIT;
    list = Array.from({ length: LIMIT }, (_, i) => list[Math.floor(i * step)]);
  }
  perModule.set(f, { source, total: list.length, killed: 0, survived: [], checks: [...guardedBy.get(f)] });
  for (const m of list) jobs.push({ file: f, mutant: m });
}

if (jobs.length === 0) {
  console.error('Мутантов не получилось — проверьте фильтр --op');
  process.exit(1);
}

const startedAll = Date.now();
let done = 0;
let cursor = 0;

async function worker(slot) {
  const sandbox = sandboxes[slot];
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    const state = perModule.get(job.file);
    const target = path.join(sandbox, job.file);
    const patched = state.source.slice(0, job.mutant.start) + job.mutant.text + state.source.slice(job.mutant.end);
    fs.writeFileSync(target, patched);

    // Убит, если упала ХОТЬ ОДНА охраняющая проверка — дальше не гоняем, экономим прогоны.
    let killed = false;
    for (const check of state.checks) {
      const r = await runCheck(sandbox, check);
      if (r.code !== 0) { killed = true; break; }
    }

    fs.writeFileSync(target, state.source);
    if (killed) state.killed++; else state.survived.push(job.mutant);

    done++;
    if (done % 10 === 0 || done === jobs.length) {
      const pct = Math.round((done / jobs.length) * 100);
      process.stdout.write(`\r  мутантов: ${done}/${jobs.length}  (${pct}%)   `);
    }
  }
}

await Promise.all(Array.from({ length: JOBS }, (_, i) => worker(i)));
process.stdout.write('\r' + ' '.repeat(50) + '\r');

// ── отчёт ───────────────────────────────────────────────────────────────────────────────────

const line = (ch) => ch.repeat(78);
console.log(line('═'));
console.log('  МОДУЛЬ                        МУТАНТОВ   УБИТО   ВЫЖИЛО   СЧЁТ');
console.log(line('─'));

const sorted = [...perModule.entries()].sort((a, b) => {
  const sa = a[1].total ? a[1].killed / a[1].total : 1;
  const sb = b[1].total ? b[1].killed / b[1].total : 1;
  return sa - sb;
});

let totalMutants = 0;
let totalKilled = 0;

// ⚠️ Модуль без мутантов — это НЕ «покрыт на 100%», а «мутировать нечем»: там либо одни типы
// (session.ts, ipc/*), либо голая сборка строк (scriptletBundle.ts), до которой добирается только
// --op +string. Рисовать таким 100% значит врать в сводке, поэтому они идут отдельной строкой.
const noMutants = sorted.filter(([, s]) => s.total === 0).map(([f]) => f);

for (const [file, s] of sorted) {
  if (s.total === 0) continue;
  totalMutants += s.total;
  totalKilled += s.killed;
  const score = Math.round((s.killed / s.total) * 100);
  const mark = score >= 90 ? ' ' : score >= 60 ? '·' : '!';
  console.log(
    `${mark} ${file.replace('shared/', '').padEnd(30)}` +
    `${String(s.total).padStart(6)}  ${String(s.killed).padStart(6)}  ` +
    `${String(s.survived.length).padStart(7)}   ${String(score).padStart(3)}%`,
  );
}

console.log(line('─'));
const score = totalMutants ? Math.round((totalKilled / totalMutants) * 100) : 0;
console.log(`  ИТОГО${' '.repeat(27)}${String(totalMutants).padStart(6)}  ${String(totalKilled).padStart(6)}  ` +
  `${String(totalMutants - totalKilled).padStart(7)}   ${String(score).padStart(3)}%`);
console.log(line('═'));

// Выжившие — построчно, с исходной строкой: без неё по «layout.ts:88 < → <=» никто разбираться
// не пойдёт, а именно ради разбора всё и затевалось.
const withSurvivors = sorted.filter(([, s]) => s.survived.length > 0);
if (withSurvivors.length) {
  console.log('\n  ВЫЖИВШИЕ МУТАНТЫ — места, которые прогон не удерживает');
  console.log('  (часть из них эквивалентна исходному коду; это список для глаз, а не задачи)\n');
  for (const [file, s] of withSurvivors) {
    console.log(`  ${file}  (${s.survived.length})`);
    const lines = s.source.split('\n');
    for (const m of s.survived) {
      const src = (lines[m.line - 1] ?? '').trim();
      console.log(`    ${String(m.line).padStart(4)}:${String(m.col).padEnd(3)} [${m.op}] ${m.was} → ${m.text}`);
      console.log(`         ${src.length > 96 ? `${src.slice(0, 96)}…` : src}`);
    }
    console.log('');
  }
}

if (lostGuard.length) {
  console.log(`
  Не промерены — все охраняющие проверки не завелись: ` +
    `${lostGuard.map((f) => f.replace('shared/', '')).join(', ')}
`);
}

if (noMutants.length) {
  console.log(`\n  Мутировать нечем (типы или сборка строк, не путать с «покрыто»): ` +
    `${noMutants.map((f) => f.replace('shared/', '')).join(', ')}\n`);
}

if (deadChecks.length) {
  console.log(`  Не заводятся в песочнице (исключены из счёта): ${deadChecks.map((c) => c.replace('-check.mjs', '')).join(', ')}`);
  console.log('  Обычно это проверки, читающие src/ или dist-electron — их песочница не содержит.\n');
}

if (unguarded.length && !nameFilter.length) {
  console.log(`  Без единой проверки (охраны нет вовсе): ${unguarded.map((f) => f.replace('shared/', '')).join(', ')}\n`);
}

console.log(`  ${Math.round((Date.now() - startedAll) / 1000)} с\n`);
