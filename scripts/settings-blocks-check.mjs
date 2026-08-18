// Сторож якорей поиска по настройкам: каждый `block` из shared/settingsIndex.ts обязан
// существовать в UI как ДОСЛОВНЫЙ заголовок <Subsection title="…">.
//
// ⚠️ Почему это не ловится ничем другим. Поиск прокручивает к блоку по атрибуту
// `data-setting-block="<заголовок>"`, который kit.tsx проставляет из title. Разойдясь, эти две
// строки не дают ни ошибки типов, ни падения: результат поиска находится, подсвечивается в
// списке, а прокрутка молча не происходит — человек видит «поиск не работает». Ровно так и
// случилось: блок «Сайдбар» переименовали в «Фон интерфейса» (подкраска стала свойством окна),
// а запись в индексе осталась прежней.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function check(what, got, want) {
  const ok = got === want;
  if (ok) passed++; else { failed++; console.log(`  ✘ ${what}: получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`); }
}

// Заголовки всех Subsection в UI настроек.
const tsxFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.tsx')) tsxFiles.push(p);
  }
})(join(ROOT, 'src', 'components'));

const titles = new Set();
for (const f of tsxFiles) {
  for (const m of readFileSync(f, 'utf8').matchAll(/<Subsection[^>]*?title="([^"]+)"/gs)) titles.add(m[1]);
}

const index = readFileSync(join(ROOT, 'shared', 'settingsIndex.ts'), 'utf8');
const blocks = [...index.matchAll(/section:\s*'([a-z]+)',\s*block:\s*'([^']+)'/g)]
  .map((m) => ({ section: m[1], block: m[2] }));

console.log(`settings-blocks: блоков в индексе ${blocks.length}, заголовков Subsection в UI ${titles.size}`);
check('индекс не пуст', blocks.length > 0, true);
check('заголовки найдены', titles.size > 0, true);
for (const b of blocks) check(`якорь «${b.block}» (${b.section}) существует в UI`, titles.has(b.block), true);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло`);
process.exit(failed === 0 ? 0 : 1);
