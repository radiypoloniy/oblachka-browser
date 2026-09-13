import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Plus, X, Search } from 'lucide-react'
import { DISPLAY, RADIUS, TEXT, card, motion, pad, sp } from '../styles/system'
import { searchTimeZones, zoneAbbrev, zoneCity } from '../../shared/timeZones'
import {
  DAY_MAX_MINUTES, DAY_MINUTES, formatClock, formatOffset, hmFromMinutes, instantWithClock,
  maskClockInput, minutesOfDay, offsetMinutes, parseClock, snapClockMinutes, wallParts,
} from '../../shared/civilTime'

// Приложение «Пояса»: сколько времени у собеседника и когда ему удобно.
//
// ⚠️ БЕЗ СЕТИ. Сайты-конвертеры поясов выглядят как источник данных, но данных там нет: перевод
// времени — это вычисление, и вся база поясов (400+) лежит в ICU прямо в Chromium.
//
// ⚠️ Вопрос не «который час», а «если у меня 18:45, сколько у него и не ночь ли». Поэтому
// шкала 0…24 живёт В РЯДУ пояса, а не отдельным сдвигом от сейчас: тащишь любые сутки, остальные
// едут за тем же моментом. «Сейчас» возвращает живые часы.
//
// ⚠️ Край шкалы не переносит дату: 24:00 на полосе — 23:45 этого дня. Иначе курсор, зажатый
// справа, крутит сутки (сентябрь уезжал в декабрь, и летнее EDT становилось зимним EST).

const STORE_KEY = 'oblako-zones-app'
const HOUR_KEY = 'oblako-zones-hour12'
const WORK_FROM = 9
const WORK_TO = 18

interface ZoneRow {
  id: string
  /** Подпись, которую задал человек. Пусто — берём последний кусок идентификатора. */
  label?: string
}

/** Список поясов из ICU. ⚠️ supportedValuesOf есть не везде — без него остаётся ручной ввод. */
function allZones(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    return typeof f === 'function' ? f('timeZone') : []
  } catch {
    return []
  }
}

function localZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

function dateLabel(zone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: zone, day: 'numeric', month: 'short' }).format(at)
  } catch {
    return ''
  }
}

function weekdayLabel(zone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: zone, weekday: 'short' }).format(at)
  } catch {
    return ''
  }
}

function loadHour12(): boolean {
  try { return localStorage.getItem(HOUR_KEY) === '1' } catch { return false }
}

function loadZones(): ZoneRow[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) {
      const rows = parsed
        .filter((x): x is ZoneRow => !!x && typeof x === 'object' && typeof (x as ZoneRow).id === 'string')
        .slice(0, 8)
      if (rows.length) return rows
    }
  } catch { /* см. loadWallpaper в aiApps */ }
  // Первый заход: свой пояс и две самые ходовые точки на другом конце дня.
  const home = localZone()
  const seed = [home, 'Europe/Moscow', 'America/New_York'].filter((z, i, a) => a.indexOf(z) === i)
  return seed.slice(0, 3).map((id) => ({ id }))
}

