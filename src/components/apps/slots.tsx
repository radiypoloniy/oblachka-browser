import { useEffect, useRef } from 'react'
import { X, ArrowUpDown } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { RADIUS } from '../../styles/system'
import { AppIconBadge } from './AppIconBadge'
import { SlotActiveContext } from './slotActive'
import type { AppDef } from './types'
import CalcApp from './CalcApp'
import TimerApp from './TimerApp'
import ConverterApp from './ConverterApp'
import ColorApp from './ColorApp'
import CounterApp from './CounterApp'
import KittenApp from './KittenApp'
import ZonesApp from '../ZonesApp'

// ── Слот открытого приложения ────────────────────────────────────────────────────────────────
// Общая карточка слота: шапка (иконка + название + свап при двух слотах + крестик) и содержимое.
// Разделитель между двумя слотами: тянут за него, меняется доля высоты. Ручка нарисована
// полоской по центру — без неё зона в 10 px читается как пустой зазор, а не как ручка.
export function SlotDivider({ onPointerDown, active }: {
  onPointerDown: (e: React.PointerEvent) => void
  active: boolean
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      title="Потяните, чтобы изменить размер"
      style={{
        flexShrink: 0, height: 10, margin: '-6px 0', // съедает часть gap, не раздвигая слоты
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'row-resize', touchAction: 'none',
      }}
    >
      <div style={{
        width: 40, height: 4, borderRadius: RADIUS.tight,
        background: active ? 'var(--accent)' : 'var(--text-faint)',
        opacity: active ? 1 : 0.4,
      }} />
    </div>
  )
}

function SlotFrame({ app, grow = 1, active = false, showRing = false, onActivate, onSwap, onClose, children }: {
  app: AppDef
  /** Доля высоты среди слотов (см. SPLIT_KEY). */
  grow?: number
  /** Клавиши идут сюда (единственное открытое приложение активно всегда). */
  active?: boolean
  /** Нарисовать рамку — только когда открыты оба и есть из чего выбирать. */
  showRing?: boolean
  onActivate?: () => void
  onSwap?: () => void
  onClose: () => void
  children: React.ReactNode
}) {
  // Перетаскивание слота: ручка — шапка (listeners), цель дропа — ВЕСЬ слот (setNodeRef).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.id })

  // ⚠️ Стать активным — значит ПРИНЯТЬ КЛАВИАТУРУ, а не только получить рамку. У калькулятора
  // обработчик глобальный, ему хватает флага активности; а конвертер — обычное поле ввода, и без
  // фокуса в нём Ctrl+Tab переключал рамку, но набирать было по-прежнему некуда (живая жалоба).
  // Поэтому при активации переводим фокус в первое поле слота — если человек уже не поставил его
  // сам куда-то внутрь (клик по конкретному полю не должен перебрасываться на первое).
  const rootRef = useRef<HTMLDivElement | null>(null)
  const setRefs = (el: HTMLDivElement | null): void => {
    rootRef.current = el
    setNodeRef(el)
  }
  useEffect(() => {
    if (!active) return
    const root = rootRef.current
    if (!root || root.contains(document.activeElement)) return
    // Веб-слот: поле живёт в чужой вью, фокус ей отдаёт main (панель до неё не дотянется).
    if (app.kind === 'web') { window.aiPanel.webappFocus(app.id); return }
    const field = root.querySelector<HTMLElement>('input, textarea')
    if (field) { field.focus(); return }
    // ⚠️ Полей нет (калькулятор) — тогда надо СНЯТЬ фокус с чужого поля, а не оставить как есть:
    // глобальный обработчик калькулятора пропускает нажатия, сделанные в INPUT (иначе он воровал бы
    // цифры у любого поля панели), и без этого снятия цифры продолжали бы уходить в конвертер,
    // хотя активен уже калькулятор.
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur()
  }, [active, app.id, app.kind])
  // Рамка — тонкая линия акцента ВОКРУГ карточки. Внутренняя тень (inset), а не outline: outline
  // рисуется поверх скруглённых углов прямоугольником и торчит по краям; inset ложится по радиусу.
  const ring = showRing
    ? 'inset 0 0 0 1.5px var(--accent), var(--shadow-card)'
    : 'var(--shadow-card)'
  return (
    <div
      ref={setRefs}
      // pointerdown в ЗАХВАТЕ: клик по кнопке внутри приложения тоже означает «работаю здесь»,
      // а до onClick самой кнопки событие может и не дойти (она может его погасить).
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
      style={{
        flex: grow, minHeight: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface-solid)', borderRadius: 'var(--radius-card)',
        boxShadow: ring, overflow: 'hidden',
        transform: CSS.Transform.toString(transform), transition,
        // Тащим — карточка приподнята, а не исчезает: слотов всего два, и пропавший из них
        // оставил бы половину экрана пустой.
        opacity: isDragging ? 0.75 : 1,
        zIndex: isDragging ? 2 : undefined,
      }}
      {...attributes}
    >
      {/* ⚠️ Жест НАЧИНАЕТСЯ на шапке (здесь listeners), но ПРИНИМАЕТ дроп весь слот целиком —
          цель задана на карточке выше. Шапка как ручка — потому что тело занято самим
          приложением: кнопки калькулятора нельзя нажать, если каждое нажатие начинает перенос. */}
      <div
        {...listeners}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
          flexShrink: 0, borderBottom: '1px solid var(--divider)',
          cursor: 'grab', touchAction: 'none',
        }}
      >
        <AppIconBadge app={app} size={20} radius={6} iconSize={12} />
        <span style={{
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
        }}>
          {app.label}
        </span>
        {onSwap !== undefined && (
          <button
            onClick={onSwap}
            title="Поменять слоты местами"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, flexShrink: 0, padding: 0,
              background: 'transparent', border: 'none', borderRadius: '50%',
              color: 'var(--text-faint)', cursor: 'pointer',
            }}
          >
            <ArrowUpDown size={12} strokeWidth={2} />
          </button>
        )}
        <button
          onClick={onClose}
          title="Закрыть приложение"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, flexShrink: 0, padding: 0,
            background: 'transparent', border: 'none', borderRadius: '50%',
            color: 'var(--text-faint)', cursor: 'pointer',
          }}
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>
      <SlotActiveContext.Provider value={active}>
        {children}
      </SlotActiveContext.Provider>
    </div>
  )
}

