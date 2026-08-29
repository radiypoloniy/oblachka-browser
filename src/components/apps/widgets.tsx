import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { altitude, ALTITUDE, CAPS, DISPLAY, grain } from '../../styles/system'
import { WeatherIcon, wmoText, weatherSkin } from '../desktop/weather'
import { cachedCurrencyRates, ensureCurrencyRates, type CurrencyRatesData } from './currencyRates'
import type { WeatherResult } from './types'

// ── Виджеты домашнего экрана ─────────────────────────────────────────────────────────────────
// ⚠️ Высота 1 («туман»): карточки панели ВСЕГДА лежат поверх обоев хаба, а сплошная заливка
// поверх картинки читается заплаткой — тот же разбор, что у виджетов стола (см. altitude в
// src/styles/system.ts). До этой правки панель жила по старым правилам и в редизайн не входила
// вовсе — живая жалоба «панель с хабом наш редизайн как будто не трогает».
const widgetCardStyle: React.CSSProperties = {
  ...altitude(ALTITUDE.mist, { content: true }),
  padding: '10px 12px', flexShrink: 0,
}

/**
 * Плитка виджета панели.
 *
 * ⚠️ Тот же материал, что на столе: плоская краска плюс зерно. До этой правки виджеты панели
 * были стеклянными строками с эмодзи вместо значка — третий способ рисовать те же данные,
 * которые стол уже показывает капсой и дисплейной гарнитурой.
 */
export function PanelTile({ bg, ink, children }: {
  bg: string
  ink: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden', flexShrink: 0,
      padding: '10px 12px', borderRadius: 'var(--radius-card)',
      background: bg, color: ink,
      boxShadow: 'var(--shadow-card)',
    }}>
      <span aria-hidden style={grain} />
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  )
}

/** Подпись плитки — моноширинная капса, как на столе (TileCaption). */
export function PanelCaption({ children }: { children: React.ReactNode }) {
  return <div style={{ ...CAPS, color: 'inherit', opacity: 0.72 }}>{children}</div>
}

/** Ключевое число — дисплейной гарнитурой с табличными цифрами (TileValue). */
export function PanelValue({ children, size }: { children: React.ReactNode; size: number }) {
  return <span style={{ ...DISPLAY, fontSize: size, fontWeight: 600, lineHeight: 1 }}>{children}</span>
}

const fmtTemp = (t: number): string => `${t > 0 ? '+' : ''}${Math.round(t)}°`

export function WeatherWidget({ city }: { city: string }) {
  const [data, setData] = useState<WeatherResult | null>(null)
  // Инкремент — ручной повтор после ошибки (перезапускает effect с тем же городом).
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setData(null)
    const load = () => {
      window.aiPanel.weather(city).then((res) => { if (!cancelled) setData(res) })
    }
    load()
    // Панель живёт долго (не размонтируется при переключении в чат) — без периодического
    // обновления температура протухла бы навсегда. 15 мин = TTL кэша в main.
    const id = setInterval(load, 15 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [city, reloadKey])

  if (data === null) {
    return (
      <div style={widgetCardStyle}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
        }}>
          <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
          Погода…
        </span>
      </div>
    )
  }

  if (!data.ok) {
    return (
      <div style={{ ...widgetCardStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          Погода недоступна: {data.error}
        </span>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          style={{
            padding: '4px 10px', borderRadius: 'var(--radius-chip)', border: 'none',
            background: 'var(--surface-sunken)', color: 'var(--text-muted)',
            fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer', flexShrink: 0,
          }}
        >
          Повторить
        </button>
      </div>
    )
  }

  const code = data.weatherCode ?? 0
  // ⚠️ Время суток панели никто не присылает — берём его из самой погоды: ночью Open-Meteo
  // отдаёт коды с ночными значками, а для краски достаточно часа по месту.
  const hour = new Date().getHours()
  const isDay = hour >= 7 && hour <= 20
  const skin = weatherSkin(code, isDay)

  return (
    <PanelTile bg={skin.bg} ink={skin.ink}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PanelCaption>{data.city}</PanelCaption>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <PanelValue size={30}>{data.tempC !== undefined ? fmtTemp(data.tempC) : '—'}</PanelValue>
            <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.85, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {wmoText(code)}
              {data.windKmh !== undefined ? ` · ветер ${Math.round(data.windKmh)} км/ч` : ''}
            </span>
          </div>
        </div>
        <WeatherIcon code={code} day={isDay} size={40} />
      </div>
    </PanelTile>
  )
}

// Пары для виджета курсов — две самые ходовые, компактно (полный список — в конвертере).
const WIDGET_CURRENCIES: { code: string; sym: string }[] = [
  { code: 'USD', sym: '$' },
  { code: 'EUR', sym: '€' },
]

export function CurrencyWidget() {
  const [rates, setRates] = useState<CurrencyRatesData | null>(cachedCurrencyRates())
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setError(null)
    void ensureCurrencyRates().then(({ data, error: err }) => {
      if (data) setRates(data)
      else setError(err)
    })
  }
  // Курсы суточные — одного захода на маунт достаточно (main кэширует на час сам),
  // пустые deps намеренно.
  useEffect(() => {
    const cached = cachedCurrencyRates()
    if (cached) { setRates(cached); return }
    load()
  }, [])

  if (rates === null && error === null) {
    return (
      <div style={widgetCardStyle}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
        }}>
          <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
          Загружаю…
        </span>
      </div>
    )
  }

  if (error !== null) {
    return (
      <div style={{ ...widgetCardStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          Курсы недоступны: {error}
        </span>
        <button
          onClick={load}
          style={{
            padding: '4px 10px', borderRadius: 'var(--radius-chip)', border: 'none',
            background: 'var(--surface-sunken)', color: 'var(--text-muted)',
            fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer', flexShrink: 0,
          }}
        >
          Повторить
        </button>
      </div>
    )
  }

  // ⚠️ Бумага, а не краска: ярких плоскостей на экране и так хватает — обои плюс погода. То же
  // решение, что у плитки курсов на столе (там она идёт за темой, а не за цветом).
  return (
    <PanelTile bg="var(--wallpaper-paper)" ink="var(--on-poster-dark)">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <PanelCaption>Курс ЦБ</PanelCaption>
        <span style={{ flex: 1 }} />
        {rates !== null && rates.date !== '' && <PanelCaption>{rates.date}</PanelCaption>}
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 6, flexWrap: 'wrap' }}>
        {rates !== null && WIDGET_CURRENCIES.map(({ code, sym }) => {
          const value = rates.rates[code]
          if (value === undefined) return null
          return (
            <span key={code} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.7 }}>{sym}</span>
              <PanelValue size={22}>{value.toFixed(2).replace('.', ',')}</PanelValue>
            </span>
          )
        })}
      </div>
    </PanelTile>
  )
}
