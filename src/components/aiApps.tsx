// Раздел «Приложения» AI-панели — «домашний экран» в стиле iOS: обои, сетка иконок-сквирклов,
// до ДВУХ одновременно открытых приложений в вертикальных слотах (верхний/нижний). Заход 1 —
// только локальные приложения (калькулятор/конвертер/таймер/пипетка), целиком в renderer'е
// панели: ни IPC, ни main этот файл не трогает. Веб-приложения (чужие сайты в WebContentsView)
// и виджеты с сетевыми данными — следующие заходы, см. план в истории задач.
// Живёт в src/components (как aiMarkdown.tsx) — импортируется ТОЛЬКО из aipanel.tsx, в дерево
// App.tsx не входит. Все цвета — токены (включая градиенты иконок/обоев — tokens/apps.css).
import React, { useCallback, useEffect, useState } from 'react'
// Та же связка, что держит порядок вкладок и закреплённых в сайдбаре: свой HTML5 drag-and-drop
// на этой сетке выглядел чужеродно (иконка не едет за курсором, соседи не расступаются, а цель
// надо угадывать), а здесь ровно та же задача — порядок в одном списке.
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
// Арифметика калькулятора, формат числа, правило процента и разбор вставленного числа — чистая
// логика, живёт в shared под проверкой (scripts/calc-check.mjs): ломается она на реальных случаях
// («50 + 10 %», «1 234,56 ₽»), а не на глаз.
import { CAPS } from '../styles/system'
import { WALLPAPER_PRESETS } from '../newtab/settings'
import { allMeshes, subscribeMeshes, meshCss } from '../newtab/gradients'
import {
  Calculator, RefreshCw, Timer, Pipette, X, SlidersHorizontal, ImagePlus, Languages, Cat, Type,
  Check, Globe, Plus,
} from 'lucide-react'
export { AppIconBadge } from './apps/AppIconBadge'
import { AppIconBadge } from './apps/AppIconBadge'
import { useSlotSplit } from './apps/useSlotSplit'
import { useOpenSlots } from './apps/useOpenSlots'
import { useAppsRegistry } from './apps/useAppsRegistry'
import { HomeGrid, IconMenu, ICON_MENU_WIDTH, ICON_MENU_HEIGHT, ICON_MENU_EDGE } from './apps/HomeGrid'
import { SlotDivider, AppSlot, WebAppSlot } from './apps/slots'
export type { AppId, AppDef, CurrencyRatesResult, WeatherResult } from './apps/types'
import type { AppDef } from './apps/types'
import {
  hostOf, getCustomWallpaper, saveCustomWallpaper,
  wallpaperIsLight, wallpaperTitle,
  loadWidgets, saveWidgets, loadWeatherCity, saveWeatherCity,
  type WidgetsConfig,
} from './apps/storage'
export {
  getCustomWallpaper, loadWallpaper, saveWallpaper, wallpaperBackground,
  wallpaperIsLight, wallpaperTitle,
} from './apps/storage'
export type { WidgetsConfig } from './apps/storage'
// Тот же тумблер, что в настройках браузера: состояние «включено» обязано выглядеть
// одинаково везде, а пилюля-кнопка означает действие и для состояния не годится.
import Toggle from './Toggle'
// Значок погоды и словесное состояние — те же, что на столе (см. weatherIcon.tsx).

// Форма ответа ai-panel:currency-rates (electron/CurrencyRates.ts) — зеркалим локально,
// тот же приём, что у ChatOutcome в aipanel.tsx (ad-hoc канал, не через shared/ipc.ts).

// EyeDropper — Chromium API взятия цвета с экрана; в lib.dom текущего TS его нет, объявляем
// сами (необязательное поле — на старых окружениях фича просто прячется, см. ColorApp).
declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> }
  }
}

