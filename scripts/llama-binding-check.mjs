// Сторож GPU-инференса в УПАКОВАННОЙ сборке — без electron, обычным node.
//
// ⚠️ Проверяется не логика, а факт: применён ли патч node_modules из
// scripts/patch-llama-gpu-test.mjs. Без него node-llama-cpp перед загрузкой GPU-биндинга форкает
// `testBindingBinary.js` — файл, который в упакованном приложении лежит ВНУТРИ app.asar и
// форкнутому Node-процессу не виден. Тест не запускается, биндинг объявляется несовместимым,
// Vulkan и CUDA отбраковываются, остаётся `gpu=false`.
//
// Цена пропущенной проверки измерена на живой упакованной сборке: «0 из 0 ГБ видеопамяти»,
// пустой каталог моделей, «локальный AI не потянет» на машине с RTX 2070 SUPER, модель в ОЗУ
// вместо VRAM и генерация на всех ядрах процессора. `npm start` при этом работает нормально —
// то есть баг НЕ ловится ничем, кроме сборки установщика, и живёт до жалобы пользователя.
//
// Патч ставится postinstall'ом и потому одноразово-хрупок: `npm install --ignore-scripts`, ручная
// переустановка пакета, смена версии node-llama-cpp — и установщик молча уезжает без GPU.
// Эта проверка — единственный сигнал между таким install и жалобой.
//
// Запуск: npm test -- llama-binding
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const GET_LLAMA = path.join(ROOT, 'node_modules', 'node-llama-cpp', 'dist', 'bindings', 'getLlama.js');
const installed = fs.existsSync(GET_LLAMA);
check('node-llama-cpp установлен', installed, true);

if (installed) {
  const src = fs.readFileSync(GET_LLAMA, 'utf8');

  // Сам патч: в Electron на Windows вложенный тест биндинга не гоняется.
  check(
    'патч GPU-теста применён (иначе установщик считает ИИ на процессоре)',
    src.includes('process.versions.electron != null && platform === "win"'),
    true,
  );

  // ⚠️ Форма функции, в которую патч вставляется. Сменится сигнатура у node-llama-cpp — патч
  // тихо перестанет накладываться, и симптом вернётся; лучше уронить прогон здесь.
  check(
    'место вставки не уехало (getShouldTestBinaryBeforeLoading на месте)',
    src.includes('function getShouldTestBinaryBeforeLoading('),
    true,
  );

  // Патч обязан стоять ДО ветки linux — иначе он не перехватывает windows-путь.
  const at = src.indexOf('process.versions.electron != null && platform === "win"');
  const linuxAt = src.indexOf('if (platform === "linux") {', src.indexOf('function getShouldTestBinaryBeforeLoading('));
  check('патч стоит первым в функции, до ветки linux', at !== -1 && linuxAt !== -1 && at < linuxAt, true);
}

// ⚠️ Второй край того же баланса: postinstall обязан звать патч. Убрать его из цепочки — то же
// самое, что не применить, только незаметнее (у разработчика node_modules уже пропатчены).
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
check('postinstall зовёт патч', String(pkg.scripts?.postinstall ?? '').includes('postinstall:llama'), true);
check('скрипт patch-llama-gpu-test на месте', fs.existsSync(path.join(ROOT, 'scripts', 'patch-llama-gpu-test.mjs')), true);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