export function AppSlot({ app, grow, active, showRing, onActivate, onSwap, onClose }: {
  app: AppDef; grow?: number; active?: boolean; showRing?: boolean; onActivate?: () => void
  onSwap?: () => void; onClose: () => void
}) {
  return (
    <SlotFrame app={app} grow={grow} active={active} showRing={showRing} onActivate={onActivate}
      onSwap={onSwap} onClose={onClose}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {app.id === 'calc' && <CalcApp />}
        {app.id === 'convert' && <ConverterApp />}
        {app.id === 'zones' && <ZonesApp />}
        {app.id === 'timer' && <TimerApp />}
        {app.id === 'color' && <ColorApp />}
        {app.id === 'kitten' && <KittenApp />}
        {app.id === 'counter' && <CounterApp />}
      </div>
    </SlotFrame>
  )
}

// ── Веб-слот: чужой сайт в WebContentsView поверх «дырки» ────────────────────────────────────
// Сам сайт рисует main (WebAppManager.ts) — эта карточка только размечает и меряет дырку.
// hidden — шит настроек открыт поверх домашнего экрана: view надо спрятать, она лежит выше
// панели в z-order и иначе перекрыла бы шит.
export function WebAppSlot({ app, slotIndex, grow, active, showRing, onActivate, hidden, onSwap, onClose }: {
  app: AppDef
  slotIndex: number
  grow?: number
  active?: boolean
  showRing?: boolean
  onActivate?: () => void
  hidden: boolean
  onSwap?: () => void
  onClose: () => void
}) {
  const holeRef = useRef<HTMLDivElement>(null)

  // Жизнь view привязана к жизни слота: маунт → open (идемпотентен в main), анмаунт → close.
  useEffect(() => {
    if (app.url) window.aiPanel.webappOpen(app.id, app.url)
    return () => window.aiPanel.webappClose(app.id)
  }, [app.id, app.url])

  // Тот же приём, что App.tsx с областью контента вкладки: renderer меряет прямоугольник
  // (ResizeObserver) и шлёт в main. Скрытие (display:none всего раздела в режиме чата) даёт
  // нулевой прямоугольник — main прячет view; возврат в «Приложения» триггерит observer снова.
  // slotIndex в deps обязателен: свап слотов меняет ПОЗИЦИЮ дырки при том же РАЗМЕРЕ —
  // ResizeObserver на это не срабатывает, пересылку форсирует смена индекса.
  useEffect(() => {
    const el = holeRef.current
    if (!el) return
    const send = () => {
      if (hidden) {
        window.aiPanel.webappBounds(app.id, { x: 0, y: 0, width: 0, height: 0 })
        return
      }
      const r = el.getBoundingClientRect()
      window.aiPanel.webappBounds(app.id, { x: r.x, y: r.y, width: r.width, height: r.height })
    }
    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    return () => ro.disconnect()
  }, [app.id, hidden, slotIndex])

  return (
    <SlotFrame app={app} grow={grow} active={active} showRing={showRing} onActivate={onActivate}
      onSwap={onSwap} onClose={onClose}>
      <div style={{ flex: 1, minHeight: 0, padding: '0 8px 8px', display: 'flex' }}>
        <div
          ref={holeRef}
          style={{
            flex: 1, minWidth: 0, borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-sunken)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {/* Видно только пока сайт не отрисовался (view ложится сверху) или пока слот скрыт. */}
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>Загрузка…</span>
        </div>
      </div>
    </SlotFrame>
  )
}