// ── Реестр приложений ────────────────────────────────────────────────────────────────────────
// kind 'local' — React-компонент внутри панели; 'web' — чужой сайт в отдельной WebContentsView
// (заход 3, см. WebAppSlot ниже и electron/WebAppManager.ts). Пользовательские веб-приложения
// добавляются в этот же список динамически (см. loadCustomApps).
export const APPS: AppDef[] = [
  { id: 'calc', label: 'Калькулятор', kind: 'local', icon: Calculator, gradient: 'var(--appicon-calc)' },
  { id: 'convert', label: 'Конвертер', kind: 'local', icon: RefreshCw, gradient: 'var(--appicon-convert)' },
  // Пояса — конвертер времени со сдвигом. ⚠️ Без сети: перевод времени это вычисление, и вся
  // база поясов лежит в ICU. Сайты-конвертеры выглядят источником данных, но данных там нет.
  { id: 'zones', label: 'Пояса', kind: 'local', icon: Globe, gradient: 'var(--appicon-zones)' },
  { id: 'timer', label: 'Таймер', kind: 'local', icon: Timer, gradient: 'var(--appicon-timer)' },
  { id: 'color', label: 'Пипетка', kind: 'local', icon: Pipette, gradient: 'var(--appicon-color)' },
  // Котёнок-тамагочи — основа будущего маскота (см. KittenApp).
  { id: 'kitten', label: 'Котёнок', kind: 'local', icon: Cat, gradient: 'var(--appicon-kitten)' },
  { id: 'counter', label: 'Счётчик', kind: 'local', icon: Type, gradient: 'var(--appicon-counter)' },
  // Переводчик — «как обычный сайт», намеренно НЕ через API (см. задачу): полный Яндекс.Переводчик
  // со всеми его фичами, логином и т.п.
  { id: 'web:yandex-translate', label: 'Переводчик', kind: 'web', icon: Languages, gradient: 'var(--appicon-web)', url: 'https://translate.yandex.ru/' },
]

// Пользовательские веб-приложения (любой URL) — хранятся так же, как остальная косметика панели.
// ── Части листа настроек ─────────────────────────────────────────────────────────────────────
// ⚠️ Вкладки, а не три блока подряд: один экран — один вопрос. Разбор — в docs и в комментарии
// у самой разметки.
type SheetTab = 'bg' | 'widgets' | 'apps'
const SHEET_TABS: { id: SheetTab; label: string }[] = [
  { id: 'bg', label: 'Фон' },
  { id: 'widgets', label: 'Виджеты' },
  { id: 'apps', label: 'Приложения' },
]

// Плитки фона идут в пропорции экрана, а не кружками: кружок 28 px не показывает, как выглядит
// фон, и не оставляет места подписи.
const WALL_GRID: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 6,
}

/** Подпись группы внутри листа — та же моноширинная капса, что и везде в системе. */
function SheetLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ ...CAPS, color: 'var(--text-faint)' }}>{children}</span>
}

/** Строка «название + пояснение + управление»: состояние объясняется словами, а не цветом. */
function SheetRow({ title, hint, control }: {
  title: string
  hint?: string
  control: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 550, color: 'var(--text-strong)' }}>{title}</div>
        {hint && (
          <div style={{
            fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{hint}</div>
        )}
      </div>
      {control}
    </div>
  )
}

