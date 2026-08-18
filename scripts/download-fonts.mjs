// Качает woff2-субсеты шрифтов интерфейса с Google Fonts в src/assets/fonts.
//
// Зачем скрипт, если бинарники лежат в репозитории: чтобы происхождение файлов было
// воспроизводимым (какое семейство, какой диапазон весов, какие субсеты) и чтобы
// обновление сводилось к одной команде, а не к ручному лазанию по fonts.google.com.
// Сами .woff2 закоммичены — они маленькие (~160 КБ на всё), нужны при каждой сборке,
// и тянуть их из сети на билд-машине незачем.
//
// Диапазон весов запрашиваем 400..700 намеренно: Google Fonts отдаёт переменный файл,
// обрезанный по оси, — лишние 800/900 весят, а шкала Oblako (typography.css) выше 700
// не поднимается. У Golos Text ось начинается с 400 — веса 300 у него физически нет.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src', 'assets', 'fonts')

// UA настоящего Chrome — иначе Google Fonts отдаёт ttf вместо woff2.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

const FAMILIES = [
  { query: 'Golos+Text:wght@400..700', slug: 'golos-text', license: 'golostext' },
  { query: 'JetBrains+Mono:wght@400..700', slug: 'jetbrains-mono', license: 'jetbrainsmono' },
  // ⚠️ Третья гарнитура — ДИСПЛЕЙНАЯ, только для крупных чисел и «лиц» продукта (карточки стола,
  // приветствие, онбординг). В интерфейс она не заходит: плотный набор Unbounded в мелком кегле
  // теряет читаемость. Веса 600..800 — ниже 600 она невыразительна, а брать весь диапазон значит
  // тащить лишние килобайты ради начертаний, которых в макетах нет.
  { query: 'Unbounded:wght@600..800', slug: 'unbounded', license: 'unbounded' },
]

// latin-ext нужен не для UI-строк, а для заголовков чужих страниц в списке вкладок:
// они рисуются шрифтом хрома и бывают на любом европейском языке.
const SUBSETS = new Set(['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext'])

async function get(url, asText = false) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return asText ? res.text() : Buffer.from(await res.arrayBuffer())
}

await fs.mkdir(OUT, { recursive: true })

const ranges = []
for (const fam of FAMILIES) {
  const css = await get(
    `https://fonts.googleapis.com/css2?family=${fam.query}&display=block`,
    true,
  )
  const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)]
  if (!blocks.length) throw new Error(`не разобрал @font-face для ${fam.query}`)

  for (const [, subset, body] of blocks) {
    if (!SUBSETS.has(subset)) continue
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1]
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim()
    if (!url) continue
    const file = `${fam.slug}-${subset}.woff2`
    const bin = await get(url)
    await fs.writeFile(path.join(OUT, file), bin)
    ranges.push({ file, subset, range, bytes: bin.length })
    console.log(`  ${file.padEnd(34)} ${String(bin.length).padStart(6)} B`)
  }

  // OFL требует распространять текст лицензии вместе со шрифтом.
  const ofl = await get(
    `https://raw.githubusercontent.com/google/fonts/main/ofl/${fam.license}/OFL.txt`,
    true,
  )
  const oflName = `OFL-${fam.slug}.txt`
  await fs.writeFile(path.join(OUT, oflName), ofl, 'utf8')
  console.log(`  ${oflName}`)
}

const total = ranges.reduce((s, r) => s + r.bytes, 0)
console.log(`\nвсего ${ranges.length} субсетов, ${(total / 1024).toFixed(0)} КБ`)
console.log('\nunicode-range для src/styles/tokens/fonts.css:')
for (const r of ranges) console.log(`  ${r.file}\n    ${r.range}`)
