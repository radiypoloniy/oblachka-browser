// Сторож размера и состава файлов — «храповик» против расползания.
//
// ⚠️ ЗАЧЕМ. Замер 25.08.2026: 72 функции длиннее 120 строк, у Toolbar — 1827 строк в ОДНОЙ
// функции с 21 состоянием, 39 эффектами и 83 вызовами IPC. При этом архитектура здоровая: два
// цикла импортов на 353 файла. То есть беда не в схеме, а в том, что размер не проверял никто:
// дизайн-система не расползается, потому что её держит conventions-check, контракт IPC — потому
// что contract-check. Правило без машинной проверки в этом проекте не живёт.
//
// ⚠️ ХРАПОВИК, А НЕ ЗАПРЕТ. Переписать 90 тысяч строк разом нельзя, и делать вид, что можно, —
// значит получить вечно красную проверку, которую все привыкнут игнорировать. Поэтому текущее
// состояние зафиксировано в fixtures/structure-baseline.json:
//   • НОВЫЙ файл обязан уложиться в пороги;
//   • файл из базы не имеет права стать ХУЖЕ своей записи;
//   • стал лучше — фиксируем новый уровень (--update), и назад дороги уже нет.
//
// ⚠️ Разбор без AST — намеренно. Считаются строки и скобки: этого достаточно для «функция
// разрослась», а полноценный парсер здесь означал бы зависимость ради метрики. Ошибка в пару
// строк на границе функции ничего не меняет: пороги грубые по смыслу.
//
// Правила и пороги описаны словами в docs/architecture-code.md.
// Запуск: npm test -- structure   ·   обновить базу: node scripts/structure-check.mjs --update
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['electron', 'src', 'shared'];
const BASELINE = 'scripts/fixtures/structure-baseline.json';

/** Пороги для НОВОГО кода. Разбор, почему столько, — в docs/architecture-code.md. */
const LIMITS = {
  lines: 700,     // строк в файле
  fn: 200,        // строк в самой длинной функции файла
  effects: 8,     // useEffect/useLayoutEffect в одной функции
  ipc: 25,        // обращений window.oblako.* в файле
};

// ⚠️ Точки входа renderer'а и композитор main — единственные, кому позволено тянуть много всего;
// их размер всё равно проверяется, а вот счётчик IPC для них бессмысленен: они по определению
// разговаривают с main за всех.
const IPC_EXEMPT = new Set(['electron/main.ts', 'electron/preload.ts', 'electron/preload-content.ts']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).replace(/\\/g, '/');
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const FN_HEAD = new RegExp(
  '^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+(\\w+)'
  + '|^\\s*(?:public|private|protected)?\\s*(?:static\\s+)?(?:async\\s+)?(\\w+)\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\{\\s*$'
  + '|^\\s*(?:export\\s+)?const\\s+(\\w+)\\s*(?::[^=]+)?=\\s*(?:async\\s*)?\\([^)]*\\)\\s*(?::\\s*[^=]+)?=>\\s*\\{\\s*$',
);

