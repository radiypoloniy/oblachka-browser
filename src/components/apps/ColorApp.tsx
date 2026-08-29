import { useState, useRef } from 'react'
import { Pipette } from 'lucide-react'
import { CopyChip } from './CopyChip'

// ── Пипетка (цвет с экрана) ──────────────────────────────────────────────────────────────────
function hexToRgb(hex: string): string {
  if (hex.length !== 7) return ''
  const n = parseInt(hex.slice(1), 16)
  if (isNaN(n)) return ''
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

export default function ColorApp() {
  const [color, setColor] = useState<string>(() => {
    // Стартовый цвет — текущий акцент темы, прочитанный из токена (не зашитый хекс).
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    return /^#[0-9a-f]{6}$/i.test(v) ? v : '#888888' // фоллбэк, если токен вдруг не hex-формата
  })
  const [recent, setRecent] = useState<string[]>([])
  const [copied, setCopied] = useState<'hex' | 'rgb' | null>(null)
  // Дебаунс записи в «недавние»: input type=color стреляет onChange на каждый пиксель драга
  // по палитре — без паузы ряд забивался бы промежуточными оттенками.
  const commitTimer = useRef<number | null>(null)

  const addRecent = (c: string) => {
    setRecent((prev) => [c, ...prev.filter((x) => x !== c)].slice(0, 8))
  }
  const handleInput = (c: string) => {
    setColor(c)
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(() => addRecent(c), 600)
  }

  const eyeDropperSupported = typeof window.EyeDropper === 'function'
  const pickFromScreen = async () => {
    if (!window.EyeDropper) return
    try {
      const res = await new window.EyeDropper().open()
      setColor(res.sRGBHex)
      addRecent(res.sRGBHex)
    } catch { /* Esc/отмена выбора — штатный исход open(), не ошибка */ }
  }

  const copy = (text: string, kind: 'hex' | 'rgb') => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(kind)
        window.setTimeout(() => setCopied((cur) => (cur === kind ? null : cur)), 1200)
      },
      () => { /* clipboard недоступен — кнопка просто не подтвердит копирование */ },
    )
  }

  const rgb = hexToRgb(color)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
      <div style={{
        height: 72, flexShrink: 0, borderRadius: 'var(--radius-card)',
        background: color, border: '1px solid var(--glass-edge)',
      }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <CopyChip label={color.toUpperCase()} copied={copied === 'hex'} onCopy={() => copy(color.toUpperCase(), 'hex')} />
        {rgb && <CopyChip label={rgb} copied={copied === 'rgb'} onCopy={() => copy(rgb, 'rgb')} />}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {eyeDropperSupported && (
          <button
            onClick={() => { void pickFromScreen() }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center',
              padding: '7px 10px', borderRadius: 'var(--radius-chip)', border: 'none',
              background: 'var(--accent)', color: 'var(--text-on-accent)',
              fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Pipette size={13} /> Взять с экрана
          </button>
        )}
        {/* label оборачивает визуально скрытый input type=color — клик по «кнопке» открывает
            нативную палитру Chromium, свой пикер не изобретаем. */}
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center',
          padding: '7px 10px', borderRadius: 'var(--radius-chip)',
          border: '1px solid var(--glass-edge)', background: 'var(--surface-sunken)',
          color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontWeight: 500,
          cursor: 'pointer', position: 'relative',
        }}>
          Палитра
          <input
            type="color"
            value={color}
            onChange={(e) => handleInput(e.target.value)}
            style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
          />
        </label>
      </div>
      {recent.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {recent.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c.toUpperCase()}
              style={{
                width: 22, height: 22, borderRadius: '50%', padding: 0, cursor: 'pointer',
                background: c, border: '1px solid var(--glass-edge)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
