// Снимок боевого userData в отдельную папку. Исходник только читаем.
//
// Зачем. Индекс файлов и живые прогоны поиска нельзя гонять на рабочем профиле: туда пишется
// sqlite. Пустой стенд не отвечает на вопрос «находится ли мой договор». Копия даёт настоящие
// историю и загрузки, а --user-data-dir держит замок и записи отдельно.
//
//   node scripts/clone-user-profile.mjs
//   node scripts/clone-user-profile.mjs --dest D:\tmp\oblako-shadow
//
// Запуск копии, не рабочего профиля:
//   npx electron . --user-data-dir=%TEMP%\oblako-shadow-profile
//
// ⚠️ Папка обязана быть ВНЕ боевого userData. Скрипт это проверяет и иначе выходит.
// ⚠️ Кэши Chromium и GGUF не копируются: для поиска не нужны, а модели — гигабайты.
// ⚠️ downloads.json хранит пути к НАСТОЯЩИМ файлам. Чтение для индекса безопасно;
//    «назвать по содержимому» / удаление файла с диска в копии ударит по тем же файлам.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { realUserDataDir } from './isolated-stand.mjs';

const SKIP_DIRS = new Set([
  'cache',
  'code cache',
  'gpucache',
  'dawncache',
  'dawngraphitecache',
  'dawnwebgpucache',
  'grshadercache',
  'shadercache',
  'service worker',
  'blob_storage',
  'crashpad',
  'videodecodestats',
  'models',
]);

function parseDest(argv) {
  const i = argv.indexOf('--dest');
  if (i >= 0) return argv[i + 1];
  return path.join(os.tmpdir(), 'oblako-shadow-profile');
}

function assertSafeDest(source, dest) {
  const src = path.resolve(source);
  const out = path.resolve(dest);
  if (out === src) throw new Error(`копия совпала с боевым профилем: ${out}`);
  if (out.startsWith(src + path.sep)) throw new Error(`копия внутри боевого профиля: ${out}`);
  if (src.startsWith(out + path.sep)) throw new Error(`боевой профиль оказался бы внутри копии: ${out}`);
}

function copyTree(srcRoot, destRoot, rel, stats) {
  const from = rel ? path.join(srcRoot, rel) : srcRoot;
  const to = rel ? path.join(destRoot, rel) : destRoot;
  let st;
  try { st = fs.lstatSync(from); } catch (error) {
    stats.failed.push(`${rel || '.'}: ${error.message}`);
    return;
  }
  if (st.isDirectory()) {
    if (rel && SKIP_DIRS.has(path.basename(from).toLowerCase())) {
      stats.skipped.push(rel);
      return;
    }
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      copyTree(srcRoot, destRoot, rel ? path.join(rel, name) : name, stats);
    }
    return;
  }
  if (st.isSymbolicLink()) {
    stats.skipped.push(`${rel} (ссылка)`);
    return;
  }
  try {
    fs.copyFileSync(from, to);
    stats.files += 1;
    stats.bytes += st.size;
  } catch (error) {
    stats.failed.push(`${rel}: ${error.message}`);
  }
}

const source = realUserDataDir();
const dest = parseDest(process.argv.slice(2));
if (!fs.existsSync(source)) {
  console.error(`боевого профиля нет: ${source}`);
  process.exit(1);
}
assertSafeDest(source, dest);

if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

const stats = { files: 0, bytes: 0, skipped: [], failed: [] };
copyTree(source, dest, '', stats);

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} МБ`;
console.log(`Скопировано ${stats.files} файлов (${mb(stats.bytes)})`);
console.log(`источник: ${path.resolve(source)}`);
console.log(`копия:    ${path.resolve(dest)}`);
if (stats.skipped.length) {
  console.log(`пропущено: ${stats.skipped.join(', ')}`);
}
if (stats.failed.length) {
  console.log(`не скопировалось (${stats.failed.length}):`);
  for (const line of stats.failed.slice(0, 12)) console.log(`  ${line}`);
  if (stats.failed.length > 12) console.log(`  … ещё ${stats.failed.length - 12}`);
}
console.log('\nЗапуск копии:');
console.log(`  npx electron . --user-data-dir=${path.resolve(dest)}`);
console.log('Рабочий профиль этот запуск не откроет: другой user-data-dir, другой замок.');
process.exit(stats.files === 0 ? 1 : 0);
