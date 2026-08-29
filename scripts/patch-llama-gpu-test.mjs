#!/usr/bin/env node
/**
 * Почему упакованный браузер считал ИИ на процессоре, а `npm start` — на видеокарте.
 *
 * На Windows node-llama-cpp перед загрузкой GPU-биндинга ВСЕГДА проверяет его на совместимость
 * (`getShouldTestBinaryBeforeLoading` → `testBindingBinary`): форкает отдельный процесс, грузит
 * в нём .node и смотрит, выжил ли тот. Форкает он САМ СЕБЯ — файл
 * `node-llama-cpp/dist/bindings/utils/testBindingBinary.js`.
 *
 * ⚠️ В упакованном приложении этот файл лежит ВНУТРИ `app.asar`, и его путь — тоже внутри архива
 * (`...\resources\app.asar\node_modules\node-llama-cpp\dist\bindings\utils\testBindingBinary.js`).
 * Прозрачное чтение asar умеет только Electron; форкнутый процесс запускается как Node и такого
 * файла просто не видит. `asarUnpack` не помогает: он кладёт СОДЕРЖИМОЕ рядом, а путь, который
 * node-llama-cpp берёт из своего `import.meta.url`, остаётся архивным.
 *
 * Дальше по цепочке всё честно и молча: тест не запустился → биндинг объявлен несовместимым →
 * Vulkan отбракован → следом CUDA → остаётся `gpu=false`. Живой лог упакованной сборки:
 *   [node-llama-cpp] Failed to load a prebuilt binary for platform "win" "x64" with Vulkan
 *   support, falling back to using no GPU. Error: Binding binary test failed to run a test
 *   process via file "...\app.asar\node_modules\...\testBindingBinary.js"
 *   [gen] llama backend: gpu=false
 *   [gen] vram: gpu=false total=0 free=0
 * И отсюда же ВСЕ симптомы разом: «0 из 0 ГБ видеопамяти», пустой каталог моделей (бюджет VRAM
 * нулевой — см. ModelCatalog.assignRoles), «локальный AI не потянет» на машине с хорошей картой,
 * модель на 3–6 ГБ в ОЗУ вместо VRAM и генерация на всех ядрах процессора.
 *
 * ⚠️ Дело НЕ в fuse `runAsNode: false` (первая версия этого патча объясняла так). Замер: копия
 * electron.exe с тем же выключенным fuse, но с файлами на обычном диске, тест ПРОХОДИТ и находит
 * Vulkan. Ломает именно asar.
 *
 * Что делаем: в Electron на Windows тест не гоняем вовсе. Он и не нужен — несовместимый биндинг
 * уронит процесс инференса, а тот у нас отдельный и его падение приложение переживает
 * (electron/inference/InferenceHost.ts). Цена ошибки — перезапуск одного utilityProcess, а не
 * молчаливая деградация до процессора на каждой машине с установщиком.
 *
 * Идемпотентен — гоняется каждым `npm install`. Целостность проверяет
 * `scripts/llama-binding-check.mjs` (входит в `npm test`): без него неприменившийся патч
 * означал бы установщик без GPU-инференса и ни одного сигнала об этом.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(__dirname, '..', 'node_modules', 'node-llama-cpp', 'dist', 'bindings', 'getLlama.js')

if (!fs.existsSync(FILE)) {
  console.log('[patch-llama-gpu-test] node-llama-cpp не найден — пропуск')
  process.exit(0)
}

const MARKER = 'process.versions.electron != null && platform === "win"'
const BROKEN = `function getShouldTestBinaryBeforeLoading({ isPrebuiltBinary, platform, platformInfo, buildMetadata }) {
    if (platform === "linux") {`
const FIXED = `function getShouldTestBinaryBeforeLoading({ isPrebuiltBinary, platform, platformInfo, buildMetadata }) {
    if (process.versions.electron != null && platform === "win")
        return false;
    if (platform === "linux") {`

const src = fs.readFileSync(FILE, 'utf8')
if (src.includes(MARKER)) {
  console.log('[patch-llama-gpu-test] уже применён — пропуск')
  process.exit(0)
}
if (!src.includes(BROKEN)) {
  console.warn('[patch-llama-gpu-test] ожидаемая функция не найдена — версия пакета сменилась?')
  process.exit(1)
}
fs.writeFileSync(FILE, src.replace(BROKEN, FIXED), 'utf8')
console.log('[patch-llama-gpu-test] Windows+Electron: не тестировать GPU-биндинг вложенным fork')
