import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X, Search } from 'lucide-react'
import { DISPLAY, RADIUS, TEXT, motion, pad, sp } from '../styles/system'
import { searchTimeZones, zoneAbbrev, zoneCity } from '../../shared/timeZones'

// Приложение «Пояса»: сколько времени у собеседника и когда ему удобно.
//
// ⚠️ БЕЗ СЕТИ. Сайты-конвертеры поясов выглядят как источник данных, но данных там нет: перевод
// времени — это вычисление, и вся база поясов (400+) лежит в ICU прямо в Chromium. Поэтому
// приложение работает офлайн, не знает промахов и не устареет вместе с чужим сайтом.
//
// ⚠️ Главное здесь не «который час», а ПОЛЗУНОК. Час текущий человек и так знает; вопрос,
// ради которого открывают такой конвертер, всегда один — «если я позвоню в 18:00, сколько
// у него будет и не ночь ли это». Отсюда две вещи, которых нет у обычных мировых часов:
// сдвиг времени и полоса суток, на которой ночь видна глазом, а не вычитанием в уме.

const STORE_KEY = 'oblako-zones-app'

/** Предел сдвига в каждую сторону, минут. Сутки вперёд и назад закрывают все живые случаи. */
const SHIFT_MAX = 24 * 60
const SHIFT_STEP = 15

/** Рабочий день — по нему красится полоса суток. */
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

/** Части времени в поясе. ⚠️ Через formatToParts, а не парсингом строки: формат зависит от локали. */
function partsIn(zone: string, at: Date): { h: number; m: number; day: number; month: number; weekday: string } {
  try {
    const fmt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false,
      day: 'numeric', month: 'short', weekday: 'short',
    })
    const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]))
    return {
      h: Number(p.hour ?? 0),
      m: Number(p.minute ?? 0),
      day: Number(p.day ?? 0),
      month: 0,
      weekday: String(p.weekday ?? ''),
    }
  } catch {
    return { h: 0, m: 0, day: 0, month: 0, weekday: '' }
  }
}

function dateLabel(zone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: zone, day: 'numeric', month: 'short' }).format(at)
  } catch {
    return ''
  }
}

/**
 * Смещение пояса относительно другого, в минутах.
 *
 * ⚠️ Считается через сравнение отформатированных дат, а не по таблице сдвигов: летнее время,
 * получасовые пояса (Индия) и сорокапятиминутные (Непал) иначе дают ложь ровно тогда, когда
 * человек и полез проверять.
 */
function offsetMinutes(zone: string, base: string, at: Date): number {
  const val = (tz: string): number => {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }).formatToParts(at).map((x) => [x.type, x.value]))
      return Date.UTC(
        Number(p.year), Number(p.month) - 1, Number(p.day),
        Number(p.hour) % 24, Number(p.minute),
      )
    } catch {
      return 0
    }
  }
  return Math.round((val(zone) - val(base)) / 60_000)
}

function fmtOffset(min: number): string {
  if (min === 0) return 'как у вас'
  const sign = min > 0 ? '+' : '−'
  const abs = Math.abs(min)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''} ч`
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
  const [shift, setShift] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const home = useMemo(() => localZone(), [])

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rows)) } catch { /* квота */ }
  }, [rows])

  // ⚠️ Тик раз в 15 секунд, а не в секунду: секунд на плитках нет, а лишние перерисовки на
  // домашнем экране панели стоят дороже точности, которой не видно.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => { if (adding) searchRef.current?.focus() }, [adding])

  const at = useMemo(() => new Date(now + shift * 60_000), [now, shift])
  const zones = useMemo(() => allZones(), [])
  // ⚠️ Поиск идёт через shared/timeZones: люди пишут EDT, МСК, «Нью-Йорк», а таких строк
  // в списке ICU нет вовсе — живой случай, с которого началась эта правка.
  const found = useMemo(
    () => searchTimeZones(query, zones, rows.map((r) => r.id)),
    [zones, rows, query],
  )

  const homeParts = partsIn(home, at)

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* ── Ползунок времени ─────────────────────────────────────────────────
          ⚠️ Он ведущий, а не вспомогательный: ради «а если в 18:00?» приложение и открывают.
          Поэтому он вверху и всегда на виду, а не спрятан под кнопкой. */}
      <div style={{
        flex: 'none', padding: pad(3, 4), display: 'flex', flexDirection: 'column', gap: sp(2),
        borderBottom: '1px solid var(--divider)',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: sp(2) }}>
          <span style={{ ...TEXT.caption, flex: 1 }}>
            {shift === 0 ? 'Сейчас' : `${shift > 0 ? 'через' : ''} ${fmtShift(shift)}`}
          </span>
          <span style={{
            ...DISPLAY, fontSize: 20, fontWeight: 600, color: 'var(--text-strong)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {String(homeParts.h).padStart(2, '0')}:{String(homeParts.m).padStart(2, '0')}
          </span>
          {shift !== 0 && (
            <button
              onClick={() => setShift(0)}
              style={{
                ...TEXT.caption, padding: pad(1, 2), cursor: 'pointer', borderRadius: RADIUS.pill,
                border: '1px solid var(--divider-strong)', background: 'transparent',
                color: 'var(--text-body)', transition: motion.hover('background', 'color'),
              }}
            >Сейчас</button>
          )}
        </div>
        <input
          type="range"
          min={-SHIFT_MAX}
          max={SHIFT_MAX}
          step={SHIFT_STEP}
          value={shift}
          onChange={(e) => setShift(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
        />
      </div>

      {/* ── Ряды поясов ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: pad(3, 4), display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        {rows.map((row) => (
          <ZoneCard
            key={row.id}
            row={row}
            at={at}
            home={home}
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
                    border: '1px solid var(--divider)', background: 'var(--surface-sunken)',
                    color: 'var(--text-body)', transition: motion.hover('background', 'color'),
                  }}
                >{zoneCity(z)}{zoneAbbrev(z) ? ` · ${zoneAbbrev(z)}` : ''}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function fmtShift(min: number): string {
  const abs = Math.abs(min)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  const body = h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`
  return min > 0 ? body : `${body} назад`
}