/** Метрики одного файла. */
function measure(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let maxFn = 0;
  let maxFnName = '';
  let maxEffects = 0;
  let maxEffectsName = '';

  for (let i = 0; i < lines.length; i++) {
    const m = FN_HEAD.exec(lines[i]);
    if (!m || !lines[i].trimEnd().endsWith('{')) continue;
    const name = m[1] || m[2] || m[3] || '?';
    let depth = (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length;
    let j = i + 1;
    let effects = 0;
    while (j < lines.length && depth > 0) {
      if (/\buse(Layout)?Effect\s*\(/.test(lines[j])) effects++;
      depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
      j++;
    }
    const len = j - i;
    if (len > maxFn) { maxFn = len; maxFnName = name; }
    if (effects > maxEffects) { maxEffects = effects; maxEffectsName = name; }
    // Вложенные функции пропускаем: интересует верхний уровень, иначе одна и та же строка
    // считалась бы трижды и метрика перестала бы что-то значить.
    i = j - 1;
  }

  return {
    lines: lines.length,
    fn: maxFn,
    fnName: maxFnName,
    effects: maxEffects,
    effectsName: maxEffectsName,
    ipc: (src.match(/window\.oblako\./g) ?? []).length,
  };
}

const files = ROOTS.flatMap((r) => walk(r)).sort();
const current = {};
for (const f of files) {
  const m = measure(f);
  current[f] = { lines: m.lines, fn: m.fn, effects: m.effects, ipc: m.ipc };
  current[f].__names = { fn: m.fnName, effects: m.effectsName };
}

// ── Обновление базы ───────────────────────────────────────────────────────────
if (process.argv.includes('--update')) {
  const out = {};
  for (const f of files) {
    const { lines, fn, effects, ipc } = current[f];
    // В базу попадают только те, кто ВЫШЕ порогов: остальным запись не нужна, их держит порог.
    if (lines > LIMITS.lines || fn > LIMITS.fn || effects > LIMITS.effects
      || (ipc > LIMITS.ipc && !IPC_EXEMPT.has(f))) {
      out[f] = { lines, fn, effects, ipc };
    }
  }
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`\n  ok   база переписана: ${Object.keys(out).length} файлов сверх порогов → ${BASELINE}\n`);
  process.exit(0);
}

// ── Проверка ──────────────────────────────────────────────────────────────────
let baseline = {};
try {
  baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
} catch {
  console.log(`\n FAIL  нет базы ${BASELINE} — создайте: node scripts/structure-check.mjs --update\n`);
  process.exit(1);
}

let passed = 0;
let failed = 0;
const grew = [];
const born = [];
const healed = [];

for (const f of files) {
  const c = current[f];
  const b = baseline[f];
  const names = c.__names;

  for (const key of ['lines', 'fn', 'effects', 'ipc']) {
    if (key === 'ipc' && IPC_EXEMPT.has(f)) continue;
    const limit = LIMITS[key];
    const allowed = b ? Math.max(limit, b[key]) : limit;
    if (c[key] > allowed) {
      const what = key === 'lines' ? `строк в файле ${c.lines}`
        : key === 'fn' ? `строк в функции ${names.fn}() — ${c.fn}`
          : key === 'effects' ? `эффектов в ${names.effects}() — ${c.effects}`
            : `обращений к window.oblako — ${c.ipc}`;
      (b ? grew : born).push(`${f}: ${what} (можно ${allowed})`);
    }
  }

  // Похудел ниже записанного — база устарела и её стоит подтянуть, иначе храповик проворачивается назад.
  if (b) {
    const better = ['lines', 'fn', 'effects', 'ipc'].filter((k) => c[k] < b[k]);
    if (better.length) healed.push(`${f}: ${better.map((k) => `${k} ${b[k]} → ${c[k]}`).join(', ')}`);
  }
}

console.log('\n— новые файлы укладываются в пороги —');
if (born.length === 0) { passed++; console.log('  ok   да'); }
else { failed++; born.forEach((s) => console.log(` FAIL  ${s}`)); }

console.log('\n— файлы из базы не выросли —');
if (grew.length === 0) { passed++; console.log('  ok   да'); }
else { failed++; grew.forEach((s) => console.log(` FAIL  ${s}`)); }

if (healed.length) {
  console.log('\n— стали меньше, база отстала (не ошибка) —');
  healed.forEach((s) => console.log(`  ..   ${s}`));
  console.log('       зафиксировать: node scripts/structure-check.mjs --update');
}

const over = Object.keys(baseline).length;
// ⚠️ Счётчик — по ИНВАРИАНТАМ, а не по парам «файл × метрика»: их полторы тысячи, а проверяются
// здесь два утверждения. Общий прогон (scripts/test.mjs) читает строки ok/FAIL, и расхождение
// между «1409 ок» тут и «2 проверки» там сбивало бы с толку.
console.log(`\nПроверено файлов: ${files.length} · в базе сверх порогов: ${over}`);
console.log(`Итого: ${passed} ок, ${failed} провалено\n`);
process.exit(failed === 0 ? 0 : 1);
