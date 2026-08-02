// Качает готовые наборы иконок для рабочего стола новой вкладки.
//
// Почему готовые, а не свои: и погода, и иконки приложений — это места, где кустарность видна
// сразу. Эмодзи в виджете погоды выглядели дёшево, а тонкие штриховые глифы на плитках —
// пусто. Оба набора открытые, оба уже в нужном стиле:
//
// • Meteocons (basmilius/weather-icons, MIT) — цветные объёмные иконки погоды, ровно тот вид,
//   что у системного виджета Apple. Берём вариант fill/all.
// • Phosphor Icons (MIT) — плотные силуэты для плиток приложений. Рисуются БЕЛЫМИ через
//   CSS-маску поверх градиента (см. AppIconBadge), поэтому качаем обычные чёрные SVG.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEATHER_OUT = path.join(ROOT, 'src', 'public', 'weather')
const APPS_OUT = path.join(ROOT, 'src', 'public', 'appicons')

const METEOCONS = '2.0.0'
const PHOSPHOR = '2.1.1'

// Имена соответствуют кодам WMO Open-Meteo (см. wmoIconName в widgets.tsx).
const WEATHER = [
  'clear-day', 'clear-night',
  'partly-cloudy-day', 'partly-cloudy-night',
  'overcast-day', 'overcast-night',
  'fog-day', 'fog-night',
  'drizzle', 'rain', 'sleet', 'snow',
  'thunderstorms-rain', 'thunderstorms-day-rain', 'thunderstorms-night-rain',
  'not-available',
]

// Глифы приложений: ключ — id из реестра APPS (aiApps.tsx), значение — имя иконки Phosphor.
const APP_ICONS = {
  calc: 'calculator-fill',
  convert: 'arrows-clockwise-bold',
  timer: 'timer-fill',
  color: 'eyedropper-sample-fill',
  kitten: 'cat-fill',
  counter: 'text-aa-fill',
  web: 'globe-hemisphere-west-fill',
  translate: 'translate-fill',
}

async function fetchText(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.text()
}

await fs.mkdir(WEATHER_OUT, { recursive: true })
await fs.mkdir(APPS_OUT, { recursive: true })

let bytes = 0
for (const name of WEATHER) {
  const svg = await fetchText(`https://cdn.jsdelivr.net/npm/@bybas/weather-icons@${METEOCONS}/production/fill/all/${name}.svg`)
  await fs.writeFile(path.join(WEATHER_OUT, `${name}.svg`), svg)
  bytes += Buffer.byteLength(svg)
}
console.log(`Погода: ${WEATHER.length} иконок, ${(bytes / 1024).toFixed(0)} КБ`)

bytes = 0
for (const [id, icon] of Object.entries(APP_ICONS)) {
  const weight = icon.endsWith('-bold') ? 'bold' : 'fill'
  const svg = await fetchText(`https://cdn.jsdelivr.net/npm/@phosphor-icons/core@${PHOSPHOR}/assets/${weight}/${icon}.svg`)
  await fs.writeFile(path.join(APPS_OUT, `${id}.svg`), svg)
  bytes += Buffer.byteLength(svg)
}
console.log(`Приложения: ${Object.keys(APP_ICONS).length} иконок, ${(bytes / 1024).toFixed(0)} КБ`)
