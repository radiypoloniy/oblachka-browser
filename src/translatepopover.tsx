// Поповер AI-действий над выделением (перевод/выжимка/пересказ/объяснение): отдельная
// WebContentsView поверх контента (см. TranslatePopoverManager.ts). Одна страница на все действия —
// action влияет только на иконку/подпись, сама механика (стриминг/рост/скролл/закрытие) общая.
// Позиционирование и размер задаёт main (setBounds) — эта страница просто рисует содержимое
// на весь свой вьюпорт и репортит реальную высоту контента обратно через preload (рост под
// текст с капом + внутренний скролл сверх капа — сам кап и позиция живут в main).
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import { Languages, Wand2, HelpCircle, ListChecks, SpellCheck, Scissors, Smile, X, type LucideIcon } from 'lucide-react';
import './styles/global.css';
import { markdownComponents } from './components/aiMarkdown';
import type { AiAction, AiActionOutcome } from '../shared/ipc';
import { translateLangLabel } from '../shared/translateLangs';
import { installOverlayReveal } from './overlayReveal';

declare global {
  interface Window {
    translatePopover: {
      onOpen: (cb: (text: string, action: AiAction, canReplace: boolean, targetLang?: string) => void) => () => void
      replace: (text: string) => void
      onChunk: (cb: (text: string) => void) => () => void
      onResult: (cb: (outcome: AiActionOutcome) => void) => () => void
      reportHeight: (px: number) => void
      close: () => void
    }
  }
}

const MAX_CONTENT_HEIGHT = 360 // сверх этого — внутренний скролл, а не рост view
// Прозрачный запас под тень карточки — должен покрывать реальный охват box-shadow ниже
// (offset+blur, сейчас 10+28=38px по нижнему краю) с запасом, иначе виден обрез хвоста тени.
// Держать в синхроне с SHADOW_MARGIN в electron/TranslatePopoverManager.ts (main выделяет под
// него ровно столько же места в bounds).
const SHADOW_MARGIN = 40

// Единственное место, где новое действие получает иконку/подпись — сам промпт живёт в
// TranslationService.ts, пункт меню в TabManager.ts. Больше поповер трогать не нужно.
const ACTION_ICON: Record<AiAction, LucideIcon> = {
  translate: Languages, simplify: Wand2, explain: HelpCircle, summarize: ListChecks,
  fix: SpellCheck, shorten: Scissors, polite: Smile,
}
const ACTION_VERB: Record<AiAction, string> = {
  translate: 'Перевожу', simplify: 'Упрощаю', explain: 'Объясняю', summarize: 'Делаю выжимку',
  fix: 'Исправляю', shorten: 'Сокращаю', polite: 'Смягчаю',
}

