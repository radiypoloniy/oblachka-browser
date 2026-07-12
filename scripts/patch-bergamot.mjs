#!/usr/bin/env node
/**
 * Патчи для @browsermt/bergamot-translator — три реальных бага, найденных ЖИВЫМ прогоном
 * scripts/bergamot-smoke.mjs (не в теории):
 *
 * 1) worker/ наследует "type":"module" от package.json пакета, но его же Node-совместимый
 *    слой (worker/translator-worker.js, класс GlobalWorkerScope) написан в расчёте на CommonJS —
 *    зовёт голый `require('node:worker_threads')`. Под ESM это ReferenceError: require is not
 *    defined in ES module scope — воркер падал ещё до перевода, см. живой лог:
 *    "WASM Translation Worker error: ReferenceError: require is not defined in ES module scope".
 *    Фикс — worker/package.json с {"type":"commonjs"}: Node резолвит тип модуля по ближайшему
 *    package.json, значит .js в worker/ станут CommonJS независимо от родителя, и require()
 *    внутри снова легален. Правки самого translator-worker.js не нужны.
 *
 * 2) self.location строится как `new URL(\`file://${__filename}\`)` — на Windows __filename
 *    содержит бэкслеши и букву диска (C:\...), это не валидный URL (не та схема, не эскейпится).
 *    Фикс — pathToFileURL(__filename) из node:url, которая сама знает про Windows-пути.
 *
 * 3) Тот же класс родовой болезни, что и #2, но в другом месте: self.fetch() для 'file:' URL
 *    читает файл через `readFile(url.pathname)` — url.pathname у файлового URL на Windows это
 *    "/C:/Users/..." (ведущий слэш перед буквой диска, часть URL-спецификации), а не нормальный
 *    Windows-путь. Node трактует такую строку буквально (папка "C:" от корня "/"), и получает
 *    ДВОЙНОЙ диск в итоговой ошибке: "ENOENT: ... open 'C:\C:\Users\...\
 *    bergamot-translator-worker.wasm'" — см. живой лог. Фикс — fileURLToPath(url) вместо
 *    url.pathname, та же идея, что и в патче #2.
 *
 * Остальной Node-слой (self.addEventListener/postMessage поверх parentPort, self.importScripts
 * поверх readFileSync+eval, globalThis.Worker поверх worker_threads.Worker в translator.js) уже
 * корректен из коробки.
 *
 * Идемпотентен — безопасно гонять на каждый npm install (см. package.json::postinstall).
 * Запуск: node scripts/patch-bergamot.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_DIR = path.join(__dirname, '..', 'node_modules', '@browsermt', 'bergamot-translator')
const WORKER_DIR = path.join(PKG_DIR, 'worker')
const WORKER_FILE = path.join(WORKER_DIR, 'translator-worker.js')

if (!fs.existsSync(WORKER_FILE)) {
  console.log('[patch-bergamot] node_modules/@browsermt/bergamot-translator не найден — пропуск (npm install ещё не ставил пакет?)')
  process.exit(0)
}

// ── Патч 1: worker/package.json — форсируем CommonJS для этой поддиректории ──────────────────
const WORKER_PKG_JSON = path.join(WORKER_DIR, 'package.json')
if (fs.existsSync(WORKER_PKG_JSON)) {
  console.log('[patch-bergamot] worker/package.json уже есть — пропуск (патч 1/3)')
} else {
  fs.writeFileSync(WORKER_PKG_JSON, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n', 'utf8')
  console.log('[patch-bergamot] создан worker/package.json {"type":"commonjs"} — require() в translator-worker.js снова легален (патч 1/3)')
}

// ── Патч 2: self.location через pathToFileURL (Windows-safe) ─────────────────────────────────
const BROKEN = 'return new URL(`file://${__filename}`);'
const FIXED = "return require('node:url').pathToFileURL(__filename);"

const src = fs.readFileSync(WORKER_FILE, 'utf8')

if (src.includes('pathToFileURL(__filename)')) {
  console.log('[patch-bergamot] translator-worker.js уже пропатчен — пропуск (патч 2/3)')
} else if (!src.includes(BROKEN)) {
  console.warn('[patch-bergamot] ожидаемая строка не найдена — версия пакета сменилась?')
  console.warn(`[patch-bergamot] искали: ${BROKEN}`)
  console.warn('[patch-bergamot] патч 2/3 НЕ применён, проверь вручную worker/translator-worker.js::get location()')
  process.exit(1)
} else {
  fs.writeFileSync(WORKER_FILE, src.replace(BROKEN, FIXED), 'utf8')
  console.log('[patch-bergamot] self.location теперь строится через pathToFileURL (патч 2/3)')
}

// ── Патч 3: fetch() для file:// — fileURLToPath(url) вместо url.pathname (Windows-safe) ───────
const src2 = fs.readFileSync(WORKER_FILE, 'utf8')
const BROKEN3 = 'const buffer = await readFile(url.pathname);'
const FIXED3 = "const buffer = await readFile(require('node:url').fileURLToPath(url));"

if (src2.includes(FIXED3)) {
  console.log('[patch-bergamot] fetch() уже пропатчен — пропуск (патч 3/3)')
} else if (!src2.includes(BROKEN3)) {
  console.warn('[patch-bergamot] ожидаемая строка не найдена (патч 3/3) — версия пакета сменилась?')
  console.warn(`[patch-bergamot] искали: ${BROKEN3}`)
  console.warn('[patch-bergamot] патч 3/3 НЕ применён, проверь вручную worker/translator-worker.js::fetch()')
  process.exit(1)
} else {
  fs.writeFileSync(WORKER_FILE, src2.replace(BROKEN3, FIXED3), 'utf8')
  console.log('[patch-bergamot] fetch() теперь читает file:// через fileURLToPath (патч 3/3)')
}
