// Курсы валют для конвертера И виджета «Курс валют» — одна точка на обоих.
export interface CurrencyRatesData { date: string; rates: Record<string, number> }
// Кэш уровня модуля: конвертер размонтируется при закрытии слота — не перезапрашиваем курсы
// (даже IPC-раундтрип) на каждое переоткрытие. Main кэширует сам fetch независимо.
// Общий для конвертера и виджета «Курс валют» (см. ensureCurrencyRates).
let currencyCache: CurrencyRatesData | null = null

// Что уже лежит в кэше — для начального значения состояния: без него конвертер и виджет на
// первом кадре показывали бы «загружаю», хотя курсы уже есть. Геттер, а не экспорт самой
// переменной: живую привязку `let` читать снаружи можно, но тогда точек правки кэша становится
// две, и первая же «оптимизация» это сломает.
export function cachedCurrencyRates(): CurrencyRatesData | null {
  return currencyCache
}

// Единая точка получения курсов для конвертера и виджета: кэш → иначе IPC в main.
export async function ensureCurrencyRates(): Promise<{ data: CurrencyRatesData | null; error: string | null }> {
  if (currencyCache) return { data: currencyCache, error: null }
  const res = await window.aiPanel.currencyRates()
  if (res.ok && res.rates) {
    currencyCache = { date: res.date ?? '', rates: res.rates }
    return { data: currencyCache, error: null }
  }
  return { data: null, error: res.error ?? 'нет данных' }
}