function ZoneCard({ row, at, home, onRemove }: {
  row: ZoneRow; at: Date; home: string; onRemove?: () => void
}) {
  const p = partsIn(row.id, at)
  const off = offsetMinutes(row.id, home, at)
  const hereDay = dateLabel(home, at)
  const thereDay = dateLabel(row.id, at)
  const night = p.h < 7 || p.h >= 22
  // ⚠️ Ярлык живой: зимой EST, летом EDT. Он есть не у всех поясов — у Москвы Intl отдаёт
  // «GMT+3», а это то же самое, что уже посчитанное смещение рядом.
  const abbr = zoneAbbrev(row.id, at)
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: sp(2), padding: pad(3),
      borderRadius: RADIUS.box, background: 'var(--surface-sunken)',
      border: '1px solid var(--divider)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: sp(2) }}>
        <span style={{
          ...TEXT.body, fontWeight: 600, color: 'var(--text-strong)',
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{row.label || zoneCity(row.id)}</span>
        <span style={{ ...TEXT.caption, flex: 1 }}>
          {abbr ? `${abbr} · ` : ''}{fmtOffset(off)}
        </span>
        {/* ⚠️ Другой день — самое частое, на чём ошибаются вручную: показываем словом, а не
            предлагаем человеку заметить это самому. */}
        {thereDay !== hereDay && <span style={{ ...TEXT.caption }}>{thereDay}</span>}
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

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: sp(3) }}>
        <span style={{
          ...DISPLAY, fontSize: 34, fontWeight: 600, letterSpacing: '-0.03em',
          color: 'var(--text-strong)', fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}>
          {String(p.h).padStart(2, '0')}:{String(p.m).padStart(2, '0')}
        </span>
        <span style={{ ...TEXT.caption, paddingBottom: 2 }}>
          {p.weekday}{night ? ' · ночь' : ''}
        </span>
      </div>

      <DayStrip hour={p.h} />
    </div>
  )
}

/**
 * Полоса суток: 24 деления, рабочие часы выделены, текущий час — акцентом.
 *
 * ⚠️ Ради неё половина конструкции и затевалась. «12:40 в Нью-Йорке» человек всё равно
 * переводит в вопрос «он спит или нет», и полоса отвечает на него глазом, без арифметики.
 */
function DayStrip({ hour }: { hour: number }) {
  return (
    <div style={{ display: 'flex', gap: 2, height: 10 }}>
      {Array.from({ length: 24 }, (_, h) => {
        const work = h >= WORK_FROM && h < WORK_TO
        const on = h === hour
        return (
          <span
            key={h}
            title={`${String(h).padStart(2, '0')}:00`}
            style={{
              // RADIUS.tight — ступень шкалы ровно для этого: индикатор внутри контрола.
              flex: 1, borderRadius: RADIUS.tight,
              background: on ? 'var(--accent)' : work ? 'var(--accent-soft)' : 'var(--divider)',
              opacity: on ? 1 : work ? 1 : 0.5,
              transition: motion.hover('background', 'opacity'),
            }}
          />
        )
      })}
    </div>
  )
}
