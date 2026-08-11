// Нативный бинарник better-sqlite3 под ABI Electron — история, закладки, пароли, графы,
// автозаполнение и история AI-чата держатся на нём.
//
// ⚠️ Почему это отдельный скрипт, а не одна строка с electron-rebuild (как было).
// Раньше в postinstall стояло `electron-rebuild -f -w better-sqlite3 || echo ...`, и это
// сочетание дважды опасно:
//   1. -f (форсировать) СНАЧАЛА сносит существующую сборку и только потом пытается собрать
//      новую. На машине без Visual Studio сборка падает — и рабочий бинарник уже уничтожен.
//   2. `|| echo` глушит падение: npm install отчитывается успехом (exit 0), а браузер после
//      этого стартует с молча отключённой историей, паролями и закладками. Выглядит как
//      потеря всех данных, хотя на диске они целы.
// Живой случай (11.08.2026): подъём Electron 40 → 43 прошёл «успешно», а бинарника не стало.
//
// Порядок здесь обратный и безопасный: сперва пробуем СКАЧАТЬ готовую сборку под нужный ABI
// (компилятор не нужен — так этот модуль и ставился всё время), и только если её нет —
// пробуем собрать локально. Существующий бинарник до последнего не трогаем.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleDir = path.join(root, 'node_modules', 'better-sqlite3');
const binary = path.join(moduleDir, 'build', 'Release', 'better_sqlite3.node');

if (!existsSync(moduleDir)) {
  console.log('[sqlite] пакет better-sqlite3 не установлен — пропуск');
  process.exit(0);
}

// Версия Electron — единственный источник правды о нужном ABI. Берём из package.json, а не
// из установленного пакета: postinstall может отработать до его распаковки.
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const target = (pkg.devDependencies?.electron ?? '').replace(/^[^0-9]*/, '');
if (!target) {
  console.error('[sqlite] не удалось прочитать версию electron из package.json — пропуск');
  process.exit(0);
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'pipe', shell: true });

// Шаг 1: готовая сборка под ABI этой версии Electron.
try {
  run('npx', ['prebuild-install', '-r', 'electron', '-t', target], moduleDir);
  if (existsSync(binary)) {
    console.log(`[sqlite] готовая сборка под electron ${target} получена`);
    process.exit(0);
  }
} catch {
  console.log(`[sqlite] готовой сборки под electron ${target} нет — пробую собрать локально`);
}

// Шаг 2: локальная компиляция. Нужен C++-тулчейн (Visual Studio Build Tools на Windows).
try {
  run('npx', ['electron-rebuild', '-f', '-w', 'better-sqlite3'], root);
  console.log(`[sqlite] собрано локально под electron ${target}`);
  process.exit(0);
} catch {
  // Намеренно не роняем установку — но и не делаем вид, что всё хорошо.
  console.error('');
  console.error('  ВНИМАНИЕ: better-sqlite3 не собран под electron ' + target + '.');
  console.error('  История, закладки, пароли, графы и автозаполнение будут ОТКЛЮЧЕНЫ.');
  console.error('  Данные на диске при этом целы — недоступен только модуль чтения.');
  console.error('');
  console.error('  Причины бывают две:');
  console.error('   • для этой версии Electron нет готовой сборки (проверьте релизы');
  console.error('     WiseLibs/better-sqlite3 — ABI берётся из node-abi);');
  console.error('   • нет C++-тулчейна для локальной компиляции (Visual Studio Build Tools).');
  console.error('');
  console.error('  Самое простое решение — вернуть версию Electron, под которую сборка есть.');
  console.error('');
  process.exit(0);
}
