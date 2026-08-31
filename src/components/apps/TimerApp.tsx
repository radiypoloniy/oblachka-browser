import { useState, useEffect, useRef } from 'react'
import { Play, Pause, RotateCcw } from 'lucide-react'
import { timerResume } from '../../newtab/timerStore'

// ── Таймер ───────────────────────────────────────────────────────────────────────────────────
const TIMER_PRESETS_MIN = [1, 3, 5, 10, 15, 30]

const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// Короткий тройной сигнал через WebAudio-осциллятор — без аудио-ассета в бандле.
function timerBeep() {
  try {
    const ctx = new AudioContext()
    const offsets = [0, 0.28, 0.56]
    for (const t of offsets) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t)
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.22)
      osc.start(ctx.currentTime + t)
      osc.stop(ctx.currentTime + t + 0.24)
    }
    setTimeout(() => { void ctx.close() }, 1200)
  } catch { /* нет аудио-выхода — таймер отработает молча, «Время вышло» видно и так */ }
}

export default function TimerApp() {
  const [duration, setDuration] = useState(5 * 60)
  const [remaining, setRemaining] = useState(5 * 60)
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  // Остаток считается от целевого timestamp'а, а не декрементом в setInterval: скрытая панель
  // (закрыли/переключились в чат) может троттлить таймеры Chromium — по возврату время всё
  // равно окажется честным.
  const endAtRef = useRef(0)

  useEffect(() => {
    if (!running) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000))
      setRemaining(left)
      if (left === 0) {
        setRunning(false)
        setFinished(true)
        timerBeep()
      }
    }
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [running])

  // ⚠️ Досчитавший таймер запускается ЗАНОВО на всю длительность. Раньше здесь стояло
  // `if (remaining === 0) return`, то есть после срабатывания кнопка «пуск» молча не делала
  // ничего, и поставить тот же срок ещё раз было нельзя — только пересобрать через пресет.
  // Состояние «досчитал» — это не «нечего считать», а «готов пойти заново» (см. timerResume).
  const start = () => {
    const secs = timerResume(remaining, duration)
    if (secs <= 0) return
    endAtRef.current = Date.now() + secs * 1000
    setRemaining(secs)
    setFinished(false)
    setRunning(true)
  }
  const pause = () => {
    setRunning(false)
    setRemaining(Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000)))
  }
  const reset = () => { setRunning(false); setFinished(false); setRemaining(duration) }
  const pick = (sec: number) => {
    setDuration(sec)
    setRemaining(sec)
    setRunning(false)
    setFinished(false)
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 12, padding: 14,
    }}>
      <div style={{
        fontSize: 40, fontWeight: 200, lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        color: finished ? 'var(--accent)' : 'var(--text-strong)',
      }}>
        {fmtTime(remaining)}
      </div>
      {finished && (
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--accent)' }}>
          Время вышло
        </span>
      )}
      <div style={{
        width: '80%', height: 4, borderRadius: 'var(--radius-pill)',
        background: 'var(--surface-sunken)', overflow: 'hidden',
      }}>
        <div style={{
          width: `${duration > 0 ? (remaining / duration) * 100 : 0}%`, height: '100%',
          background: 'var(--accent)', transition: 'width 0.25s linear',
        }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {TIMER_PRESETS_MIN.map((m) => {
          const active = duration === m * 60
          return (
            <button
              key={m}
              onClick={() => pick(m * 60)}
              style={{
                padding: '4px 10px', borderRadius: 'var(--radius-chip)', cursor: 'pointer',
                border: active ? '1px solid var(--accent)' : '1px solid var(--glass-edge)',
                background: active ? 'var(--accent-soft)' : 'var(--surface-sunken)',
                color: active ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 'var(--fs-xs)', fontWeight: 500,
              }}
            >
              {m} мин
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={running ? pause : start}
          title={running ? 'Пауза' : 'Старт'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 44, height: 44, borderRadius: '50%', border: 'none', padding: 0,
            background: 'var(--accent)', color: 'var(--text-on-accent)', cursor: 'pointer',
          }}
        >
          {running ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
        </button>
        <button
          onClick={reset}
          title="Сброс"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 44, height: 44, borderRadius: '50%', border: 'none', padding: 0,
            background: 'var(--surface-sunken)', color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </div>
  )
}
