// Качает SVG-значки криптовалют для виджета «Крипта» в src/public/crypto.
//
// Зачем файлами, а не текстом: в виджете стояли символы валют из шрифта — «₿», «Ξ», «Ð», «₮»,
// а у половины монет своего знака в Unicode нет вовсе, и там оставался голый тикер («SOL»,
// «XRP»). Получался разнобой из экзотических глифов и трёхбуквенных подписей, по которому
// монету не опознать: Golos Text рисует «Ξ» и «Ð» как случайные буквы. Настоящий логотип
// монеты узнаётся мгновенно — та же причина, по которой флаги стран лежат картинками
// (см. download-flags.mjs).
//
// Зачем public, а не assets: набор монет выбирает человек в настройках, файл известен только
// в рантайме. Из public значки просто лежат в dist/crypto и отдаются протоколом
// oblako-chrome:// как обычные картинки.
//
// Источники — оба CC0, оба через jsDelivr:
//  • cryptocurrency-icons (github.com/spothq/cryptocurrency-icons) — цветной кружок с белым
//    знаком, ровно та же плитка-кружок, что и у нас в интерфейсе;
//  • simple-icons — только для TON: набор выше заморожен в 2021-м и Toncoin в него не попал.
//    Там знак одноцветный (кружок и знак — одна фигура с выемкой), поэтому цвет бренда
//    подставляем сами.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src', 'public', 'crypto')
const TABLE = path.join(ROOT, 'src', 'newtab', 'settings.ts')
const ICONS_VERSION = '0.18.1'
const SIMPLE_VERSION = '13'

// Монеты, которых нет в основном наборе: свой источник и свой цвет бренда.
const FALLBACK = {
  TON: { slug: 'ton', color: '#0098EA' },
}

// Коды берём из самой таблицы выбора монет — добавил монету в CRYPTO_CHOICES, перекачал
// значки, и ничего не забылось. Регуляркой, а не импортом: таблица на TypeScript, а скрипт
// запускается голым node без сборки.
// ⚠️ Именно блок CRYPTO_CHOICES, а не весь файл: рядом живёт такая же таблица обычных валют
// (CURRENCY_CHOICES), и по всему файлу в набор попадали бы тенге с юанем.
const source = await fs.readFile(TABLE, 'utf8')
const block = source.match(/CRYPTO_CHOICES[^=]*=\s*\[([\s\S]*?)\]/)
if (!block) throw new Error('не нашёл CRYPTO_CHOICES в src/newtab/settings.ts')
const codes = [...block[1].matchAll(/\{\s*code:\s*'([A-Z0-9]{2,6})'/g)].map((m) => m[1])
if (!codes.length) throw new Error('в CRYPTO_CHOICES нет ни одной монеты')

await fs.mkdir(OUT, { recursive: true })

const get = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.text()
}

let bytes = 0
for (const code of codes) {
  const fallback = FALLBACK[code]
  let svg
  if (fallback) {
    const raw = await get(`https://cdn.jsdelivr.net/npm/simple-icons@${SIMPLE_VERSION}/icons/${fallback.slug}.svg`)
    // <title> — для скринридера самого набора, у нас подпись даёт alt картинки; fill
    // проставляем явно, иначе знак нарисуется чёрным (по умолчанию там currentColor).
    svg = raw.replace(/<title>.*?<\/title>/g, '').replace('<path', `<path fill="${fallback.color}"`)
  } else {
    svg = await get(`https://cdn.jsdelivr.net/npm/cryptocurrency-icons@${ICONS_VERSION}/svg/color/${code.toLowerCase()}.svg`)
  }
  await fs.writeFile(path.join(OUT, `${code.toLowerCase()}.svg`), svg)
  bytes += Buffer.byteLength(svg)
}

console.log(`Значки монет: ${codes.length} шт., ${(bytes / 1024).toFixed(0)} КБ → ${path.relative(ROOT, OUT)}`)
