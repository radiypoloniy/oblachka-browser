// Прогон ЖИВЫХ проверок одной командой: npm run drive
//
// Зачем. `npm test` держит чистую логику и статику — 10k строк `shared/` из 97k всего. Остальные
// 87k (`electron/` + `src/`) не проверяет ничто, кроме `tsc` и человеческого глаза, а именно там
// живут поломки, которые уже случались: осиротевший `shared/ipc.js`, по которому приложение молча
// работало по контракту полугодовой давности; `unlink`, стёрший боевые пароли; залипшие
// drag-жесты. Ни одна из них не про «границу проверили не тем числом».
//
// Живые проверки под это есть — шесть штук, `scripts/*-drive.mjs`. Но лежали они порознь и
// запускались по памяти, то есть ровно той болезнью, от которой лечит pre-commit: правило уровня
// текста не выполняется. Здесь они становятся одной командой с общим кодом возврата.
//
// ⚠️ ЭТО НЕ `npm test`. Каждая проверка поднимает НАСТОЯЩЕЕ приложение: прогон занимает минуту,
// открывает окна на экране и требует прод-сборки. В pre-commit такому не место — гонять перед
// правками в `electron/` и перед релизом.
//
// ⚠️ Боевой профиль не открывается. Все проверки идут через `withStand` (свой `--user-data-dir` во
// временной папке, проверка `assertSafeProfile`), кроме session-restore, которая делает то же
// самое своими руками. История, закладки, пароли и вкладки человека не видны прогону вовсе.
//
// ⚠️ Дерево процессов снимается `taskkill /T`, а не `child.kill()`. На Windows kill гасит только
// сам процесс, Electron его переживает и остаётся висеть без окна, держа single-instance lock на
// свой профиль. Поэтому здесь ДВА рубежа: таймаут снимает дерево драйвера, а в конце прогон ещё
// и подметает `electron.exe`, у которого в командной строке остался профиль стенда. Без этого
// человек возвращается к браузеру, который молча не запускается (это уже случалось).
//
// Запуск:
//   npm run drive                 — все живые проверки
//   npm run drive -- profile      — только те, чьё имя содержит «profile»
//   npm run drive -- --build      — сначала пересобрать (npm run build), потом гонять
//   npm run drive -- --timeout 300  — свой предел на одну проверку, секунды
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const opts = {};
const filter = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--build') opts.build = true;
  else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i] ?? '';
  else filter.push(a);
}
const TIMEOUT_MS = (Number(opts.timeout) || 180) * 1000;

const drivers = fs
  .readdirSync(HERE)
  .filter((f) => f.endsWith('-drive.mjs'))
  .filter((f) => filter.length === 0 || filter.some((q) => f.includes(q)))
  .sort();

if (drivers.length === 0) {
  console.error(filter.length ? `Ни одна живая проверка не подошла под «${filter.join(' ')}»` : 'Живых проверок не найдено');
  process.exit(1);
}

// ── сборка ──────────────────────────────────────────────────────────────────────────────────

const MAIN_JS = path.join(ROOT, 'dist-electron', 'electron', 'main.js');
const INDEX_HTML = path.join(ROOT, 'dist', 'index.html');

/** Самый свежий исходник в слое — чтобы понять, не отстала ли сборка. */
function newestSource(dirs) {
  let newest = 0;
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|css)$/.test(e.name)) newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  for (const d of dirs) walk(path.join(ROOT, d));
  return newest;
}

function build() {
  console.log('  сборка (npm run build)…');
  const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('\n  ✗ сборка не прошла — гонять живые проверки не на чем\n');
    process.exit(1);
  }
}

if (opts.build) {
  build();
} else if (!fs.existsSync(MAIN_JS) || !fs.existsSync(INDEX_HTML)) {
  console.error('\n  ✗ нет прод-сборки (dist + dist-electron).');
  console.error('    Собрать и погнать разом: npm run drive -- --build\n');
  process.exit(1);
} else {
  // ⚠️ Предупреждение, а не отказ. Проверка по времени файла врёт в обе стороны (git checkout
  // переставляет mtime, сборка одного таргета не трогает другой), и превращать её в запрет значит
  // ловить человека на ровном месте. А вот молчать нельзя: прогон по вчерашней сборке отвечает на
  // вопрос про вчерашний код, и это худший вид зелёного.
  const src = newestSource(['src', 'electron', 'shared']);
  const built = Math.min(fs.statSync(MAIN_JS).mtimeMs, fs.statSync(INDEX_HTML).mtimeMs);
  if (src > built) {
    const mins = Math.round((src - built) / 60000);
    console.log(`\n  ⚠️  Сборка старше исходников на ${mins} мин — проверки погонят ПРОШЛЫЙ код.`);
    console.log('      Пересобрать и погнать: npm run drive -- --build\n');
  }
}

// ── безопасность: подметание за собой ───────────────────────────────────────────────────────

const STAND_MARK = 'oblako-stand-';

