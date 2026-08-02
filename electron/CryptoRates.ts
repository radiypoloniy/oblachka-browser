// Курсы криптовалют для виджета «Крипта» на рабочем столе новой вкладки.
//
// ⚠️ Почему отдельный модуль, а не строки в CurrencyRates.ts: у ЦБ крипты нет вовсе, источник
// внешний и чужой, и главное — у него ДРУГАЯ природа данных. Курс ЦБ меняется раз в сутки, и
// часовой кэш там уместен; биткоин за час уезжает на проценты, и тот же кэш показывал бы
// неправду с уверенным видом. Смешивать их в одном модуле значило бы навязать одному ритм другого.
//
// Источник — CoinGecko: без ключа, отдаёт цены сразу В РУБЛЯХ (не через кросс-курс к доллару, где
// накапливалась бы своя ошибка) и изменение за 24 часа в том же ответе. Fetch живёт в main через
// net.fetch по тем же причинам, что у CurrencyRates.ts: CORS у oblako-chrome:// не гарантирован,
// а net.fetch уважает системный прокси и VPN, как обычные вкладки.
import { net } from 'electron'

export interface CryptoRatesResult {
  ok: boolean
  /** Только при ok: «сколько RUB стоит единица актива», ключ — тикер (BTC, ETH…). */
  rates?: Record<string, number>
  /** Изменение за 24 часа в процентах. Приходит тем же ответом, отдельного запроса не нужно. */
  change24h?: Record<string, number>
  error?: string
}

// Тикер → id в CoinGecko. Держим карту у себя: тикеры человек видит в интерфейсе, а id —
// деталь чужого API, и просачиваться в настройки и localStorage ей незачем.
const COIN_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  TON: 'the-open-network',
  SOL: 'solana',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  USDT: 'tether',
  BNB: 'binancecoin',
}

export const CRYPTO_TICKERS = Object.keys(COIN_IDS)

// Пять минут: достаточно коротко, чтобы цифра не врала, и достаточно длинно, чтобы открытие
// новой вкладки десять раз подряд не превратилось в десять запросов к чужому бесплатному API.
const CACHE_TTL_MS = 5 * 60 * 1000
// История для спарклайна — суточная и меняется раз в день, ей хватает часа.
const HISTORY_TTL_MS = 60 * 60 * 1000

let cache: { at: number; result: CryptoRatesResult } | null = null

export async function getCryptoRates(): Promise<CryptoRatesResult> {
  if (cache && cache.result.ok && Date.now() - cache.at < CACHE_TTL_MS) return cache.result
  try {
    // Просим ВСЕ известные тикеры одним запросом, а не только выбранные в настройках: ответ
    // всё равно крошечный, зато переключение актива в настройках не идёт в сеть заново.
    const ids = Object.values(COIN_IDS).join(',')
    const res = await net.fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=rub&include_24hr_change=true`,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as Record<string, { rub?: unknown; rub_24h_change?: unknown }>

    const rates: Record<string, number> = {}
    const change24h: Record<string, number> = {}
    for (const [ticker, id] of Object.entries(COIN_IDS)) {
      const row = data[id]
      if (row && typeof row.rub === 'number' && Number.isFinite(row.rub)) {
        rates[ticker] = row.rub
        if (typeof row.rub_24h_change === 'number' && Number.isFinite(row.rub_24h_change)) {
          change24h[ticker] = row.rub_24h_change
        }
      }
    }
    if (Object.keys(rates).length === 0) throw new Error('пустой ответ (ни одной цены)')

    const result: CryptoRatesResult = { ok: true, rates, change24h }
    cache = { at: Date.now(), result }
    return result
  } catch (e) {
    console.error('[crypto] загрузка курсов упала:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── История цены (спарклайн виджета) ─────────────────────────────────────────

const historyCache = new Map<string, { at: number; values: number[] }>()

export async function getCryptoHistory(ticker: string, days = 30): Promise<number[]> {
  const id = COIN_IDS[ticker]
  if (!id) return []
  const key = `${ticker}:${days}`
  const hit = historyCache.get(key)
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.values

  try {
    const res = await net.fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=rub&days=${days}&interval=daily`,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    // prices — массив пар [время, цена]; время нам не нужно, спарклайн равномерный по индексу.
    const data = (await res.json()) as { prices?: unknown }
    const values: number[] = []
    if (Array.isArray(data.prices)) {
      for (const pair of data.prices as unknown[]) {
        if (Array.isArray(pair) && typeof pair[1] === 'number' && Number.isFinite(pair[1])) {
          values.push(pair[1])
        }
      }
    }
    historyCache.set(key, { at: Date.now(), values })
    return values
  } catch (e) {
    console.warn('[crypto] история цены недоступна:', (e as Error).message)
    return []
  }
}
