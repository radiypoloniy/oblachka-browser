// Поповер перевода: отдельная WebContentsView поверх контента (см. TranslatePopoverManager.ts).
// Позиционирование и размер задаёт main (setBounds) — эта страница просто рисует содержимое
// на весь свой вьюпорт и репортит реальную высоту контента обратно через preload (рост под
// текст с капом + внутренний скролл сверх капа — сам кап и позиция живут в main).
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Languages, X } from 'lucide-react';
import './styles/global.css';
import type { TranslateOutcome } from '../shared/ipc';

declare global {
  interface Window {
    translatePopover: {
      onOpen: (cb: (text: string) => void) => () => void
      onResult: (cb: (outcome: TranslateOutcome) => void) => () => void
      reportHeight: (px: number) => void
      close: () => void
    }
  }
}

const MAX_CONTENT_HEIGHT = 360 // сверх этого — внутренний скролл, а не рост view

function Popover() {
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState<TranslateOutcome | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsubOpen = window.translatePopover.onOpen((t) => { setText(t); setOutcome(null) })
    const unsubResult = window.translatePopover.onResult((o) => setOutcome(o))
    return () => { unsubOpen(); unsubResult() }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') window.translatePopover.close() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Репортим реальную высоту контента — main растит view под неё (с капом, см. MAX_CONTENT_HEIGHT).
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const report = () => window.translatePopover.reportHeight(Math.min(el.scrollHeight, MAX_CONTENT_HEIGHT))
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, outcome])

  return (
    <div
      ref={wrapperRef}
      style={{
        width: 340,
        maxHeight: MAX_CONTENT_HEIGHT,
        overflowY: 'auto',
        boxSizing: 'border-box',
        background: 'var(--surface-solid)',
        border: '1px solid var(--glass-edge)',
        padding: 12,
        display: 'flex', flexDirection: 'column', gap: 6,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Languages size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
        <span style={{
          fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {text}
        </span>
        <button
          onClick={() => window.translatePopover.close()}
          title="Закрыть (Esc)"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, flexShrink: 0,
            background: 'none', border: 'none', borderRadius: 'calc(var(--radius-card) / 2)',
            color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
          }}
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>

      {outcome === null && (
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Перевожу… (первая загрузка ~5с)
        </span>
      )}

      {outcome?.ok === true && (
        <>
          {/* Полный текст, без обрезки многоточием — длинные переводы дают скролл (см. maxHeight выше). */}
          <span style={{
            fontSize: 'var(--fs-sm)', color: 'var(--text-strong)', fontWeight: 500,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {outcome.out}
          </span>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            [{outcome.dirUsed}] {outcome.ms.toFixed(0)}ms, {outcome.tokPerSec.toFixed(1)} tok/s
            {outcome.loadMs !== null ? `, загрузка: ${outcome.loadMs.toFixed(0)}ms` : ''}
          </span>
        </>
      )}

      {outcome?.ok === false && (
        <span style={{ fontSize: 'var(--fs-sm)', color: 'rgba(200,50,50,0.85)' }}>
          Ошибка: {outcome.error}
        </span>
      )}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popover />
  </React.StrictMode>,
)
