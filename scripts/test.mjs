// Прогон всех проверок проекта одной командой: npm test
//
// Зачем: проверок в scripts/ накопилось десять, и запускались они десятью отдельными командами.
// На практике это значит, что целиком их не гонял никто, и сломаться они могли задолго до того,
// как это заметят. Один прогон с общим кодом возврата закрывает ровно эту дыру.
//
// Список НЕ захардкожен: берётся из scripts/*-check.mjs. Новая проверка попадает сюда сама, без
// правки этого файла и без строчки в package.json — иначе её опять забудут добавить.
//
// Запуск:
//   npm test              — все проверки
//   npm test -- word      — только те, чьё имя содержит «word»
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// Проверки импортируют напрямую из shared/*.ts и electron/*.ts — без сборки, голым node.
// Флаг нужен ровно для этого (та же строка, что стояла в package.json у каждой проверки).
const NODE_FLAGS = ['--experimental-strip-types', '--no-warnings'];

// ⚠️ Часть проверок читает СОБРАННЫЙ main из dist-electron (bookmarks-schema-check тянет оттуда
// bookmarksSchema.js). Без сборки они падают с невнятным «Cannot find module», и человек идёт
// искать баг в схеме вместо того, чтобы просто собрать. Поэтому предупреждаем заранее.
const NEEDS_BUILD = fs.existsSync(path.join(ROOT, 'dist-electron'));

const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const checks = fs
  .readdirSync(HERE)
  .filter((f) => f.endsWith('-check.mjs'))
  .filter((f) => filter.length === 0 || filter.some((q) => f.includes(q)))
  .sort();

if (checks.length === 0) {
  console.error(filter.length ? `Ни одна проверка не подошла под «${filter.join(' ')}»` : 'Проверок не найдено');
  process.exit(1);
}

if (!NEEDS_BUILD) {
  console.log('\n  ⚠️  dist-electron отсутствует — проверки, читающие собранный main, упадут.');
  console.log('      Собрать: npm run build\n');
}

// Считаем ассерты, а не только файлы: десять зелёных файлов с одним ассертом внутри — не то же
// самое, что десять с сорока, и по числу файлов эта разница не видна.
//
// ⚠️ Итог печатается в ТРЁХ разных форматах — проверки писались в разное время и никто их не
// сводил: «Итого: N прошло, M не прошло» (восемь штук), «ВСЁ ПРОШЛО / ПРОВАЛОВ: N» (rules) и
// «все проверки пройдены / N проверок провалено» (bookmarks-schema). Приводить их к одному виду
// значило бы трогать десять работающих файлов ради косметики, поэтому разбор терпимый: сначала
// пробуем явную строку итога, а если её нет — пересчитываем построчные отметки. Проверка в любом
// из трёх стилей (и в четвёртом, если появится) посчитается сама.
const PASS_LINE = /^\s*(ok|✓)\s/;
// ⚠️ \s после ПРОВАЛ обязателен: иначе сводная строка «ПРОВАЛОВ: 3» сама сойдёт за провалившийся
// ассерт и число разойдётся с настоящим.
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

const results = [];
const startedAll = Date.now();

for (const file of checks) {
  const name = file.replace(/-check\.mjs$/, '');
  const started = Date.now();

  // Вывод буферизуем, а не льём на экран: у зелёной проверки он не нужен, а у красной нужен
  // целиком. Иначе сводка тонет в двухстах строках «ok».
  const r = spawnSync(process.execPath, [...NODE_FLAGS, path.join(HERE, file)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  const ms = Date.now() - started;
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const ok = r.status === 0;
  const totals = parseTotals(out);

  results.push({ name, ok, ms, out, totals, status: r.status });

  const mark = ok ? '  ok  ' : ' FAIL ';
  const detail = totals
    ? `${totals.passed + totals.failed} проверок`
    : ok ? '' : 'упала до итога';
  console.log(`${mark} ${name.padEnd(22)} ${String(ms).padStart(5)} мс   ${detail}`);
}

// Разбор красных — после сводки по всем, чтобы порядок запуска был виден целиком, а не терялся
// между простынями вывода.
const failed = results.filter((r) => !r.ok);

for (const r of failed) {
  console.log(`\n${'─'.repeat(70)}\n${r.name} — код возврата ${r.status}\n${'─'.repeat(70)}`);
  console.log(r.out.trimEnd() || '(пустой вывод)');
}

const assertsPassed = results.reduce((s, r) => s + (r.totals?.passed ?? 0), 0);
const assertsFailed = results.reduce((s, r) => s + (r.totals?.failed ?? 0), 0);
const totalMs = Date.now() - startedAll;

console.log(`\n${'═'.repeat(70)}`);
console.log(
  `Проверок: ${results.length - failed.length} из ${results.length} прошло   ` +
  `Ассертов: ${assertsPassed} прошло, ${assertsFailed} не прошло   ` +
  `${totalMs} мс`
);
console.log(`${'═'.repeat(70)}\n`);

process.exit(failed.length === 0 ? 0 : 1);
