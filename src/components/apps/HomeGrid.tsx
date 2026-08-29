import { useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AppIconBadge } from './AppIconBadge'
import { WeatherWidget, CurrencyWidget } from './widgets'
import type { AppDef, AppId } from './types'
import type { WidgetsConfig } from './storage'

const GRID_COLUMNS = 4

// Иконка приложения. Вынесена отдельно намеренно: ровно ею же рисуется призрак под курсором
// (DragOverlay), а призрак, нарисованный «похоже, но не тем же», — классический источник
// расхождений вида «в руке одно, приземлилось другое».
type LabelTone = 'theme' | 'light' | 'dark'

function AppIcon({ app, opened, labelTone, dragging, onOpen, onMenu }: {
  app: AppDef
  opened: boolean
  labelTone: LabelTone
  dragging?: boolean
  onOpen?: () => void
  onMenu?: (x: number, y: number) => void
}) {
  return (
    <button
      onClick={onOpen}
      onContextMenu={(e) => { e.preventDefault(); onMenu?.(e.clientX, e.clientY) }}
      title={app.label}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        width: '100%', minWidth: 0, padding: 0,
        background: 'transparent', border: 'none',
        cursor: dragging ? 'grabbing' : 'pointer',
        // Призрак чуть крупнее — он «в руке», поднят над экраном.
        transform: dragging ? 'scale(1.06)' : undefined,
      }}
    >
      {/* --radius-card (13px) на 54px — те же ~24% скругления, что у иконок iOS.
          ⚠️ Открытое приложение подсвечено кольцом, а не притушено: притушивание читалось как
          «недоступно» — ровно наперекор смыслу, приложение открыто и живёт в слоте рядом. */}
      <span style={{
        borderRadius: 'var(--radius-card)',
        boxShadow: opened ? '0 0 0 2px var(--accent)' : undefined,
        lineHeight: 0,
      }}>
        <AppIconBadge app={app} size={54} iconSize={32} shadow />
      </span>
      <span style={{
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: 'var(--fs-xs)', fontWeight: 500,
        color: labelTone === 'light' ? 'var(--app-label)'
          : labelTone === 'dark' ? 'var(--app-label-dark)' : 'var(--text-body)',
        textShadow: labelTone === 'light' ? 'var(--app-label-shadow)' : undefined,
      }}>
        {app.label}
      </span>
    </button>
  )
}

