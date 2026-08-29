import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { parsePastedNumber } from '../../../shared/calc'
import { useSlotActive } from './slotActive'

/** Что клавиатура и вставка умеют делать с калькулятором. */
export interface CalcKeyActions {
  inputDigit: (d: string) => void
  applyOp: (op: '+' | '−' | '×' | '÷') => void
  equals: () => void
  clear: () => void
  percent: () => void
  backspace: () => void
  /** В буфере оказалось число — положить его на дисплей. */
  pasteNumber: (n: number) => void
}

/**
 * Ввод с клавиатуры и вставка из буфера. Вынесено из CalcApp: сторож структуры не пустил новый
 * файл с функцией на 258 строк — и это тот случай, когда он прав, потому что оба обработчика
 * повторяют ОДНИ И ТЕ ЖЕ три гварда (поле ввода, скрытый раздел, неактивный слот), и рядом эта
 * повторяемость наконец видна.
 *
 * Возвращает ref, который надо повесить на корень калькулятора: по нему обработчики понимают,
 * что раздел не скрыт.
 */
export function useCalcKeyboard(actions: CalcKeyActions): RefObject<HTMLDivElement> {
  const calcRootRef = useRef<HTMLDivElement>(null)
  const slotActive = useSlotActive()
  const { inputDigit, applyOp, equals, clear, percent, backspace, pasteNumber } = actions
  // Ввод с клавиатуры: цифры (верхний ряд И намбар дают одинаковый e.key), операторы * / + -,
  // Enter/= — равно, Backspace — стереть, Delete — сброс. Escape намеренно НЕ трогаем — он
  // закрывает панель (см. aipanel.tsx). Без deps-массива: подписка пересоздаётся на каждый
  // рендер — обработчик всегда видит свежие display/acc/op без ручного списка зависимостей.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Не перехватываем набор в полях (чат-textarea, инпуты конвертера/настроек)...
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      // ...и не реагируем, пока раздел скрыт (режим чата держит приложения смонтированными
      // под display:none — offsetParent тогда null, невидимый калькулятор молчит).
      if (!calcRootRef.current || calcRootRef.current.offsetParent === null) return
      // ...и пока работают в СОСЕДНЕМ слоте. Подписка глобальная (на window), поэтому без этой
      // проверки открытый рядом калькулятор перехватывал цифры, набираемые в конвертере.
      if (!slotActive) return

      const k = e.key
      if (/^[0-9]$/.test(k)) { inputDigit(k); e.preventDefault(); return }
      if (k === '.' || k === ',') { inputDigit('.'); e.preventDefault(); return }
      if (k === '+') { applyOp('+'); e.preventDefault(); return }
      if (k === '-') { applyOp('−'); e.preventDefault(); return }
      if (k === '*') { applyOp('×'); e.preventDefault(); return }
      if (k === '/') { applyOp('÷'); e.preventDefault(); return }
      if (k === '%') { percent(); e.preventDefault(); return }
      if (k === 'Enter' || k === '=') { equals(); e.preventDefault(); return }
      if (k === 'Backspace') { backspace(); e.preventDefault(); return }
      if (k === 'Delete') { clear(); e.preventDefault(); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Вставка числа (Ctrl+V): скопировали цену/сумму со страницы — кладём её на дисплей вместо
  // того, чтобы перебивать по цифре. Событие paste прилетает и на невставляемый элемент (фокус
  // на body), поэтому ловим его на window — как и keydown выше.
  // ⚠️ Три гварда повторены ДОСЛОВНО из обработчика клавиш: без них калькулятор воровал бы
  // вставку у чата и у конвертера в соседнем слоте — это уже была живая жалоба про цифры.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (!calcRootRef.current || calcRootRef.current.offsetParent === null) return
      if (!slotActive) return

      const n = parsePastedNumber(e.clipboardData?.getData('text') ?? '')
      if (n === null) return // в буфере не число — молча пропускаем, чужую вставку не ломаем
      e.preventDefault()
      // Что вставленное число делает с состоянием, решает сам калькулятор — здесь только гварды
      // и разбор строки.
      pasteNumber(n)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  return calcRootRef
}
