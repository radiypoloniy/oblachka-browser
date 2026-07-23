// Курсы валют для конвертера раздела «Приложения» AI-панели (src/components/aiApps.tsx).
// Источник — суточные курсы ЦБ РФ через зеркало cbr-xml-daily.ru (официальный XML ЦБ,
// переупакованный в JSON, без API-ключа). Fetch живёт в main, а не в renderer панели:
// у oblako-chrome:// нет гарантий CORS к внешним хостам, а net.fetch идёт через сетевой
// стек Chromium — уважает системный прокси (и будущий VPN), как обычные вкладки.
import { net } from 'electron'

export interface CurrencyRatesResult {
  ok: boolean
  // Только при ok: дата курса (YYYY-MM-DD) и «сколько RUB стоит единица валюты» (RUB=1).
  date?: string
  rates?: Record<string, number>
  error?: string
}

const SOURCE_URL = 'https://www.cbr-xml-daily.ru/daily_json.js'
// Курсы ЦБ обновляются раз в сутки — часовой кэш убирает сетевой поход на каждое открытие
// конвертера, но не даёт залипнуть на вчерашних курсах в долгоживущей сессии браузера.
const CACHE_TTL_MS = 60 * 60 * 1000
let cache: { at: number; result: CurrencyRatesResult } | null = null

interface CbrValute { Value?: unknown; Nominal?: unknown }

export async function getCurrencyRates(): Promise<CurrencyRatesResult> {
  if (cache && cache.result.ok && Date.now() - cache.at < CACHE_TTL_MS) return cache.result
  try {
    const res = await net.fetch(SOURCE_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { Date?: unknown; Valute?: Record<string, CbrValute> }
    const rates: Record<string, number> = { RUB: 1 }
    for (const code of Object.keys(data.Valute ?? {})) {
      const v = data.Valute?.[code]
      // Value — рубли за Nominal единиц (у JPY номинал 100, у KZT 1000 и т.п.) — приводим к 1.
      if (v && typeof v.Value === 'number' && typeof v.Nominal === 'number' && v.Nominal > 0) {
        rates[code] = v.Value / v.Nominal
      }
    }
    if (Object.keys(rates).length < 2) throw new Error('пустой ответ (нет Valute)')
    const result: CurrencyRatesResult = {
      ok: true,
      date: typeof data.Date === 'string' ? data.Date.slice(0, 10) : '',
      rates,
    }
    cache = { at: Date.now(), result }
    return result
  } catch (e) {
    console.error('[currency] загрузка курсов упала:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