export default function ZonesApp() {
  const [rows, setRows] = useState<ZoneRow[]>(loadZones)
  const [live, setLive] = useState(true)
  const [instant, setInstant] = useState(() => Date.now())
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | 'all' | null>(null)
  const [hour12, setHour12] = useState(loadHour12)
  const searchRef = useRef<HTMLInputElement>(null)
  const copiedTimer = useRef<number | null>(null)

  const home = useMemo(() => localZone(), [])

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rows)) } catch { /* квота */ }
  }, [rows])
  useEffect(() => {
    try { localStorage.setItem(HOUR_KEY, hour12 ? '1' : '0') } catch { /* квота */ }
  }, [hour12])

  // ⚠️ Тик раз в 15 секунд, а не в секунду: секунд на плитках нет, а лишние перерисовки на
  // домашнем экране панели стоят дороже точности, которой не видно. Замороженный момент не тикаем.
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => setInstant(Date.now()), 15_000)
    return () => window.clearInterval(t)
  }, [live])

  useEffect(() => { if (adding) searchRef.current?.focus() }, [adding])
  useEffect(() => () => { if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current) }, [])

  const at = useMemo(() => new Date(instant), [instant])
  const zones = useMemo(() => allZones(), [])
  const found = useMemo(
    () => searchTimeZones(query, zones, rows.map((r) => r.id)),
    [zones, rows, query],
  )

  const goLive = (): void => {
    setLive(true)
    setInstant(Date.now())
  }

  const setClock = (zone: string, h: number, m: number): void => {
    setLive(false)
    setInstant((prev) => instantWithClock(zone, prev, h, m))
  }

  const markCopied = (key: string | 'all'): void => {
    setCopied(key)
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1200)
  }

  const copyText = (text: string, key: string | 'all'): void => {
    void navigator.clipboard.writeText(text).then(
      () => markCopied(key),
      () => { /* буфер недоступен — подпись не подтвердит */ },
    )
  }

  const copyAll = (): void => {
    const text = rows.map((row) => {
      const p = wallParts(row.id, at)
      return `${formatClock(p.h, p.m, hour12)} ${row.label || zoneCity(row.id)}`
    }).join(' · ')
    copyText(text, 'all')
  }

  const homeDay = dateLabel(home, at)
  const crossedDays = rows.some((row) => dateLabel(row.id, at) !== homeDay)

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <ZonesChrome hour12={hour12} live={live} onHour12={setHour12} onLive={goLive} />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: pad(2, 4), display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        {rows.map((row) => (
          <ZoneCard
            key={row.id}
            row={row}
            at={at}
            home={home}
            copied={copied === row.id}
            hour12={hour12}
            showDate={crossedDays}
            onClock={(h, m) => setClock(row.id, h, m)}
            onCopy={(text) => copyText(text, row.id)}
            onRemove={rows.length > 1 ? () => setRows(rows.filter((r) => r.id !== row.id)) : undefined}
          />
        ))}

        {!adding && rows.length < 8 && (
          <button
            onClick={() => { setAdding(true); setQuery('') }}
            style={{
              ...TEXT.body, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              gap: sp(2), padding: pad(2, 3), cursor: 'pointer', borderRadius: RADIUS.control,
              border: '1px dashed var(--divider-strong)', background: 'transparent',
              color: 'var(--text-muted)', transition: motion.hover('background', 'color'),
            }}
          ><Plus size={14} /> Добавить пояс</button>
        )}

        {adding && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: sp(2), padding: pad(2, 3),
              borderRadius: RADIUS.control, border: '1px solid var(--divider-strong)',
              background: 'var(--surface)',
            }}>
              <Search size={14} style={{ color: 'var(--text-faint)', flex: 'none' }} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false) }}
                placeholder="EDT, МСК, Нью-Йорк, tokyo…"
                style={{
                  ...TEXT.body, flex: 1, minWidth: 0, border: 'none', outline: 'none',
                  background: 'transparent', color: 'var(--text-strong)', fontFamily: 'inherit',
                }}
              />
              <button
                onClick={() => setAdding(false)}
                title="Отмена"
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                  color: 'var(--text-faint)', display: 'inline-flex',
                }}
              ><X size={14} /></button>
            </div>
            {zones.length === 0 && (
              <span style={{ ...TEXT.caption }}>Список поясов недоступен в этой сборке</span>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(1), maxHeight: 180, overflowY: 'auto' }}>
              {found.map((z) => (
                <button
                  key={z}
                  onClick={() => { setRows([...rows, { id: z }]); setAdding(false) }}
                  style={{
                    ...TEXT.caption, padding: pad(1, 2), cursor: 'pointer', borderRadius: RADIUS.pill,
                    border: '1px solid var(--accent-soft-border)', background: 'var(--card)',
                    color: 'var(--text-body)', transition: motion.hover('background', 'color'),
                  }}
                >{zoneCity(z)}{zoneAbbrev(z) ? ` · ${zoneAbbrev(z)}` : ''}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{
        flex: 'none', padding: pad(2, 4), borderTop: '1px solid var(--divider)',
      }}>
        <button
          onClick={copyAll}
          style={{
            ...TEXT.body, fontWeight: 600, width: '100%', padding: pad(2, 3), cursor: 'pointer',
            borderRadius: RADIUS.control, border: 'none',
            background: copied === 'all' ? 'var(--accent-soft)' : 'var(--card)',
            color: copied === 'all' ? 'var(--text-strong)' : 'var(--text-body)',
            transition: motion.hover('background', 'color'),
          }}
        >{copied === 'all' ? 'Скопировано' : 'Скопировать все'}</button>
      </div>
    </div>
  )
}

