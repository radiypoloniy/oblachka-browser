// Убирает из dist-electron скомпилированные файлы, у которых больше нет исходника.
//
// Зачем. tsc только ДОБАВЛЯЕТ файлы и никогда не убирает: переименовал или удалил .ts —
// соответствующий .js остаётся в dist-electron навсегда. Обычно это просто мусор, но один случай
// ядовитый и уже случился при расколе контракта: `shared/ipc.ts` стал папкой `shared/ipc/`, и в
// сборке рядом с новым `shared/ipc/index.js` лежал старый `shared/ipc.js`. CommonJS резолвит ФАЙЛ
// раньше ПАПКИ — значит `require('../shared/ipc')` продолжал бы отдавать контракт полугодовой
// давности. Молча, без единой ошибки: приложение работает, правки контракта не доезжают, и искать
// это человек будет в своём коде.
//
// Осторожность намеренная: удаляем только то, что мы же и породили (.js/.js.map/.d.ts) и только
// когда рядом нет НИ ОДНОГО подходящего исходника. Всё, чего не понимаем, не трогаем.
//
// --dry: показать, что удалилось бы, и ничего не трогать.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-electron');
const DRY = process.argv.includes('--dry');

if (!fs.existsSync(OUT)) process.exit(0);

// dist-electron/<...> собран из <ROOT>/<...> — плоское соответствие, кроме package.json,
// который build:electron пишет сам.
const KEEP = new Set(['package.json']);

const removed = [];

function sourceExists(relNoExt) {
  return ['.ts', '.tsx', '.mts', '.cts', '.js', '.json']
    .some((ext) => fs.existsSync(path.join(ROOT, relNoExt + ext)));
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { walk(full); continue; }

    const rel = path.relative(OUT, full).replace(/\\/g, '/');
    if (KEEP.has(rel)) continue;

    const m = rel.match(/^(.*?)(\.d\.ts|\.js\.map|\.js)$/);
    if (!m) continue; // не наш артефакт — не трогаем

    if (!sourceExists(m[1])) {
      if (!DRY) fs.unlinkSync(full);
      removed.push(rel);
    }
  }
}

walk(OUT);

if (removed.length) {
  console.log(`prune: ${DRY ? 'удалилось бы' : 'убрано'} устаревших файлов сборки — ${removed.length}`);
  for (const r of removed) console.log(`  − ${r}`);
}
