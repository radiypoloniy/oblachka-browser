// Качает логотипы браузеров для экрана переноса данных в src/public/browsers.
//
// Зачем настоящие логотипы: на первом запуске человек выбирает, ОТКУДА переносить, и узнаёт свой
// браузер по значку быстрее, чем читает название. Буква в кружке (как было) этого не даёт.
//
// Источник — @browser-logos (github.com/alrra/browser-logos, MIT), официальные SVG вендоров.
// Имена файлов совпадают с vendorId из electron/browserImport/ChromiumDiscovery.ts — по нему
// renderer и выбирает картинку.
//
// ⚠️ Яндекс.Браузера в наборе нет, и его логотип сюда не тянем: вместо него рисуется буквенная
// плашка (см. src/components/BrowserLogo.tsx) — своя, а не чужой знак приблизительной копией.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src', 'public', 'browsers')

// vendorId из ChromiumDiscovery → имя пакета @browser-logos.
const LOGOS = {
  chrome: 'chrome',
  edge: 'edge',
  brave: 'brave',
  opera: 'opera',
  operagx: 'opera-gx',
  vivaldi: 'vivaldi',
}

await fs.mkdir(OUT, { recursive: true })

let bytes = 0
for (const [vendorId, pkg] of Object.entries(LOGOS)) {
  const url = `https://cdn.jsdelivr.net/npm/@browser-logos/${pkg}/${pkg}.svg`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  const svg = await res.text()
  await fs.writeFile(path.join(OUT, `${vendorId}.svg`), svg)
  bytes += Buffer.byteLength(svg)
}

console.log(`Логотипы: ${Object.keys(LOGOS).length} шт., ${(bytes / 1024).toFixed(0)} КБ → ${path.relative(ROOT, OUT)}`)
