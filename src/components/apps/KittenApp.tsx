import { useState, useEffect } from 'react'

// ── Котёнок-тамагочи (основа будущего маскота) ───────────────────────────────────────────────
// Заложена структура под большой маскот с анимациями: персистентное состояние с офлайн-декеем
// (потребности убывают и пока браузер закрыт), настроение выводится из потребностей, реакции
// на действия — отдельные анимации (keyframes в global.css, мордочка пока эмодзи — заменится
// на рисованного кота без изменения логики).
interface KittenStats { food: number; water: number; fun: number; savedAt: number }
const KITTEN_KEY = 'aipanel-kitten'
// Скорость убывания: 1 пункт за N мс. Еда ~17ч от 100 до нуля, вода быстрее, скука быстрее всех.
const KITTEN_DECAY_MS = { food: 10 * 60_000, water: 8 * 60_000, fun: 6 * 60_000 } as const

const clampStat = (v: number): number => Math.max(0, Math.min(100, v))

// Пересчёт потребностей по прошедшему времени — одна и та же математика для офлайн-декея
// (загрузка) и живого тика (setInterval ниже).
function decayKitten(prev: KittenStats, now: number): KittenStats {
  const dt = Math.max(0, now - prev.savedAt)
  return {
    food: clampStat(prev.food - dt / KITTEN_DECAY_MS.food),
    water: clampStat(prev.water - dt / KITTEN_DECAY_MS.water),
    fun: clampStat(prev.fun - dt / KITTEN_DECAY_MS.fun),
    savedAt: now,
  }
}

function loadKittenStats(): KittenStats {
  try {
    const raw = localStorage.getItem(KITTEN_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<KittenStats>
      if (typeof p.food === 'number' && typeof p.water === 'number'
        && typeof p.fun === 'number' && typeof p.savedAt === 'number') {
        return decayKitten({ food: p.food, water: p.water, fun: p.fun, savedAt: p.savedAt }, Date.now())
      }
    }
  } catch { /* см. loadWallpaper */ }
  return { food: 80, water: 80, fun: 80, savedAt: Date.now() }
}
function saveKittenStats(s: KittenStats): void {
  try { localStorage.setItem(KITTEN_KEY, JSON.stringify(s)) } catch { /* см. loadWallpaper */ }
}

type KittenAction = 'feed' | 'drink' | 'play'

export default function KittenApp() {
  const [stats, setStats] = useState<KittenStats>(loadKittenStats)
  // Текущая реакция — на время анимации-прыжка мордочка меняется (см. face ниже).
  const [action, setAction] = useState<KittenAction | null>(null)

  // Живой тик раз в 30с — потребности убывают на глазах у открытого слота.
  useEffect(() => {
    const id = setInterval(() => setStats((prev) => decayKitten(prev, Date.now())), 30_000)
    return () => clearInterval(id)
  }, [])
  // Персист на каждое изменение — состояние переживает и закрытие слота, и рестарт браузера.
  useEffect(() => { saveKittenStats(stats) }, [stats])

  const act = (kind: KittenAction) => {
    setStats((prev) => {
      const now = decayKitten(prev, Date.now())
      if (kind === 'feed') now.food = clampStat(now.food + 30)
      if (kind === 'drink') now.water = clampStat(now.water + 30)
      if (kind === 'play') now.fun = clampStat(now.fun + 25)
      return now
    })
    setAction(kind)
    window.setTimeout(() => setAction((cur) => (cur === kind ? null : cur)), 900)
  }

  // Настроение — из самой просевшей потребности; реакция на действие приоритетнее.
  const low = Math.min(stats.food, stats.water, stats.fun)
  const face = action === 'feed' ? '😋'
    : action === 'drink' ? '😽'
      : action === 'play' ? '😸'
        : low < 25 ? '😿' : low < 55 ? '🐱' : '😺'
  const status = action !== null ? 'мур-мур!'
    : low >= 55 ? 'мурчит'
      : stats.food === low ? 'хочет есть'
        : stats.water === low ? 'хочет пить' : 'скучает'

  const bars: { label: string; value: number }[] = [
    { label: 'Еда', value: stats.food },
    { label: 'Вода', value: stats.water },
    { label: 'Игры', value: stats.fun },
  ]
  const actions: { kind: KittenAction; emoji: string; label: string }[] = [
    { kind: 'feed', emoji: '🍗', label: 'Покормить' },
    { kind: 'drink', emoji: '💧', label: 'Напоить' },
    { kind: 'play', emoji: '🧶', label: 'Поиграть' },
  ]

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 10, padding: 14,
    }}>
      <span style={{
        fontSize: 54, lineHeight: 1,
        animation: action !== null
          ? 'oblako-kitten-hop 0.5s ease'
          : 'oblako-kitten-idle 3s ease-in-out infinite',
      }}>
        {face}
      </span>
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{status}</span>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bars.map((b) => (
          <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
              {b.label}
            </span>
            <div style={{
              flex: 1, height: 5, borderRadius: 'var(--radius-pill)',
              background: 'var(--surface-sunken)', overflow: 'hidden',
            }}>
              <div style={{
                width: `${b.value}%`, height: '100%',
                // Просевшая потребность подсвечивается danger — системный сигнал «плохо».
                background: b.value < 25 ? 'var(--danger-500)' : 'var(--accent)',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {actions.map((a) => (
          <button
            key={a.kind}
            onClick={() => act(a.kind)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 'var(--radius-chip)', cursor: 'pointer',
              border: '1px solid var(--glass-edge)', background: 'var(--surface-sunken)',
              color: 'var(--text-body)', fontSize: 'var(--fs-xs)', fontWeight: 500,
            }}
          >
            <span>{a.emoji}</span> {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
