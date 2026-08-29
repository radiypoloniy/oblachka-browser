import { useState, useEffect } from 'react'
import { ArrowDownUp, Loader2 } from 'lucide-react'

// ── Конвертер: валюты + офлайн-единицы ───────────────────────────────────────────────────────
// Валюты — главная категория (дефолтная): живые курсы ЦБ приходят из main по
// ai-panel:currency-rates (см. electron/CurrencyRates.ts — там же почему fetch не отсюда).
// Остальные категории полностью офлайн.
interface ConvUnit { id: string; label: string; factor: number }
interface ConvCategory { id: string; label: string; units: ConvUnit[] }

const CONVERT_CATEGORIES: ConvCategory[] = [
  {
    id: 'length', label: 'Длина', units: [
      { id: 'mm', label: 'мм', factor: 0.001 },
      { id: 'cm', label: 'см', factor: 0.01 },
      { id: 'm', label: 'м', factor: 1 },
      { id: 'km', label: 'км', factor: 1000 },
      { id: 'in', label: 'дюйм', factor: 0.0254 },
      { id: 'ft', label: 'фут', factor: 0.3048 },
      { id: 'mi', label: 'миля', factor: 1609.344 },
    ],
  },
  {
    id: 'mass', label: 'Масса', units: [
      { id: 'g', label: 'г', factor: 0.001 },
      { id: 'kg', label: 'кг', factor: 1 },
      { id: 't', label: 'т', factor: 1000 },
      { id: 'oz', label: 'унция', factor: 0.0283495 },
      { id: 'lb', label: 'фунт', factor: 0.453592 },
    ],
  },
  {
    // factor у температур не используется (нелинейная шкала — см. convertValue), но поле
    // обязательно по типу; 1 — заглушка.
    id: 'temp', label: 'Темп.', units: [
      { id: 'c', label: '°C', factor: 1 },
      { id: 'f', label: '°F', factor: 1 },
      { id: 'k', label: 'K', factor: 1 },
    ],
  },
  {
    id: 'data', label: 'Данные', units: [
      { id: 'kb', label: 'КБ', factor: 1 },
      { id: 'mb', label: 'МБ', factor: 1024 },
      { id: 'gb', label: 'ГБ', factor: 1024 * 1024 },
      { id: 'tb', label: 'ТБ', factor: 1024 * 1024 * 1024 },
    ],
  },
]

// Порядок валют в селектах — ходовые сверху; фильтруется по фактически пришедшим курсам.
// factor = RUB за единицу (base — рубль), та же линейная схема, что у остальных категорий.
import { cachedCurrencyRates, ensureCurrencyRates, type CurrencyRatesData } from './currencyRates'

const CURRENCY_ORDER = ['USD', 'EUR', 'RUB', 'CNY', 'GBP', 'JPY', 'CHF', 'TRY', 'KZT', 'BYN', 'AED', 'INR']

// Табы категорий: «Валюты» строятся динамически из курсов, офлайн-категории — статика выше.
const CATEGORY_TABS: { id: string; label: string }[] = [
  { id: 'currency', label: 'Валюты' },
  ...CONVERT_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
]

function convertValue(cat: ConvCategory, from: ConvUnit, to: ConvUnit, v: number): number {
  if (cat.id === 'temp') {
    const c = from.id === 'f' ? (v - 32) * 5 / 9 : from.id === 'k' ? v - 273.15 : v
    return to.id === 'f' ? c * 9 / 5 + 32 : to.id === 'k' ? c + 273.15 : c
  }
  return v * from.factor / to.factor
}

const fmtConvert = (n: number): string => parseFloat(n.toPrecision(9)).toString().replace('.', ',')

// Общий стиль «утопленных» полей конвертера (инпут/селекты/результат) — единый вид ряда.
const convFieldStyle: React.CSSProperties = {
  border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 10px',
  background: 'var(--surface-sunken)', color: 'var(--text-strong)',
  fontSize: 'var(--fs-md)', fontFamily: 'var(--font-sans)', outline: 'none',
}

