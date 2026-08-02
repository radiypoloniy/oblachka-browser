// Качает SVG-флаги стран для списка VPN-серверов в src/public/flags.
//
// Зачем файлами, а не эмодзи: Windows не рисует пары regional indicator как флаг (Segoe UI
// Emoji их не содержит) — «🇳🇱» показывается двумя буквами. См. shared/countries.ts.
//
// Зачем public, а не assets: флаги подключаются по имени файла в момент отрисовки строки
// (какая страна — известно только в рантайме). Через bundler это означало бы либо весь набор
// в JS-бандле, либо динамический импорт; из public они просто лежат в dist/flags и отдаются
// протоколом oblako-chrome:// как обычные картинки.
//
// Источник — flag-icons (MIT, github.com/lipis/flag-icons) через jsDelivr. Сами SVG
// закоммичены: они маленькие, нужны при каждой сборке, и браузер не должен зависеть от сети,
// чтобы нарисовать свой же интерфейс (та же логика, что у шрифтов в download-fonts.mjs).
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src', 'public', 'flags')
const TABLE = path.join(ROOT, 'shared', 'countries.ts')
const VERSION = '7.5.0'

// Коды берём из самой таблицы, чтобы список стран жил в одном месте: добавил страну в
// countries.ts — перекачал флаги, и ничего не забылось. Разбираем регуляркой, а не импортом:
// таблица на TypeScript, а скрипт запускается голым node без сборки.
const source = await fs.readFile(TABLE, 'utf8')
const codes = [...source.matchAll(/\{\s*code:\s*'([a-z]{2})'/g)].map((m) => m[1])
if (!codes.length) throw new Error('не нашёл ни одного кода страны в shared/countries.ts')

await fs.mkdir(OUT, { recursive: true })

let downloaded = 0
let bytes = 0
for (const code of codes) {
  const url = `https://cdn.jsdelivr.net/npm/flag-icons@${VERSION}/flags/4x3/${code}.svg`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  const svg = await res.text()
  await fs.writeFile(path.join(OUT, `${code}.svg`), svg)
  downloaded += 1
  bytes += Buffer.byteLength(svg)
}

console.log(`Флаги: ${downloaded} шт., ${(bytes / 1024).toFixed(0)} КБ → ${path.relative(ROOT, OUT)}`)
