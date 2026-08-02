// Погода для виджета раздела «Приложения» AI-панели (src/components/aiApps.tsx).
// Источник — Open-Meteo (без API-ключа): геокодинг названия города + текущая погода.
// Fetch в main по той же причине, что и CurrencyRates.ts: у oblako-chrome:// нет гарантий
// CORS, а net.fetch идёт через сетевой стек Chromium (прокси/будущий VPN — как у вкладок).
import { net } from 'electron'

export interface WeatherResult {
  /** Ощущается как — Apple показывает её первой строкой под температурой. */
  feelsC?: number
  /** День или ночь по данным станции: от этого зависит цвет плитки виджета. */
  isDay?: boolean
  maxC?: number
  minC?: number
  /** Ближайшие часы, начиная с текущего. */
  hours?: { hour: number; tempC: number; code: number }[]
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

    // ⚠️ Кроме текущей погоды просим почасовой ряд и суточные крайности: виджету на рабочем
    // столе одной цифры мало — без «ощущается», максимума-минимума и ближайших часов плитка
    // выглядит пустой (ровно то, за что виджет и ругают). is_day нужен, чтобы ночью плитка была
    // тёмной, а не «солнечной».
    const wRes = await net.fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,apparent_temperature,is_day` +
      `&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min` +
      `&forecast_days=2&timezone=auto`,
    )
    if (!wRes.ok) throw new Error(`прогноз: HTTP ${wRes.status}`)
    const w = (await wRes.json()) as {
      current?: {
        time?: unknown; temperature_2m?: unknown; weather_code?: unknown
        wind_speed_10m?: unknown; apparent_temperature?: unknown; is_day?: unknown
      }
      hourly?: { time?: unknown[]; temperature_2m?: unknown[]; weather_code?: unknown[] }
      daily?: { temperature_2m_max?: unknown[]; temperature_2m_min?: unknown[] }
    }
    const cur = w.current
    if (!cur || typeof cur.temperature_2m !== 'number') throw new Error('пустой ответ прогноза')

    // Ближайшие часы: ряд начинается с полуночи, поэтому отсчитываем от текущего часа.
    const hours: { hour: number; tempC: number; code: number }[] = []
    const times = Array.isArray(w.hourly?.time) ? w.hourly.time : []
    const temps = Array.isArray(w.hourly?.temperature_2m) ? w.hourly.temperature_2m : []
    const codes = Array.isArray(w.hourly?.weather_code) ? w.hourly.weather_code : []
    const nowIso = typeof cur.time === 'string' ? cur.time : ''
    let start = times.findIndex((t) => typeof t === 'string' && t >= nowIso)
    if (start < 0) start = 0
    for (let i = start; i < Math.min(start + 8, times.length); i++) {
      const t = times[i]
      if (typeof t !== 'string' || typeof temps[i] !== 'number') continue
      hours.push({
        hour: Number(t.slice(11, 13)),
        tempC: temps[i] as number,
        code: typeof codes[i] === 'number' ? (codes[i] as number) : -1,
      })
    }

    const maxArr = w.daily?.temperature_2m_max
    const minArr = w.daily?.temperature_2m_min

    const result: WeatherResult = {
      ok: true,
      city: typeof place.name === 'string' ? place.name : query,
      tempC: cur.temperature_2m,
      weatherCode: typeof cur.weather_code === 'number' ? cur.weather_code : -1,
      windKmh: typeof cur.wind_speed_10m === 'number' ? cur.wind_speed_10m : undefined,
      feelsC: typeof cur.apparent_temperature === 'number' ? cur.apparent_temperature : undefined,
      isDay: cur.is_day === 1 || cur.is_day === true,
      maxC: Array.isArray(maxArr) && typeof maxArr[0] === 'number' ? maxArr[0] : undefined,
      minC: Array.isArray(minArr) && typeof minArr[0] === 'number' ? minArr[0] : undefined,
      hours,
    }
    cache.set(key, { at: Date.now(), result })
    return result
  } catch (e) {
    console.error('[weather] загрузка погоды упала:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