export default function ConverterApp() {
  // Валюты — дефолт: ради них конвертер и затевался, доллар→рубль как самая ходовая пара.
  const [catId, setCatId] = useState('currency')
  const [fromId, setFromId] = useState('USD')
  const [toId, setToId] = useState('RUB')
  const [raw, setRaw] = useState('')
  const [currency, setCurrency] = useState<CurrencyRatesData | null>(cachedCurrencyRates())
  const [currencyError, setCurrencyError] = useState<string | null>(null)

  const loadCurrency = () => {
    setCurrencyError(null)
    void ensureCurrencyRates().then(({ data, error }) => {
      if (data) setCurrency(data)
      else setCurrencyError(error)
    })
  }
  // Лениво — на первый заход в «Валюты» (а это дефолтная категория, т.е. обычно сразу).
  useEffect(() => {
    if (catId === 'currency' && currency === null && currencyError === null) loadCurrency()
  }, [catId, currency, currencyError])

  const cat: ConvCategory = catId === 'currency'
    ? {
        id: 'currency', label: 'Валюты',
        units: currency
          ? CURRENCY_ORDER.filter((c) => currency.rates[c] !== undefined)
              .map((c) => ({ id: c, label: c, factor: currency.rates[c] }))
          : [], // курсы ещё не пришли/ошибка — вместо рядов рисуется статус ниже
      }
    : CONVERT_CATEGORIES.find((c) => c.id === catId) ?? CONVERT_CATEGORIES[0]
  // ?? — страховка от рассинхрона fromId/toId при смене категории (switchCat ставит дефолты,
  // но fallback дешевле, чем полагаться на порядок setState).
  const from = cat.units.find((u) => u.id === fromId) ?? cat.units[0]
  const to = cat.units.find((u) => u.id === toId) ?? cat.units[1]

  const switchCat = (id: string) => {
    setCatId(id)
    if (id === 'currency') { setFromId('USD'); setToId('RUB'); return }
    const c = CONVERT_CATEGORIES.find((x) => x.id === id)
    if (c) { setFromId(c.units[0].id); setToId(c.units[1].id) }
  }
  const swap = () => { setFromId(to.id); setToId(from.id) }

  const parsed = Number(raw.trim().replace(',', '.'))
  const result = raw.trim() === '' || isNaN(parsed) ? '' : fmtConvert(convertValue(cat, from, to, parsed))

  const tabs = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {CATEGORY_TABS.map((c) => {
        const active = c.id === catId
        return (
          <button
            key={c.id}
            onClick={() => switchCat(c.id)}
            style={{
              padding: '4px 10px', borderRadius: 'var(--radius-chip)', cursor: 'pointer',
              border: active ? '1px solid var(--accent)' : '1px solid var(--glass-edge)',
              background: active ? 'var(--accent-soft)' : 'var(--surface-sunken)',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: 'var(--fs-xs)', fontWeight: 500,
            }}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )

  // Валюты без курсов: загрузка или ошибка с повтором — рядов конвертации ещё нет.
  if (cat.units.length < 2) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
        {tabs}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 8, textAlign: 'center',
        }}>
          {currencyError ? (
            <>
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
                Не удалось загрузить курсы: {currencyError}
              </span>
              <button
                onClick={loadCurrency}
                style={{
                  padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                  background: 'var(--accent)', color: 'var(--text-on-accent)',
                  fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Повторить
              </button>
            </>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
            }}>
              <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
              Загружаю курсы ЦБ…
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
      {tabs}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="0"
          inputMode="decimal"
          style={{ ...convFieldStyle, flex: 1, minWidth: 0 }}
        />
        <select
          value={from.id}
          onChange={(e) => setFromId(e.target.value)}
          style={{ ...convFieldStyle, width: 88, flexShrink: 0, padding: '8px 6px', fontSize: 'var(--fs-sm)' }}
        >
          {cat.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </div>
      <button
        onClick={swap}
        title="Поменять местами"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
          width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--glass-edge)',
          background: 'var(--surface-sunken)', color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
        }}
      >
        <ArrowDownUp size={14} />
      </button>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{
          ...convFieldStyle, flex: 1, minWidth: 0,
          color: result ? 'var(--text-strong)' : 'var(--text-faint)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {result || '—'}
        </div>
        <select
          value={to.id}
          onChange={(e) => setToId(e.target.value)}
          style={{ ...convFieldStyle, width: 88, flexShrink: 0, padding: '8px 6px', fontSize: 'var(--fs-sm)' }}
        >
          {cat.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </div>
      {catId === 'currency' && currency !== null && currency.date !== '' && (
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', textAlign: 'center' }}>
          Курсы ЦБ РФ · {currency.date}
        </span>
      )}
    </div>
  )
}