/** Плитка фона. Выбранная помечена ГАЛОЧКОЙ, а не только кромкой: кромку на тёмной краске видно плохо. */
function WallSwatch({ css, label, on, onPick }: {
  css: string
  label: string
  on: boolean
  onPick: () => void
}) {
  return (
    <button
      onClick={onPick}
      title={label}
      aria-pressed={on}
      style={{
        position: 'relative', height: 38, padding: 0, cursor: 'pointer',
        borderRadius: 'var(--radius-sm)',
        backgroundImage: css, backgroundColor: 'var(--surface-sunken)',
        backgroundSize: 'cover', backgroundPosition: 'center',
        border: on ? '2px solid var(--accent)' : '1px solid var(--glass-edge)',
      }}
    >
      {on && (
        <span style={{
          position: 'absolute', right: 3, bottom: 2, display: 'inline-flex',
          color: '#FFFFFF', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
        }}>
          <Check size={12} strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

// ── Корень раздела ───────────────────────────────────────────────────────────────────────────
// Обои сюда приходят пропсами: стейт живёт в aipanel.tsx, потому что обоями красится весь
// остров панели (включая фон за шапкой), а не только эта область.
export function AppsMode({ wallpaper, onSelectWallpaper, requestedApp, onRequestHandled }: {
  wallpaper: string
  onSelectWallpaper: (id: string) => void
  /** Приложение, запрошенное снаружи (иконка на рабочем столе новой вкладки). */
  requestedApp?: string | null
  onRequestHandled?: () => void
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetTab, setSheetTab] = useState<SheetTab>('bg')
  // Поля добавления сайта развёрнуты только по просьбе — пустыми они занимали место обещанием.
  const [addOpen, setAddOpen] = useState(false)
  const [widgets, setWidgets] = useState<WidgetsConfig>(loadWidgets)
  const [weatherCity, setWeatherCity] = useState<string>(loadWeatherCity)
  const [cityDraft, setCityDraft] = useState(weatherCity)
  const [newAppName, setNewAppName] = useState('')
  const [newAppUrl, setNewAppUrl] = useState('')
  const [meshes, setMeshes] = useState(() => allMeshes())
  useEffect(() => subscribeMeshes(() => setMeshes(allMeshes())), [])

  // Меню у иконки (ПКМ): что за приложение и где рисовать. Координаты — относительно раздела.
  const [iconMenu, setIconMenu] = useState<{ app: AppDef; x: number; y: number } | null>(null)
  // Открытые слоты, активный из них и клавиатура — в useOpenSlots.
  const { openApps, activeApp, setActiveApp, openApp, closeApp, swapSlots } = useOpenSlots({
    requestedApp,
    onRequestHandled,
    // ⚠️ Esc сначала предлагается тому, что «поверх» экрана, и порядок здесь неслучаен: меню у
    // иконки поверх листа настроек, лист — поверх слотов.
    consumeEscape: useCallback(() => {
      if (iconMenu) { setIconMenu(null); return true }
      if (sheetOpen) { setSheetOpen(false); return true }
      return false
    }, [iconMenu, sheetOpen]),
  })

  // Что стоит на экране (встроенные + свои веб-приложения, порядок, спрятанные) — в
  // useAppsRegistry.
  const {
    customApps, everyApp, allApps, hiddenApps,
    hideApp, unhideApp, reorderApps, addCustomApp, removeCustomApp,
  } = useAppsRegistry({
    newAppName, newAppUrl,
    onAdded: () => { setNewAppName(''); setNewAppUrl('') },
    closeApp,
  })

  // Перетаскивание слотов: тот же порог в 5 px, что у иконок, — иначе нажатие на шапку (кнопки
  // свопа и закрытия живут там же) считалось бы началом жеста.
  const slotSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [draggingSlot, setDraggingSlot] = useState(false)

  // Шит рисуется только пока виден домашний экран; отдельный флаг нужен и веб-слотам —
  // WebContentsView лежит ПОВЕРХ панели, открытый шит иначе оказался бы под сайтом.
  const sheetVisible = sheetOpen && openApps.length < 2

  // Доля слотов и жест разделителя — в useSlotSplit. resizing оттуда прячет веб-слоты на время
  // жеста (разбор — в самом хуке).
  const { slotsRef, splitRatio, resizing, startResize } = useSlotSplit()

  const toggleWidget = (key: keyof WidgetsConfig) => {
    setWidgets((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      saveWidgets(next)
      return next
    })
  }
  const applyCity = () => {
    const v = cityDraft.trim()
    if (!v || v === weatherCity) return
    setWeatherCity(v)
    saveWeatherCity(v)
  }

  // Своя картинка на обои. Ужимаем канвасом до 1280×2560 (jpeg 0.85) — иначе фото с телефона
  // (5–10 МБ) не влезло бы в localStorage и тормозило бы рендер фона; createImageBitmap с
  // imageOrientation — чтобы вертикальные снимки не ложились на бок (EXIF-поворот).
  const [customWallpaper, setCustomWallpaper] = useState<string | null>(getCustomWallpaper)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const handleWallpaperFile = async (file: File) => {
    setUploadError(null)
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      const scale = Math.min(1, 1280 / bmp.width, 2560 / bmp.height)
      const w = Math.max(1, Math.round(bmp.width * scale))
      const h = Math.max(1, Math.round(bmp.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas недоступен')
      ctx.drawImage(bmp, 0, 0, w, h)
      bmp.close()
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      saveCustomWallpaper(dataUrl)
      setCustomWallpaper(dataUrl)
      onSelectWallpaper('custom')
    } catch (e) {
      setUploadError(`Не удалось поставить картинку: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Раскладка «как телефон»: 0 открытых — вся площадь под сеткой иконок; 1 — приложение сверху,
  // сетка снизу (выбрать второе); 2 — оба слота заняты, сетка скрыта до закрытия одного (крестик
  // в шапке слота). Обои — фон всего острова (см. aipanel.tsx), слоты «парят» над ними карточками.
  return (
    <div ref={slotsRef} style={{
      flex: 1, minHeight: 0, marginTop: 10, position: 'relative',
      display: 'flex', flexDirection: 'column', gap: 10, padding: 12,
    }}>
      {/* Перетаскивание слотов — та же dnd-kit, что у иконок и у вкладок сайдбара.
          ⚠️ Тянут за шапку (там listeners), а ПРИНИМАЕТ дроп ВЕСЬ слот целиком: раньше цель
          была только шапкой, и приложение приходилось тащить «до самого верха» соседа — жест,
          который надо угадывать.
          ⚠️ На время жеста веб-слоты прячутся: их WebContentsView лежит поверх панели и не
          отдаёт ей событий указателя — ровно та же причина, что у разделителя размера. */}
      <DndContext
        sensors={slotSensors}
        collisionDetection={closestCenter}
        onDragStart={() => setDraggingSlot(true)}
        onDragCancel={() => setDraggingSlot(false)}
        onDragEnd={(e) => {
          setDraggingSlot(false)
          if (e.over && e.over.id !== e.active.id) swapSlots()
        }}
      >
        <SortableContext items={openApps} strategy={verticalListSortingStrategy}>
          {/* ⚠️ ПЛОСКИЙ список, а не «второй слот, обёрнутый вместе с разделителем». Обёртка
              стоила бага: при перестановке слот менял МЕСТО В ДЕРЕВЕ (был внутри Fragment — стал
              снаружи), React считал это другим элементом и пересоздавал приложение — конвертер
              терял выбранную пару валют и набранные числа, калькулятор — свой счёт. В плоском
              списке ключи совпадают, и React переставляет узлы, а не рождает их заново. */}
          {openApps.flatMap((id, slotIndex) => {
            const app = allApps.find((a) => a.id === id)
            if (!app) return []
            const both = openApps.length === 2
            const onSwap = both ? swapSlots : undefined
            // Доля высоты действует только когда открыты ОБА: с одним приложением второй
            // половиной владеет сетка иконок, и её долю человек не двигал.
            const grow = both ? (slotIndex === 0 ? splitRatio : 1 - splitRatio) : 1
            // ⚠️ «Активен» и «нарисовать рамку» — РАЗНЫЕ вещи. Единственное открытое приложение
            // активно всегда (клавиши обязаны идти в него), но подсвечивать нечего: выбора нет.
            const active = both ? activeApp === id : true
            const onActivate = () => setActiveApp(id)
            const slot = app.kind === 'web'
              ? <WebAppSlot key={id} app={app} slotIndex={slotIndex} grow={grow}
                  active={active} showRing={both && active} onActivate={onActivate}
                  hidden={sheetVisible || resizing || draggingSlot}
                  onSwap={onSwap} onClose={() => closeApp(id)} />
              : <AppSlot key={id} app={app} grow={grow}
                  active={active} showRing={both && active} onActivate={onActivate}
                  onSwap={onSwap} onClose={() => closeApp(id)} />
            // Разделитель — отдельный элемент того же списка, со своим постоянным ключом.
            return slotIndex === 1
              ? [<SlotDivider key="slot-divider" onPointerDown={startResize} active={resizing} />, slot]
              : [slot]
          })}
        </SortableContext>
      </DndContext>

      {openApps.length < 2 && (
        <HomeGrid
          apps={allApps}
          openApps={openApps}
          onOpen={openApp}
          onReorder={reorderApps}
          // ⚠️ Меню прижимается к границам раздела ЗДЕСЬ, при вычислении координат, а не CSS'ом:
          // панель узкая (от 320 px), и меню, вызванное на правой или нижней иконке, вылезало за
          // край — часть пунктов просто не было видно. Вылезает вправо — открываем влево от
          // курсора, вылезает вниз — вверх; в упор к краю оставляем поле в 8 px.
          onIconMenu={(app, x, y) => {
            const box = slotsRef.current?.getBoundingClientRect()
            if (!box) return
            const localX = x - box.left
            const localY = y - box.top
            const flipX = localX + ICON_MENU_WIDTH + ICON_MENU_EDGE > box.width
            const flipY = localY + ICON_MENU_HEIGHT + ICON_MENU_EDGE > box.height
            setIconMenu({
              app,
              x: Math.max(ICON_MENU_EDGE, flipX ? localX - ICON_MENU_WIDTH : localX),
              y: Math.max(ICON_MENU_EDGE, flipY ? localY - ICON_MENU_HEIGHT : localY),
            })
          }}
          widgets={widgets}
          weatherCity={weatherCity}
          labelTone={wallpaper === 'none' ? 'theme' : wallpaperIsLight(wallpaper) ? 'dark' : 'light'}
        />
      )}

      {iconMenu && (
        <IconMenu
          app={iconMenu.app}
          x={iconMenu.x}
          y={iconMenu.y}
          opened={openApps.includes(iconMenu.app.id)}
          onOpen={() => { openApp(iconMenu.app.id); setIconMenu(null) }}
          onClose={() => { closeApp(iconMenu.app.id); setIconMenu(null) }}
          onHide={() => { hideApp(iconMenu.app.id); setIconMenu(null) }}
          onRemove={() => { removeCustomApp(iconMenu.app.id); setIconMenu(null) }}
          onDismiss={() => setIconMenu(null)}
        />
      )}

      {/* «Настроить» (обои/виджеты/город) — доступна, пока виден хоть кусок домашнего экрана
          (оба слота заняты → экрана всё равно почти нет, кнопка только мешала бы приложению). */}
      {openApps.length < 2 && (
        <div style={{
          position: 'absolute', right: 10, bottom: 10, left: 10, zIndex: 1,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
          pointerEvents: 'none', // сам контейнер прозрачен для кликов, ловят только дети
        }}>
          {sheetOpen && (
            <div style={{
              alignSelf: 'stretch', pointerEvents: 'auto',
              display: 'flex', flexDirection: 'column', gap: 10, padding: 12,
              // Лист не выше половины панели: он настраивает экран, который сам же и закрывает.
              maxHeight: '58vh', overflowY: 'auto',
              background: 'var(--surface-solid)', borderRadius: 'var(--radius-card)',
              border: '1px solid var(--glass-edge)', boxShadow: 'var(--shadow-card)',
            }}>
              {/* ⚠️ Заголовок называет ПРЕДМЕТ, а не жанр. Прежнее «Настройки» читалось как
                  настройки браузера — а это косметика одного экрана, и у браузера есть свои. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                  Экран приложений
                </span>
                <button
                  onClick={() => setSheetOpen(false)}
                  title="Закрыть настройки"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, flexShrink: 0, padding: 0,
                    background: 'var(--surface-sunken)', border: 'none', borderRadius: '50%',
                    color: 'var(--text-muted)', cursor: 'pointer',
                  }}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>

              {/* ⚠️ Три вкладки вместо трёх блоков подряд: один экран — один вопрос. В одном
                  столбце фон, виджеты и приложения читались как одна лента, в которой подписи
                  разделов ничем не сильнее подписей полей. */}
              <div role="tablist" style={{
                display: 'flex', gap: 2, padding: 3, flexShrink: 0,
                background: 'var(--surface-sunken)', borderRadius: 'var(--radius-pill)',
              }}>
                {SHEET_TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={sheetTab === t.id}
                    onClick={() => setSheetTab(t.id)}
                    style={{
                      flex: 1, padding: '6px 10px', border: 'none', cursor: 'pointer',
                      borderRadius: 'var(--radius-pill)',
                      background: sheetTab === t.id ? 'var(--surface-solid)' : 'transparent',
                      boxShadow: sheetTab === t.id ? 'var(--shadow-chip)' : 'none',
                      color: sheetTab === t.id ? 'var(--text-strong)' : 'var(--text-muted)',
                      fontSize: 'var(--fs-xs)', fontWeight: 600, fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* ── ФОН ─────────────────────────────────────────────────────────────── */}
              {sheetTab === 'bg' && (
                <>
                  {/* ⚠️ Плитка в пропорции экрана, а не кружок 28 px: кружок не показывает, как
                      будет выглядеть фон, и не оставляет места подписи. Группы — потому что
                      краска, бумага и картинка выбираются по разным поводам. */}
                  <SheetLabel>Плакат</SheetLabel>
                  <div style={WALL_GRID}>
                    {WALLPAPER_PRESETS.filter((w) => !w.id.startsWith('paper')).map((w) => (
                      <WallSwatch key={w.id} css={w.css} label={w.label}
                        on={w.id === wallpaper} onPick={() => onSelectWallpaper(w.id)} />
                    ))}
                  </div>
                  <SheetLabel>Бумага</SheetLabel>
                  <div style={WALL_GRID}>
                    {WALLPAPER_PRESETS.filter((w) => w.id.startsWith('paper')).map((w) => (
                      <WallSwatch key={w.id} css={w.css} label={w.label}
                        on={w.id === wallpaper} onPick={() => onSelectWallpaper(w.id)} />
                    ))}
                  </div>
                  <SheetLabel>Живые и своё</SheetLabel>
                  <div style={WALL_GRID}>
                    <WallSwatch css="var(--surface-solid)" label="Без обоев"
                      on={wallpaper === 'none'} onPick={() => onSelectWallpaper('none')} />
                    {meshes.map((m) => (
                      <WallSwatch key={m.id} css={meshCss(m)} label={m.name}
                        on={m.id === wallpaper} onPick={() => onSelectWallpaper(m.id)} />
                    ))}
                    {customWallpaper !== null && (
                      <WallSwatch css={'url(' + customWallpaper + ')'} label="Своя картинка"
                        on={wallpaper === 'custom'} onPick={() => onSelectWallpaper('custom')} />
                    )}
                    {/* label оборачивает скрытый file-input — тот же приём, что «Палитра» в пипетке. */}
                    <label
                      title="Загрузить свою картинку"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        height: 38, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        background: 'var(--surface-sunken)', border: '1px dashed var(--divider-strong)',
                        color: 'var(--text-muted)', position: 'relative',
                      }}
                    >
                      <ImagePlus size={14} />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          // Сброс value — иначе повторный выбор ТОГО ЖЕ файла не даст события change.
                          e.target.value = ''
                          if (file) void handleWallpaperFile(file)
                        }}
                        style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
                      />
                    </label>
                  </div>
                  {uploadError !== null && (
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger-500)' }}>{uploadError}</span>
                  )}
                  {/* Что именно выбрано — словами: кромка вокруг плитки отвечает «который», а не «какой». */}
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
                    {wallpaperTitle(wallpaper, meshes)}
                    {wallpaper !== 'none' && wallpaper !== 'custom'
                      && (wallpaperIsLight(wallpaper) ? ' · светлый фон, подписи тёмные' : ' · тёмный фон, подписи светлые')}
                  </span>
                </>
              )}

              {/* ── ВИДЖЕТЫ ─────────────────────────────────────────────────────────── */}
              {sheetTab === 'widgets' && (
                <>
                  {/* ⚠️ Тумблер, а не пилюля: пилюля — язык действия («нажми»), а здесь состояние
                      («включено»). По серой пилюле было не решить, выключено оно или недоступно. */}
                  <SheetRow
                    title="Погода"
                    hint={widgets.weather && weatherCity
                      ? weatherCity + ' · обновляется раз в 15 минут'
                      : 'Температура и состояние на сегодня'}
                    control={<Toggle checked={widgets.weather} onChange={() => toggleWidget('weather')} />}
                  />
                  {widgets.weather && (
                    <div style={{ paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <SheetLabel>Город</SheetLabel>
                      {/* ⚠️ Кнопки «ОК» больше нет: она не говорила, что произойдёт, и гасла по
                          невидимому правилу. Сохраняет Enter и уход из поля. */}
                      <input
                        value={cityDraft}
                        onChange={(e) => setCityDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') applyCity() }}
                        onBlur={applyCity}
                        placeholder="Например, Краснодар"
                        style={{
                          border: 'none', outline: 'none',
                          borderRadius: 'var(--radius-sm)', padding: '7px 10px',
                          background: 'var(--surface-sunken)', color: 'var(--text-strong)',
                          fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
                        }}
                      />
                    </div>
                  )}
                  <SheetRow
                    title="Курс валют"
                    hint="ЦБ РФ · доллар и евро"
                    control={<Toggle checked={widgets.currency} onChange={() => toggleWidget('currency')} />}
                  />
                </>
              )}

              {/* ── ПРИЛОЖЕНИЯ ──────────────────────────────────────────────────────── */}
              {sheetTab === 'apps' && (
                <>
                  {/* ⚠️ ВСЕ приложения одним списком — и встроенные, и свои. Раньше спрятать можно
                      было из меню иконки, а вернуть только отсюда: две двери в одну комнату,
                      причём вторая появлялась и исчезала сама. */}
                  {everyApp.map((a) => {
                    const on = !hiddenApps.includes(a.id)
                    const own = customApps.some((c) => c.id === a.id)
                    return (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <AppIconBadge app={a} size={22} iconSize={13} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 'var(--fs-sm)', fontWeight: 550, color: 'var(--text-strong)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{a.label}</div>
                          {(own || !on) && (
                            <div style={{
                              fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{own ? hostOf(a.url ?? '') : 'скрыто с экрана'}</div>
                          )}
                        </div>
                        <Toggle checked={on} onChange={() => { if (on) hideApp(a.id); else unhideApp(a.id) }} />
                        {own && (
                          <button
                            onClick={() => removeCustomApp(a.id)}
                            title="Удалить приложение"
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              width: 20, height: 20, flexShrink: 0, padding: 0,
                              background: 'transparent', border: 'none', borderRadius: '50%',
                              color: 'var(--text-faint)', cursor: 'pointer',
                            }}
                          >
                            <X size={12} strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    )
                  })}

                  {/* ⚠️ Поля добавления развёрнуты не всегда: три пустых поля внизу списка
                      занимали место обещанием, которым пользуются раз в месяц. */}
                  {!addOpen ? (
                    <button
                      onClick={() => setAddOpen(true)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 0',
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: 'var(--accent)', fontSize: 'var(--fs-sm)', fontWeight: 600,
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      <Plus size={14} /> Добавить сайт
                    </button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input
                        value={newAppName}
                        onChange={(e) => setNewAppName(e.target.value)}
                        placeholder="Название (необязательно)"
                        style={{
                          border: 'none', outline: 'none',
                          borderRadius: 'var(--radius-sm)', padding: '7px 10px',
                          background: 'var(--surface-sunken)', color: 'var(--text-strong)',
                          fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
                        }}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          value={newAppUrl}
                          onChange={(e) => setNewAppUrl(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { addCustomApp(); setAddOpen(false) } }}
                          autoFocus
                          placeholder="Адрес сайта"
                          style={{
                            flex: 1, minWidth: 0, border: 'none', outline: 'none',
                            borderRadius: 'var(--radius-sm)', padding: '7px 10px',
                            background: 'var(--surface-sunken)', color: 'var(--text-strong)',
                            fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
                          }}
                        />
                        <button
                          onClick={() => { addCustomApp(); setAddOpen(false) }}
                          disabled={newAppUrl.trim() === ''}
                          style={{
                            padding: '0 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                            background: 'var(--accent)', color: 'var(--text-on-accent)',
                            fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
                            opacity: newAppUrl.trim() === '' ? 0.45 : 1,
                          }}
                        >
                          Добавить
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <button
            onClick={() => setSheetOpen((v) => !v)}
            title="Обои и виджеты"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px',
              pointerEvents: 'auto',
              borderRadius: 'var(--radius-pill)', border: '1px solid var(--glass-edge)',
              background: 'var(--surface-solid)', color: 'var(--text-body)',
              fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer',
              boxShadow: 'var(--shadow-chip)',
            }}
          >
            <SlidersHorizontal size={13} /> Настроить
          </button>
        </div>
      )}
    </div>
  )
}