// DnD-обёртка иконки — ровно та же, что у ячеек закреплённых вкладок в сайдбаре.
// Исходная позиция становится прозрачной, пока идёт жест: рисует её призрак.
function SortableAppIcon({ app, opened, labelTone, onOpen, onMenu }: {
  app: AppDef
  opened: boolean
  labelTone: LabelTone
  onOpen: () => void
  onMenu: (x: number, y: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.id })
  return (
    <div
      ref={setNodeRef}
      style={{
        width: '100%', minWidth: 0,
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      <AppIcon app={app} opened={opened} labelTone={labelTone} onOpen={onOpen} onMenu={onMenu} />
    </div>
  )
}

// Размеры меню известны заранее — по ним раздел решает, в какую сторону его раскрывать (см.
// onIconMenu). Мерить фактическую высоту после отрисовки значило бы показать меню за краем и
// дёрнуть его на следующем кадре; два пункта плюс заголовок дают предсказуемые ~104 px.
export const ICON_MENU_WIDTH = 168
export const ICON_MENU_HEIGHT = 104
export const ICON_MENU_EDGE = 8

// Меню у иконки (ПКМ). Своё, а не системное контекстное меню Electron: пункты зависят от того,
// СВОЁ приложение или встроенное, и рисовать их надо там же, где живёт остальной интерфейс
// панели, — своим стеклом и своими токенами, а не серым системным списком.
export function IconMenu({ app, x, y, opened, onOpen, onClose, onHide, onRemove, onDismiss }: {
  app: AppDef
  x: number
  y: number
  opened: boolean
  onOpen: () => void
  onClose: () => void
  onHide: () => void
  onRemove: () => void
  onDismiss: () => void
}) {
  // Своё приложение человек добавил сам — его можно удалить насовсем. Встроенное только прячется.
  const isCustom = app.id.startsWith('web:custom-')
  const items: { label: string; act: () => void; danger?: boolean }[] = [
    opened
      ? { label: 'Закрыть', act: onClose }
      : { label: 'Открыть', act: onOpen },
    isCustom
      ? { label: 'Удалить', act: onRemove, danger: true }
      : { label: 'Скрыть с экрана', act: onHide },
  ]
  return (
    <>
      {/* Подложка на весь раздел: клик мимо закрывает меню. Отдельным слоем, а не слушателем на
          document, — так не надо гадать, чей клик «мимо», и меню не переживает перерисовку. */}
      <div
        onClick={onDismiss}
        onContextMenu={(e) => { e.preventDefault(); onDismiss() }}
        style={{ position: 'absolute', inset: 0, zIndex: 3 }}
      />
      <div style={{
        position: 'absolute', left: x, top: y, zIndex: 4, width: ICON_MENU_WIDTH, padding: 4,
        background: 'var(--surface-solid)', borderRadius: 'var(--radius-card)',
        border: '1px solid var(--glass-edge)', boxShadow: 'var(--shadow-card)',
      }}>
        <div style={{
          padding: '4px 8px 6px', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {app.label}
        </div>
        {items.map((it) => (
          <button
            key={it.label}
            onClick={it.act}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '7px 8px', border: 'none', borderRadius: 'var(--radius-sm)',
              background: 'transparent', cursor: 'pointer',
              fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
              color: it.danger ? 'var(--danger-500)' : 'var(--text-body)',
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  )
}

export function HomeGrid({ apps, openApps, onOpen, onReorder, onIconMenu, widgets, weatherCity, labelTone }: {
  apps: AppDef[]
  openApps: AppId[]
  onOpen: (id: AppId) => void
  /** Новый порядок иконок целиком — перетаскивание завершилось. */
  onReorder: (ids: string[]) => void
  /** ПКМ по иконке — координаты окна, меню рисует раздел (ему известны его границы). */
  onIconMenu: (app: AppDef, x: number, y: number) => void
  widgets: WidgetsConfig
  weatherCity: string
  labelTone: LabelTone
}) {
  // Тащим — призрак под курсором (DragOverlay), соседи расступаются сами (rectSortingStrategy).
  // ⚠️ activationConstraint.distance обязателен: без него первое же нажатие на иконку считалось бы
  // началом перетаскивания и обычный клик перестал бы открывать приложение. 5 px — как в сайдбаре.
  const [dragId, setDragId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const dragged = apps.find((a) => a.id === dragId) ?? null

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null)
    const overId = e.over?.id
    if (!overId || overId === e.active.id) return
    const ids = apps.map((a) => a.id)
    const from = ids.indexOf(String(e.active.id))
    const to = ids.indexOf(String(overId))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(ids, from, to))
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 2px' }}>
      {(widgets.weather || widgets.currency) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {widgets.weather && <WeatherWidget city={weatherCity} />}
          {widgets.currency && <CurrencyWidget />}
        </div>
      )}
      {/* ⚠️ Стрелки ходят по сетке ЗДЕСЬ, а не глобальным слушателем на документе: фокусом
          владеет сама кнопка-иконка, и пока он не на ней, стрелки должны оставаться стрелками
          (прокрутка страницы, поле ввода чата рядом). Enter/пробел открывают сами — это кнопка. */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))}
        onDragCancel={() => setDragId(null)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={apps.map((a) => a.id)} strategy={rectSortingStrategy}>
          <div
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' ? 1
                : e.key === 'ArrowLeft' ? -1
                  : e.key === 'ArrowDown' ? GRID_COLUMNS
                    : e.key === 'ArrowUp' ? -GRID_COLUMNS
                      : 0
              if (step === 0) return
              const items = [...e.currentTarget.querySelectorAll('button')]
              const from = items.indexOf(document.activeElement as HTMLButtonElement)
              if (from < 0) return
              const to = from + step
              if (to < 0 || to >= items.length) return // за край не уходим: заворот сбивает с толку
              e.preventDefault()
              items[to].focus()
            }}
            style={{
              display: 'grid', gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
              rowGap: 16, columnGap: 8, justifyItems: 'center',
            }}
          >
            {apps.map((app) => (
              <SortableAppIcon
                key={app.id}
                app={app}
                opened={openApps.includes(app.id)}
                labelTone={labelTone}
                onOpen={() => onOpen(app.id)}
                onMenu={(x, y) => onIconMenu(app, x, y)}
              />
            ))}
          </div>
        </SortableContext>
        {/* Призрак под курсором — иначе иконка «прыгает» на место лишь в конце жеста, и человек
            не понимает, тащит он что-то или нет (ровно эта жалоба и была). */}
        <DragOverlay dropAnimation={null}>
          {dragged && <AppIcon app={dragged} opened={false} labelTone={labelTone} dragging />}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
