import { useState } from 'react'
import { computeCalc, fmtCalc, calcDisp, resolvePercent } from '../../../shared/calc'
import type { CalcOp } from '../../../shared/calc'
import { useCalcKeyboard } from './useCalcKeyboard'

// ── Калькулятор ──────────────────────────────────────────────────────────────────────────────
// Арифметика, формат и правило процента — в shared/calc.ts под scripts/calc-check.mjs. Здесь
// остаётся автомат состояний и отрисовка.

export default function CalcApp() {
  const [display, setDisplay] = useState('0')
  const [acc, setAcc] = useState<number | null>(null)
  const [op, setOp] = useState<CalcOp | null>(null)
  // «Ждём новый операнд»: только что нажат оператор/равно — следующая цифра НАЧИНАЕТ число,
  // а не дописывается к показанному результату.
  const [waiting, setWaiting] = useState(false)
  // Строка текущего действия над дисплеем («12 −», после «=» — «12 − 4 =»): без неё нажатый
  // оператор никак не виден и легко забыть, что уже ввёл — просили как на iOS.
  const [expr, setExpr] = useState('')
  // ⚠️ Набранное число ПОМЕЧЕНО процентом, но ещё не превращено в число. Раньше «%» считал сразу и
  // клал результат на дисплей: набрал «50 + 10 %» — видишь «5», и кажется, что ввёл не то. Само
  // правило счёта при этом было верным, ошибка была в моменте — человек не успевал увидеть, что
  // он вообще ввёл. Теперь процент разрешается в число только при «=» или следующем операторе
  // (см. takeOperand), а до тех пор дисплей показывает «10%».
  const [percentPending, setPercentPending] = useState(false)

  // Текущий операнд числом, с уже применённым процентом. Единственная точка, где процент
  // превращается в значение, — иначе правило разъедется между «=» и цепочкой операторов.
  const takeOperand = (): number => {
    const cur = parseFloat(display)
    return percentPending ? resolvePercent(cur, acc, op) : cur
  }
  // Как этот операнд выглядит в строке выражения: «50 + 10% =» объясняет результат, а «50 + 5 =»
  // выглядит так, будто человек ввёл пятёрку.
  const operandLabel = (): string =>
    percentPending ? `${display.replace('.', ',')}%` : calcDisp(parseFloat(display))

  const inputDigit = (d: string) => {
    // Процент уже поставлен — цифра начинает НОВОЕ число, а не дописывается к помеченному.
    if (waiting || percentPending || display === 'Ошибка') {
      if (op === null) setExpr('') // новый расчёт после «=» — прошлое выражение уже не контекст
      setDisplay(d === '.' ? '0.' : d)
      setWaiting(false)
      setPercentPending(false)
      return
    }
    if (d === '.' && display.includes('.')) return
    setDisplay(display === '0' && d !== '.' ? d : display + d)
  }

  const applyOp = (nextOp: CalcOp) => {
    const cur = takeOperand()
    let base: number
    if (acc === null) {
      base = cur
    } else if ((waiting && !percentPending) || op === null) {
      // Оператор сменили ДО ввода второго операнда — просто перезаписываем знак. Исключение —
      // помеченный процент: «50 + %» это уже введённый операнд, его надо досчитать, а не выкинуть.
      base = acc
    } else {
      // Цепочка 2+3+4: очередной оператор довычисляет предыдущий (immediate execution, как iOS).
      base = computeCalc(acc, cur, op)
    }
    setDisplay(fmtCalc(base))
    setAcc(isFinite(base) ? base : null)
    setOp(nextOp)
    setWaiting(true)
    setPercentPending(false)
    setExpr(`${calcDisp(base)} ${nextOp}`)
  }

  const equals = () => {
    if (op === null || acc === null) return
    const b = takeOperand()
    const r = computeCalc(acc, b, op)
    setExpr(`${calcDisp(acc)} ${op} ${operandLabel()} =`)
    setDisplay(fmtCalc(r))
    setAcc(null)
    setOp(null)
    setWaiting(true)
    setPercentPending(false)
  }

  const clear = () => {
    setDisplay('0'); setAcc(null); setOp(null); setWaiting(false); setExpr('')
    setPercentPending(false)
  }
  const negate = () => setDisplay(fmtCalc(-parseFloat(display)))
  // «%» больше не считает — он только помечает набранное процентом (см. percentPending выше).
  // Повторное нажатие ничего не меняет: процент уже стоит, а «процент от процента» — не жест,
  // за которым кто-то приходит в калькулятор панели.
  const percent = () => {
    if (display === 'Ошибка') return
    setPercentPending(true)
  }

  // Стереть последний символ (клавиша Backspace; кнопки на поле нет — сетка занята).
  const backspace = () => {
    if (display === 'Ошибка') return
    // Стоит процент — стираем СНАЧАЛА его, а не цифру: это единственная отмена ошибочного «%»,
    // и она же самая ожидаемая («видел 10%, нажал стереть — вижу 10»).
    if (percentPending) {
      setPercentPending(false)
      return
    }
    // ⚠️ Только что нажали оператор — стирать в показанном числе нечего (оно уже принято как
    // первый операнд). Осмысленное действие здесь одно: ОТМЕНИТЬ оператор, нажатый по ошибке.
    // Прежде эта ветка просто выходила молча, и клавиша выглядела нерабочей.
    if (waiting && op !== null) {
      setOp(null)
      setWaiting(false)
      setExpr('')
      return
    }
    // После «=» результат тоже можно править — это обычное число на дисплее.
    const next = display.slice(0, -1)
    setDisplay(next === '' || next === '-' ? '0' : next)
    setWaiting(false)
  }

  // Клавиатура и вставка из буфера — в useCalcKeyboard. Ref оттуда вешается на корень: по нему
  // обработчики понимают, что раздел не скрыт.
  const calcRootRef = useCalcKeyboard({
    inputDigit, applyOp, equals, clear, percent, backspace,
    pasteNumber: (n) => {
      setDisplay(fmtCalc(n))
      // Вставленное — полноценный операнд: после «50 +» оно становится вторым слагаемым, а не
      // затирается следующей цифрой. И это уже НЕ процент, даже если помеченное число было им.
      setWaiting(false)
      setPercentPending(false)
      // Действие не начато — значит это новый расчёт, прошлое выражение над дисплеем уже не контекст.
      if (op === null) setExpr('')
    },
  })

  const keys = buildKeys({ clear, negate, percent, applyOp, inputDigit, equals })

  const shownValue = display.replace('.', ',') + (percentPending ? '%' : '')

  return (
    <div ref={calcRootRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      {/* Строка действия — резервирует высоту и пустой (minHeight), чтобы дисплей не прыгал. */}
      <div style={{
        padding: '8px 16px 0', textAlign: 'right', flexShrink: 0, minHeight: 26,
        fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
        fontVariantNumeric: 'tabular-nums',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {expr}
      </div>
      {/* Знак процента — часть ПОКАЗАННОГО числа, а не отдельный значок: он и есть тот ответ на
          «а что я вообще ввёл», ради которого «%» перестал считать сразу. Кегль выбирается по
          длине показанного, вместе с этим знаком, иначе «10%» на границе прыгал бы в размере. */}
      <div style={{
        padding: '0 16px 4px', textAlign: 'right', flexShrink: 0,
        fontSize: shownValue.length > 9 ? 22 : 30, fontWeight: 300,
        color: 'var(--text-strong)', fontVariantNumeric: 'tabular-nums',
        overflowWrap: 'anywhere',
      }}>
        {shownValue}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7,
        padding: '6px 10px 10px', flexShrink: 0,
      }}>
        {keys.map((k) => {
          // Активный оператор подсвечен инверсией (как «залипшая» кнопка iOS), пока ждём операнд.
          // «%» подсвечивается по тому же правилу, пока процент поставлен, но ещё не разрешён в
          // число: состояние видно и на дисплее, и на самой кнопке, которой его сняли.
          const activeOp = (k.kind === 'op' && k.label === op && waiting)
            || (k.label === '%' && percentPending)
          return (
            <button
              key={k.label}
              onClick={k.onPress}
              style={{
                gridColumn: k.span ? `span ${k.span}` : undefined,
                height: 42, border: 'none', borderRadius: 'var(--radius-pill)', padding: 0,
                // ⚠️ Знаки действий крупнее и жирнее цифр. «÷» и «+» в одном кегле различаются
                // одной точкой над чертой и снизу — на бегу это один и тот же значок, о чём и
                // была жалоба. Размер тут работает лучше цвета: цвет у операторов уже занят
                // акцентом, и вторым признаком его не сделать (см. цветовой закон в CLAUDE.md).
                fontSize: k.kind === 'op' ? 'var(--fs-xl)' : 'var(--fs-lg)',
                fontWeight: k.kind === 'op' ? 600 : 500,
                lineHeight: 1,
                fontFamily: 'var(--font-sans)', cursor: 'pointer',
                background: activeOp ? 'var(--accent-soft)'
                  : k.kind === 'op' ? 'var(--accent)' : 'var(--surface-sunken)',
                color: activeOp ? 'var(--accent)'
                  : k.kind === 'op' ? 'var(--text-on-accent)'
                    : k.kind === 'fn' ? 'var(--text-muted)' : 'var(--text-strong)',
              }}
            >
              {k.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface CalcKey { label: string; kind: 'fn' | 'op' | 'digit'; span?: number; onPress: () => void }

// Раскладка клавиш — за пределами компонента: она не состояние, а описание, и внутри функции
// только раздувала её (сторож структуры не пускает больше 200 строк).
function buildKeys({ clear, negate, percent, applyOp, inputDigit, equals }: {
  clear: () => void
  negate: () => void
  percent: () => void
  applyOp: (op: CalcOp) => void
  inputDigit: (d: string) => void
  equals: () => void
}): CalcKey[] {
  return [
  { label: 'C', kind: 'fn', onPress: clear },
  { label: '±', kind: 'fn', onPress: negate },
  { label: '%', kind: 'fn', onPress: percent },
  { label: '÷', kind: 'op', onPress: () => applyOp('÷') },
  { label: '7', kind: 'digit', onPress: () => inputDigit('7') },
  { label: '8', kind: 'digit', onPress: () => inputDigit('8') },
  { label: '9', kind: 'digit', onPress: () => inputDigit('9') },
  { label: '×', kind: 'op', onPress: () => applyOp('×') },
  { label: '4', kind: 'digit', onPress: () => inputDigit('4') },
  { label: '5', kind: 'digit', onPress: () => inputDigit('5') },
  { label: '6', kind: 'digit', onPress: () => inputDigit('6') },
  { label: '−', kind: 'op', onPress: () => applyOp('−') },
  { label: '1', kind: 'digit', onPress: () => inputDigit('1') },
  { label: '2', kind: 'digit', onPress: () => inputDigit('2') },
  { label: '3', kind: 'digit', onPress: () => inputDigit('3') },
  { label: '+', kind: 'op', onPress: () => applyOp('+') },
  { label: '0', kind: 'digit', span: 2, onPress: () => inputDigit('0') },
  { label: ',', kind: 'digit', onPress: () => inputDigit('.') },
  { label: '=', kind: 'op', onPress: equals },
  ]
}
