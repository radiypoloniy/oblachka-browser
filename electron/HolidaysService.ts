import { fetchInProfile } from './ProfileSession';

// Ближайший государственный праздник — для виджета «Праздники» на рабочем столе.
// Источник — date.nager.at (без ключа, без регистрации). Fetch в main по той же причине, что у
// WeatherService/CurrencyRates: у oblako-chrome:// нет гарантий CORS, а fetchInProfile идёт сетевым
// стеком Chromium, то есть уважает прокси и VPN, как обычные вкладки.
//
// ⚠️ Это НОВЫЙ получатель данных, и footprint у него намеренно крошечный: один запрос на год,
// в нём нет ни координат, ни адресов, ни чего-либо о человеке — только код страны. Кэш держит
// год целиком, поэтому за сеанс запрос уходит максимум один раз (а обычно ноль — данные уже в
// памяти). Виджет по этой же причине не стоит на столе по умолчанию, как и все сетевые.

interface Holiday { date: string; localName: string; name: string }

export interface NextHoliday {
  ok: boolean
  /** Название на языке страны — «День России», а не «Russia Day». */
  name?: string
  /** ISO-дата праздника. */
  date?: string
  /** Сколько дней осталось; 0 — сегодня. */
  daysUntil?: number
  error?: string
}

// Ключ кэша — «страна:год». Праздники за год не меняются, поэтому TTL суточный: он нужен не
// ради свежести данных, а чтобы после смены года список сам перечитался.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, { at: number; list: Holiday[] }>()

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

async function fetchYear(country: string, year: number): Promise<Holiday[]> {
  const key = `${country}:${year}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.list

  const res = await fetchInProfile(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const raw = (await res.json()) as unknown
  const list = Array.isArray(raw)
    ? raw.filter((h): h is Holiday =>
      !!h && typeof (h as Holiday).date === 'string' && typeof (h as Holiday).localName === 'string')
    : []
  cache.set(key, { at: Date.now(), list })
  return list
}

export async function getNextHoliday(country = 'RU'): Promise<NextHoliday> {
  try {
    const now = new Date()
    const today = startOfDay(now)
    // ⚠️ Смотрим и СЛЕДУЮЩИЙ год тоже: в конце декабря ближайший праздник почти всегда уже за
    // границей года, и без второго запроса виджет в самые новогодние дни показывал бы «нет
    // ближайших праздников» — ровно тогда, когда он интереснее всего.
    const list = [
      ...await fetchYear(country, now.getFullYear()),
      ...await fetchYear(country, now.getFullYear() + 1).catch(() => [] as Holiday[]),
    ]

    const upcoming = list
      .map((h) => ({ h, ts: startOfDay(new Date(`${h.date}T00:00:00`)) }))
      .filter((x) => Number.isFinite(x.ts) && x.ts >= today)
      .sort((a, b) => a.ts - b.ts)[0]

    if (!upcoming) return { ok: false, error: 'нет данных о праздниках' }
    return {
      ok: true,
      name: upcoming.h.localName,
      date: upcoming.h.date,
      daysUntil: Math.round((upcoming.ts - today) / 86_400_000),
    }
  } catch (e) {
    console.error('[holidays] загрузка упала:', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
