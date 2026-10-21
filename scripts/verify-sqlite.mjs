// Сторож нативного better-sqlite3 — история, закладки, пароли, графы, автозаполнение и история
// AI-чата держатся на нём.
//
// С 13-й версии better-sqlite3 собран на N-API: готовые бинарники лежат прямо в пакете
// (prebuilds/<платформа>-<арх>.node) и не зависят от ABI Electron. Поэтому скрипт больше НИЧЕГО
// не качает и не собирает — раньше он скачивал сборку под ABI конкретной версии Electron, и
// именно это держало проект на Electron 42 (готовых сборок под v148+ не было, компилятора нет).
//
// ⚠️ Зачем он тогда остался в postinstall. Поломка нативного модуля не видна при установке:
// браузер стартует как обычно, только с молча отключёнными историей, паролями и закладками —
// со стороны это выглядит как потеря всех данных, хотя на диске они целы. Живой случай
// (11.08.2026): подъём Electron 40 → 43 прошёл «успешно», а бинарника не стало. Сторож
// загружает модуль ТЕМ ЖЕ Electron, что и приложение, и кричит, если не вышло.
//
// ⚠️ Никакого electron-rebuild -f здесь быть не должно: флаг сносит рабочий бинарник ДО
// попытки собрать новый, а на машине без Visual Studio сборка падает.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleDir = path.join(root, 'node_modules', 'better-sqlite3');

if (!existsSync(moduleDir)) {
  console.log('[sqlite] пакет better-sqlite3 не установлен — пропуск');
  process.exit(0);
}

const warn = (reason) => {
  // Намеренно не роняем установку — но и не делаем вид, что всё хорошо.
  console.error('');
  console.error('  ВНИМАНИЕ: better-sqlite3 не загружается под Electron.');
  console.error('  ' + reason);
  console.error('  История, закладки, пароли, графы и автозаполнение будут ОТКЛЮЧЕНЫ.');
  console.error('  Данные на диске при этом целы — недоступен только модуль чтения.');
  console.error('');
  process.exit(0);
};

const prebuild = path.join(moduleDir, 'prebuilds', `${process.platform}-${process.arch}.node`);
if (!existsSync(prebuild)) {
  warn(`Нет готовой сборки под ${process.platform}-${process.arch} (ждали ${path.relative(root, prebuild)}).`);
}

// Бинарник Electron скачивает его собственный install-скрипт; если он не отработал, проверять
// загрузку нечем — это не поломка sqlite, о ней скажет первый же запуск приложения.
const electron = path.join(root, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron');
if (!existsSync(electron)) {
  console.log('[sqlite] бинарник Electron ещё не скачан — проверка загрузки пропущена');
  process.exit(0);
}

// ⚠️ Именно открыть базу, а не просто require: нативную часть модуль тянет лениво, уже в
// конструкторе — на одном require поломка не всплывает.
const probe = "const D=require('better-sqlite3');const db=new D(':memory:');"
  + "process.stdout.write(db.prepare('select sqlite_version() v').get().v);db.close()";
const r = spawnSync(electron, ['-e', probe], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
});
if (r.status !== 0) {
  warn((r.stderr || r.error?.message || `код выхода ${r.status}`).trim().split('\n')[0]);
}
console.log(`[sqlite] better-sqlite3 загружается под Electron (SQLite ${r.stdout.trim()})`);