function Popover() {
  const [text, setText] = useState('')
  const [action, setAction] = useState<AiAction>('translate')
  // Копится по мере генерации (токен-стриминг, см. onChunk) — показывается СРАЗУ, не дожидаясь
  // outcome. outcome.out (финальный, авторитетный) подменяет её как только придёт весь результат
  // целиком. Куски конкатенируются как есть, без вставки пробелов — модель отдаёт их уже с нужными
  // пробелами внутри сегмента, а разделитель между сегментами перевода добавляет сам main-процесс
  // (см. runSegmented в TranslationService.ts).
  const [streamedText, setStreamedText] = useState('')
  const [outcome, setOutcome] = useState<AiActionOutcome | null>(null)
  // Текст пришёл из поля ввода — значит правку можно вернуть туда же (см. TabManager: «Править текст»).
  const [canReplace, setCanReplace] = useState(false)
  // Явно выбранный язык перевода («Перевести на английский») — только для подписи процесса.
  const [targetLang, setTargetLang] = useState<string | undefined>(undefined)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsubOpen = window.translatePopover.onOpen((t, a, replaceable, tgt) => {
      setText(t); setAction(a); setCanReplace(replaceable); setTargetLang(tgt); setOutcome(null); setStreamedText('')
    })
    const unsubChunk = window.translatePopover.onChunk((chunkText) => {
      setStreamedText((prev) => prev + chunkText)
    })
    const unsubResult = window.translatePopover.onResult((o) => setOutcome(o))
    return () => { unsubOpen(); unsubChunk(); unsubResult() }
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

  const ActionIcon = ACTION_ICON[action]

  return (
    // Прозрачный внешний паддинг — место для вытекания CSS box-shadow за пределы видимой карточки
    // (сама WebContentsView увеличена на столько же в main, см. SHADOW_MARGIN в TranslatePopoverManager.ts).
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div
        ref={wrapperRef}
        style={{
          width: 340,
          maxHeight: MAX_CONTENT_HEIGHT,
          overflowY: 'auto',
          boxSizing: 'border-box',
          background: 'var(--surface-solid)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-overlay)',
          padding: 'var(--pad-card)',
          display: 'flex', flexDirection: 'column', gap: 8,
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ActionIcon size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
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

        {/* Пока не пришёл ни один сегмент и не пришёл финальный outcome — обычный плейсхолдер загрузки. */}
        {outcome === null && streamedText.length === 0 && (
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
            {action === 'translate' && targetLang ? `Перевожу на ${translateLangLabel(targetLang).toLowerCase()}` : ACTION_VERB[action]}… (при первом запуске загрузка модели — до 30–40 секунд)
          </span>
        )}

        {/* Стримится по мере генерации токенов (streamedText) до финального outcome.out — тот
            же Markdown-рендер и до, и после финализации (react-markdown нормально переживает
            промежуточный незакрытый синтаксис, самоисправляется на следующем чанке), чтобы верстка
            не прыгала на последних токенах и сырые символы разметки не мелькали дольше, чем нужно. */}
        {outcome?.ok !== false && (streamedText.length > 0 || outcome?.ok === true) && (
          <>
            {/* Без обрезки многоточием — длинные результаты дают скролл (см. maxHeight выше). */}
            <ReactMarkdown components={markdownComponents}>
              {outcome?.ok === true ? outcome.out : streamedText}
            </ReactMarkdown>
            {/* Индикатор «идёт обработка» — пока не пришёл финальный результат (outcome ещё null). */}
            {outcome === null && (
              <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-faint)' }}>…</span>
            )}
            {/* Вставка правки обратно в поле — только когда текст оттуда и пришёл, и только после
                финального результата: подставлять недогенерированный текст в форму человека нельзя.
                Одной кнопкой, без «применить ко всему»: решение остаётся за человеком, а Ctrl+Z в
                самом поле вернёт исходник (см. buildReplaceScript в TranslatePopoverManager.ts). */}
            {canReplace && outcome?.ok === true && (
              <button
                onClick={() => window.translatePopover.replace(outcome.out)}
                style={{
                  alignSelf: 'flex-start', marginTop: 2,
                  border: 'none', background: 'var(--accent)', color: 'var(--on-accent)',
                  padding: '6px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  fontSize: 'var(--fs-sm)', fontWeight: 500, fontFamily: 'inherit',
                }}
              >
                Заменить в поле
              </button>
            )}
            {/* Техстрока (скорость/тайминг) — доступна, но не должна цеплять взгляд. Только после финала. */}
            {outcome?.ok === true && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', opacity: 0.7 }}>
                {outcome.dirUsed ? `[${outcome.dirUsed}] ` : ''}{outcome.ms.toFixed(0)}ms, {outcome.tokPerSec.toFixed(1)} tok/s
                {outcome.loadMs !== null ? `, загрузка: ${outcome.loadMs.toFixed(0)}ms` : ''}
              </span>
            )}
          </>
        )}

        {outcome?.ok === false && (
          <span style={{ fontSize: 'var(--fs-sm)', color: 'rgba(200,50,50,0.85)' }}>
            Ошибка: {outcome.error}
          </span>
        )}
      </div>
    </div>
  )
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popover />
  </React.StrictMode>,
)
