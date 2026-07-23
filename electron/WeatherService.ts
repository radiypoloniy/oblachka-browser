// Погода для виджета раздела «Приложения» AI-панели (src/components/aiApps.tsx).
// Источник — Open-Meteo (без API-ключа): геокодинг названия города + текущая погода.
// Fetch в main по той же причине, что и CurrencyRates.ts: у oblako-chrome:// нет гарантий
// CORS, а net.fetch идёт через сетевой стек Chromium (прокси/будущий VPN — как у вкладок).
import { net } from 'electron'

export interface WeatherResult {
  ok: boolean
  // Только при ok: имя города из геокодера, температура °C, WMO-код погоды, ветер км/ч.
  city?: string
  tempC?: number
  weatherCode?: number
  windKmh?: number
  error?: string
}

// 15 минут — темп обновления самой Open-Meteo для current-погоды; чаще ходить бессмысленно.
const CACHE_TTL_MS = 15 * 60 * 1000
// Ключ — нормализованный запрос города; ошибки не кэшируем (см. проверку result.ok).
const cache = new Map<string, { at: number; result: WeatherResult }>()

export async function getWeather(cityQuery: string): Promise<WeatherResult> {
  const query = cityQuery.trim()
  if (!query) return { ok: false, error: 'город не задан' }
  const key = query.toLowerCase()
  const hit = cache.get(key)
  if (hit && hit.result.ok && Date.now() - hit.at < CACHE_TTL_MS) return hit.result

  try {
    const geoRes = await net.fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=ru&format=json`,
    )
    if (!geoRes.ok) throw new Error(`геокодинг: HTTP ${geoRes.status}`)
    const geo = (await geoRes.json()) as {
      results?: { latitude?: unknown; longitude?: unknown; name?: unknown }[]
    }
    const place = geo.results?.[0]
    if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') {
      return { ok: false, error: `город «${query}» не найден` }
    }

    const wRes = await net.fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,weather_code,wind_speed_10m`,
    )
    if (!wRes.ok) throw new Error(`прогноз: HTTP ${wRes.status}`)
    const w = (await wRes.json()) as {
      current?: { temperature_2m?: unknown; weather_code?: unknown; wind_speed_10m?: unknown }
    }
    const cur = w.current
    if (!cur || typeof cur.temperature_2m !== 'number') throw new Error('пустой ответ прогноза')

    const result: WeatherResult = {
      ok: true,
      city: typeof place.name === 'string' ? place.name : query,
      tempC: cur.temperature_2m,
      weatherCode: typeof cur.weather_code === 'number' ? cur.weather_code : -1,
      windKmh: typeof cur.wind_speed_10m === 'number' ? cur.wind_speed_10m : undefined,
    }
    cache.set(key, { at: Date.now(), result })
    return result
  } catch (e) {
    console.error('[weather] загрузка погоды упала:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