function ZonesChrome({ hour12, live, onHour12, onLive }: {
  hour12: boolean
  live: boolean
  onHour12: (v: boolean) => void
  onLive: () => void
}) {
  const chip = (active: boolean): CSSProperties => ({
    ...TEXT.caption, fontWeight: 600, padding: pad(1, 2), cursor: 'pointer',
    borderRadius: RADIUS.pill, border: 'none',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--on-accent)' : 'var(--text-muted)',
  })
  return (
    <div style={{
      flex: 'none', padding: pad(2, 4), display: 'flex', alignItems: 'center', gap: sp(2),
      borderBottom: '1px solid var(--divider)',
    }}>
      <div style={{
        display: 'flex', gap: sp(1), padding: sp(1), borderRadius: RADIUS.pill,
        background: 'var(--accent-soft)',
      }}>
        <button type="button" aria-pressed={!hour12} onClick={() => onHour12(false)} style={chip(!hour12)}>24</button>
        <button type="button" aria-pressed={hour12} onClick={() => onHour12(true)} style={chip(hour12)}>12</button>
      </div>
      <button
        onClick={onLive}
        aria-pressed={live}
        style={{
          ...TEXT.caption, fontWeight: 600, padding: pad(1, 3), cursor: 'pointer', marginLeft: 'auto',
          borderRadius: RADIUS.pill,
          border: live ? '1px solid transparent' : '1px solid var(--divider-strong)',
          background: live ? 'var(--accent)' : 'transparent',
          color: live ? 'var(--on-accent)' : 'var(--text-body)',
          transition: motion.hover('background', 'color'),
        }}
      >Сейчас</button>
    </div>
  )
}

function ZoneCard({ row, at, home, copied, hour12, showDate, onClock, onCopy, onRemove }: {
  row: ZoneRow
  at: Date
  home: string
  copied: boolean
  hour12: boolean
  showDate: boolean
  onClock: (h: number, m: number) => void
  onCopy: (text: string) => void
  onRemove?: () => void
}) {
  const p = wallParts(row.id, at)
  const off = offsetMinutes(row.id, home, at)
  const thereDay = dateLabel(row.id, at)
  const night = p.h < 7 || p.h >= 22
  const abbr = zoneAbbrev(row.id, at)
  const clock = formatClock(p.h, p.m, hour12)
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? clock
  const meta = [
    abbr,
    formatOffset(off),
    night ? 'ночь' : '',
    copied ? 'скопировано' : '',
  ].filter(Boolean).join(' · ')

  return (
    <div style={{
      ...card(),
      display: 'flex', flexDirection: 'column', gap: sp(2), padding: pad(3),
      borderRadius: RADIUS.box,
      border: '1px solid var(--accent-soft-border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            ...TEXT.body, fontWeight: 600, color: 'var(--text-strong)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{row.label || zoneCity(row.id)}</div>
          <div style={{ ...TEXT.caption }}>{meta}</div>
        </div>
        {/* ⚠️ День стоит под часами, не в подписи слева: иначе 00:00 и 17:00 читаются
            как 17 часов разницы, хотя это полночь понедельника и воскресенье −7 ч. */}
        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <input
            value={shown}
            maxLength={hour12 ? 8 : 5}
            inputMode={hour12 ? 'text' : 'numeric'}
            spellCheck={false}
            aria-label={`Время ${row.label || zoneCity(row.id)}`}
            onClick={(e) => {
              e.currentTarget.select()
              onCopy(clock)
            }}
            onChange={(e) => setDraft((prev) => maskClockInput(e.target.value, prev ?? clock))}
            onBlur={() => {
              if (draft === null) return
              const parsed = parseClock(draft)
              setDraft(null)
              if (parsed) onClock(parsed.h, parsed.m)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            style={{
              ...DISPLAY, ...TEXT.title, lineHeight: 1, textAlign: 'right',
              width: hour12 ? '8.5ch' : '5.2ch',
              border: 'none', background: 'transparent', padding: 0, outline: 'none',
              caretColor: 'var(--accent)',
            }}
          />
          <span style={{
            ...TEXT.caption,
            color: showDate ? 'var(--text-strong)' : 'var(--text-faint)',
          }}>
            {weekdayLabel(row.id, at)}{showDate ? ` · ${thereDay}` : ''}
          </span>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            title="Убрать"
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
              color: 'var(--text-faint)', display: 'inline-flex', flex: 'none',
            }}
          ><X size={13} /></button>
        )}
      </div>

      <DayStrip
        minutes={minutesOfDay(p.h, p.m)}
        hour12={hour12}
        onScrub={(min) => {
          const hm = hmFromMinutes(min)
          onClock(hm.h, hm.m)
        }}
      />
    </div>
  )
}

