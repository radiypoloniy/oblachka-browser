import { useState } from 'react'

// ── Счётчик символов ─────────────────────────────────────────────────────────────────────────
// Живой подсчёт на каждый ввод — без кнопки «Посчитать» (см. задачу: важен результат, не текст).
// Главные метрики — всего символов и без пробелов — крупными плитками, остальное мелкими строками.
export default function CounterApp() {
  const [text, setText] = useState('')

  // По code points (итерация строки), не по UTF-16-юнитам — эмодзи и прочие суррогатные пары
  // считаются одним символом, а не двумя.
  let total = 0
  let spaces = 0
  let cyr = 0
  let lat = 0
  let digits = 0
  for (const ch of text) {
    total++
    if (/\s/u.test(ch)) spaces++
    else if (/\p{Script=Cyrillic}/u.test(ch)) cyr++
    else if (/\p{Script=Latin}/u.test(ch)) lat++
    else if (/[0-9]/.test(ch)) digits++
  }
  const noSpaces = total - spaces
  const other = total - spaces - cyr - lat - digits
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length

  const details: { label: string; value: number }[] = [
    { label: 'Слова', value: words },
    { label: 'Пробелы', value: spaces },
    { label: 'Кириллица', value: cyr },
    { label: 'Латиница', value: lat },
    { label: 'Цифры', value: digits },
    { label: 'Остальные', value: other },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Вставьте или введите текст…"
        rows={4}
        style={{
          resize: 'none', border: 'none', outline: 'none',
          borderRadius: 'var(--radius-sm)', padding: '8px 10px',
          background: 'var(--surface-sunken)', color: 'var(--text-strong)',
          fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)', lineHeight: 'var(--lh-body)',
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        {[{ label: 'Символов', value: total }, { label: 'Без пробелов', value: noSpaces }].map((s) => (
          <div key={s.label} style={{
            flex: 1, minWidth: 0, padding: '8px 10px',
            background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            <span style={{
              fontSize: 22, fontWeight: 300, color: 'var(--text-strong)',
              fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
            }}>
              {s.value}
            </span>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{s.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12, rowGap: 4 }}>
        {details.map((d) => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{ flex: 1, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{d.label}</span>
            <span style={{
              fontSize: 'var(--fs-xs)', color: 'var(--text-body)', fontVariantNumeric: 'tabular-nums',
            }}>
              {d.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
