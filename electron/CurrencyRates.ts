// Курсы валют для конвертера раздела «Приложения» AI-панели (src/components/aiApps.tsx).
// Источник — суточные курсы ЦБ РФ через зеркало cbr-xml-daily.ru (официальный XML ЦБ,
// переупакованный в JSON, без API-ключа). Fetch живёт в main, а не в renderer панели:
// у oblako-chrome:// нет гарантий CORS к внешним хостам, а fetchInProfile идёт через сетевой
// стек Chromium — уважает системный прокси (и будущий VPN), как обычные вкладки.
import { fetchInProfile } from './ProfileSession';

export interface CurrencyRatesResult {
  ok: boolean
  // Только при ok: дата курса (YYYY-MM-DD) и «сколько RUB стоит единица валюты» (RUB=1).
  date?: string
  rates?: Record<string, number>
  /** Курс предыдущего рабочего дня — из того же ответа ЦБ, отдельного запроса не требует. */
  prev?: Record<string, number>
  error?: string
}

const SOURCE_URL = 'https://www.cbr-xml-daily.ru/daily_json.js'
// Курсы ЦБ обновляются раз в сутки — часовой кэш убирает сетевой поход на каждое открытие
// конвертера, но не даёт залипнуть на вчерашних курсах в долгоживущей сессии браузера.
const CACHE_TTL_MS = 60 * 60 * 1000
let cache: { at: number; result: CurrencyRatesResult } | null = null

interface CbrValute { Value?: unknown; Nominal?: unknown; Previous?: unknown }

export async function getCurrencyRates(): Promise<CurrencyRatesResult> {
  if (cache && cache.result.ok && Date.now() - cache.at < CACHE_TTL_MS) return cache.result
  try {
    const res = await fetchInProfile(SOURCE_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { Date?: unknown; Valute?: Record<string, CbrValute> }
    const rates: Record<string, number> = { RUB: 1 }
    const prev: Record<string, number> = { RUB: 1 }
    for (const code of Object.keys(data.Valute ?? {})) {
      const v = data.Valute?.[code]
      // Value — рубли за Nominal единиц (у JPY номинал 100, у KZT 1000 и т.п.) — приводим к 1.
      if (v && typeof v.Value === 'number' && typeof v.Nominal === 'number' && v.Nominal > 0) {
        rates[code] = v.Value / v.Nominal
        if (typeof v.Previous === 'number') prev[code] = v.Previous / v.Nominal
      }
    }
    if (Object.keys(rates).length < 2) throw new Error('пустой ответ (нет Valute)')
    const result: CurrencyRatesResult = {
      ok: true,
      prev,
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


// ── История курса (спарклайн виджета) ────────────────────────────────────────
//
// ⚠️ Источник другой, чем у суточных курсов: cbr-xml-daily отдаёт только сегодня и вчера, а для
// графика нужен ряд. Официальный XML_dynamic ЦБ отдаёт весь диапазон ОДНИМ запросом — цепочка
// из тридцати обращений «по вчерашней ссылке» была бы и медленной, и невежливой к чужому серверу.
//
// Ответ приходит в windows-1251 и с запятой вместо точки — оба места легко не заметить: JSON.parse
// здесь неприменим, а parseFloat('77,22') молча вернёт 77.
const CBR_CODES: Record<string, string> = {
  USD: 'R01235', EUR: 'R01239', CNY: 'R01375', GBP: 'R01035', JPY: 'R01820',
  KZT: 'R01335', TRY: 'R01700J', BYN: 'R01090B', AMD: 'R01060', GEL: 'R01210',
}

const historyCache = new Map<string, { at: number; values: number[] }>()

export async function getCurrencyHistory(code: string, days = 30): Promise<number[]> {
  const id = CBR_CODES[code]
  if (!id) return []
  const key = `${code}:${days}`
  const hit = historyCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.values

  const fmt = (d: Date): string =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)

  try {
    const res = await fetchInProfile(
      `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${fmt(from)}&date_req2=${fmt(to)}&VAL_NM_RQ=${id}`,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    // windows-1251: в самих числах только цифры и запятые, поэтому декодируем как latin1 —
    // кириллица встречается лишь в названии валюты, которое нам не нужно.
    const text = new TextDecoder('windows-1251').decode(await res.arrayBuffer())
    const values: number[] = []
    for (const m of text.matchAll(/<Nominal>([\d.,]+)<\/Nominal>\s*<Value>([\d.,]+)<\/Value>/g)) {
      const nominal = Number(m[1].replace(',', '.'))
      const value = Number(m[2].replace(',', '.'))
      if (Number.isFinite(nominal) && nominal > 0 && Number.isFinite(value)) values.push(value / nominal)
    }
    historyCache.set(key, { at: Date.now(), values })
    return values
  } catch (e) {
    console.warn('[currency] история курса недоступна:', (e as Error).message)
    return []
  }
}