/** Живые electron.exe, поднятые СТЕНДОМ (профиль во временной папке), — и только они. */
function standProcesses() {
  if (process.platform !== 'win32') return [];
  const ps = spawnSync('powershell', [
    '-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${STAND_MARK}*' } | ForEach-Object { $_.ProcessId }`,
  ], { encoding: 'utf8', windowsHide: true });
  if (ps.status !== 0 || !ps.stdout) return [];
  return ps.stdout.split('\n').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
}

function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* группы нет — уже мёртв */ }
  }
}

// ⚠️ Снимок ДО прогона: если у человека почему-то уже висел стендовый Electron, он не наш, и
// подметать его в конце — значит трогать чужое. Убираем только то, что появилось при нас.
const preexisting = new Set(standProcesses());

// ── прогон ──────────────────────────────────────────────────────────────────────────────────

console.log(`\n  Живые проверки: ${drivers.length}. Поднимается настоящее приложение, окна открываются на экране.\n`);

const PASS_LINE = /^\s*(ok|✓)\s/;
const FAIL_LINE = /^\s*(FAIL|✗|ПРОВАЛ)\s/;

function parseTotals(out) {
  const m = out.match(/Итого:\s*(\d+)\s*прошл\S*,\s*(\d+)\s*не\s*прошл/i);
  if (m) return { passed: Number(m[1]), failed: Number(m[2]) };
  let passed = 0;
  let failed = 0;
  for (const line of out.split('\n')) {
    if (PASS_LINE.test(line)) passed++;
    else if (FAIL_LINE.test(line)) failed++;
  }
  return passed + failed > 0 ? { passed, failed } : null;
}

function runDriver(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(HERE, file)], {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });

    // ⚠️ Убиваем ДЕРЕВО, а не процесс: под драйвером висит Electron, и он переживёт смерть
    // родителя, оставшись без окна и с захваченным замком своего профиля.
    const timer = setTimeout(() => {
      killTree(child.pid);
      resolve({ out, status: 'timeout', ms: Date.now() - started });
    }, TIMEOUT_MS);

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ out: `${out}\n${e.message}`, status: 'error', ms: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ out, status: code, ms: Date.now() - started });
    });
  });
}

const results = [];
const startedAll = Date.now();

for (const file of drivers) {
  const name = file.replace(/-drive\.mjs$/, '');
  // Строка прогресса живёт до конца проверки и затирается результатом. Без неё минутный прогон
  // выглядит зависшим; без затирания на экране остаётся хвост от «…».
  // ⚠️ Только в живом терминале. В трубе (`npm run drive > log`) возврат каретки ничего не
  // затирает, и вместо прогресса в лог падает по две строки на проверку.
  const tty = process.stdout.isTTY === true;
  const progress = `        ${name.padEnd(22)} идёт…`;
  if (tty) process.stdout.write(progress);

  const r = await runDriver(file);
  const ok = r.status === 0;
  const totals = parseTotals(r.out);
  results.push({ name, ok, ...r, totals });

  const detail = r.status === 'timeout' ? `не уложилась в ${TIMEOUT_MS / 1000} с`
    : totals ? `${totals.passed + totals.failed} проверок`
      : ok ? '' : 'упала до итога';
  if (tty) process.stdout.write(`\r${' '.repeat(progress.length)}\r`);
  process.stdout.write(`  ${ok ? ' ok  ' : 'FAIL '} ${name.padEnd(22)} ${String(Math.round(r.ms / 1000)).padStart(3)} с   ${detail}\n`);
}

// Разбор красных — после сводки, чтобы порядок прогона был виден целиком.
const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  console.log(`\n${'─'.repeat(70)}\n${r.name} — ${r.status === 'timeout' ? 'таймаут' : `код возврата ${r.status}`}\n${'─'.repeat(70)}`);
  console.log((r.out || '(пустой вывод)').trimEnd());
}

// ── подметание ──────────────────────────────────────────────────────────────────────────────

const strays = standProcesses().filter((pid) => !preexisting.has(pid));
if (strays.length) {
  console.log(`\n  ⚠️  Остались процессы стенда: ${strays.join(', ')} — снимаю деревом.`);
  for (const pid of strays) killTree(pid);
  const still = standProcesses().filter((pid) => !preexisting.has(pid));
  if (still.length) {
    console.log(`  ⚠️  НЕ снялись: ${still.join(', ')}. Снять вручную: taskkill /PID <pid> /T /F`);
    console.log('      Пока они живы, свой профиль стенда занят — на боевой браузер это не влияет.');
  }
}

// Старые профили стенда в temp только ПОКАЗЫВАЕМ. Удалять чужое молча нельзя: правило проекта —
// создавать своё и убирать ТОЛЬКО созданное (живой случай со стёртыми холстами).
try {
  const stale = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(STAND_MARK));
  if (stale.length > 2) {
    console.log(`\n  В ${os.tmpdir()} лежит ${stale.length} старых профилей стенда — можно удалить руками.`);
  }
} catch { /* временная папка недоступна — не повод падать */ }

// ── итог ────────────────────────────────────────────────────────────────────────────────────

const assertsPassed = results.reduce((s, r) => s + (r.totals?.passed ?? 0), 0);
const assertsFailed = results.reduce((s, r) => s + (r.totals?.failed ?? 0), 0);

console.log(`\n${'═'.repeat(70)}`);
console.log(
  `Живых проверок: ${results.length - failed.length} из ${results.length} прошло   ` +
  `Ассертов: ${assertsPassed} прошло, ${assertsFailed} не прошло   ` +
  `${Math.round((Date.now() - startedAll) / 1000)} с`,
);
console.log(`${'═'.repeat(70)}\n`);

process.exit(failed.length === 0 ? 0 : 1);