/**
 * Полоса суток — единственный ползунок. 0…24, шаг 15 минут.
 *
 * ⚠️ Не 24 серых столбика: это и был «колодец». Дорожка — чернила палитры, рабочие часы —
 * мягкий акцент, бегунок — капсула с кромкой карточки, чтобы читалась на любой земле.
 *
 * ⚠️ Правый край УПИРАЕТСЯ, а не переносит сутки. 24:00 на шкале — 23:45 этого дня: иначе
 * зажатый курсор накручивает даты (сентябрь уезжал в декабрь, летнее EDT становилось EST).
 */
function DayStrip({ minutes, hour12, onScrub }: {
  minutes: number
  hour12: boolean
  onScrub: (min: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const read = (clientX: number): number => {
    const el = ref.current
    if (!el) return minutes
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max(clientX - r.left, 0), r.width)
    return snapClockMinutes((x / Math.max(r.width, 1)) * DAY_MINUTES)
  }

  const labels = hour12 ? ['12am', '6', '12pm', '6', '12am'] : ['0', '6', '12', '18', '24']
  const workLeft = `${(WORK_FROM / 24) * 100}%`
  const workWidth = `${((WORK_TO - WORK_FROM) / 24) * 100}%`

  return (
    <div>
      <div
        ref={ref}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={DAY_MAX_MINUTES}
        aria-valuenow={minutes}
        aria-label="Сутки"
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          onScrub(read(e.clientX))
        }}
        onPointerMove={(e) => { if (dragging.current) onScrub(read(e.clientX)) }}
        onPointerUp={() => { dragging.current = false }}
        onPointerCancel={() => { dragging.current = false }}
        style={{
          position: 'relative', height: sp(8), borderRadius: RADIUS.pill,
          cursor: 'pointer', touchAction: 'none', userSelect: 'none',
          background: 'color-mix(in srgb, var(--text-faint) 16%, transparent)',
        }}
      >
        <span
          aria-hidden
          title={`${formatClock(WORK_FROM, 0, hour12)}–${formatClock(WORK_TO, 0, hour12)}`}
          style={{
            position: 'absolute', top: 0, bottom: 0, left: workLeft, width: workWidth,
            background: 'var(--accent-soft)', borderRadius: RADIUS.pill, pointerEvents: 'none',
          }}
        />
        <span
          aria-hidden
          style={{
            position: 'absolute', top: sp(1), bottom: sp(1), width: sp(3),
            left: `${(minutes / DAY_MINUTES) * 100}%`,
            transform: 'translateX(-50%)',
            background: 'var(--accent)', borderRadius: RADIUS.pill, pointerEvents: 'none',
            boxShadow: '0 0 0 3px var(--card), 0 1px 6px color-mix(in srgb, var(--accent) 35%, transparent)',
          }}
        />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: sp(1),
        ...TEXT.caption, color: 'var(--text-faint)',
      }}>
        {labels.map((lab, i) => <span key={i}>{lab}</span>)}
      </div>
    </div>
  )
}
