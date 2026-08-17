// Раздел «Приложения» AI-панели — «домашний экран» в стиле iOS: обои, сетка иконок-сквирклов,
// до ДВУХ одновременно открытых приложений в вертикальных слотах (верхний/нижний). Заход 1 —
// только локальные приложения (калькулятор/конвертер/таймер/пипетка), целиком в renderer'е
// панели: ни IPC, ни main этот файл не трогает. Веб-приложения (чужие сайты в WebContentsView)
// и виджеты с сетевыми данными — следующие заходы, см. план в истории задач.
// Живёт в src/components (как aiMarkdown.tsx) — импортируется ТОЛЬКО из aipanel.tsx, в дерево
// App.tsx не входит. Все цвета — токены (включая градиенты иконок/обоев — tokens/apps.css).
import React, { useEffect, useRef, useState } from 'react'
// Та же связка, что держит порядок вкладок и закреплённых в сайдбаре: свой HTML5 drag-and-drop
// на этой сетке выглядел чужеродно (иконка не едет за курсором, соседи не расступаются, а цель
// надо угадывать), а здесь ровно та же задача — порядок в одном списке.
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
// Арифметика калькулятора, формат числа, правило процента и разбор вставленного числа — чистая
// логика, живёт в shared под проверкой (scripts/calc-check.mjs): ломается она на реальных случаях
// («50 + 10 %», «1 234,56 ₽»), а не на глаз.
import { computeCalc, fmtCalc, calcDisp, resolvePercent, parsePastedNumber } from '../../shared/calc'
import type { CalcOp } from '../../shared/calc'
import {
  Calculator, RefreshCw, Timer, Pipette, X, SlidersHorizontal, ImagePlus, Languages, Cat, Type,
  Play, Pause, RotateCcw, ArrowDownUp, ArrowUpDown, Copy, Check, Loader2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AppGlyph, hasGlyph } from './appGlyphs'

// Форма ответа ai-panel:currency-rates (electron/CurrencyRates.ts) — зеркалим локально,
// тот же приём, что у ChatOutcome в aipanel.tsx (ad-hoc канал, не через shared/ipc.ts).
export interface CurrencyRatesResult {
  ok: boolean
  date?: string
  rates?: Record<string, number>
  error?: string
}

// Форма ответа ai-panel:weather (electron/WeatherService.ts) — тот же приём.
export interface WeatherResult {
  ok: boolean
  city?: string
  tempC?: number
  weatherCode?: number
  windKmh?: number
  error?: string
}

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
export type AppId = string

export interface AppDef {
  id: AppId
  label: string
  kind: 'local' | 'web'
  icon: LucideIcon | null // null — буквенная иконка (пользовательские веб-приложения)
  gradient: string // токен из tokens/apps.css — не сырой цвет
  url?: string // только для kind 'web'
}

export const APPS: AppDef[] = [
  { id: 'calc', label: 'Калькулятор', kind: 'local', icon: Calculator, gradient: 'var(--appicon-calc)' },
  { id: 'convert', label: 'Конвертер', kind: 'local', icon: RefreshCw, gradient: 'var(--appicon-convert)' },
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
interface CustomWebApp { id: string; name: string; url: string }
const CUSTOM_APPS_KEY = 'aipanel-apps-webapps'

function loadCustomApps(): CustomWebApp[] {
  try {
    const raw = localStorage.getItem(CUSTOM_APPS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is CustomWebApp =>
          !!x && typeof x === 'object'
          && typeof (x as CustomWebApp).id === 'string'
          && typeof (x as CustomWebApp).name === 'string'
          && typeof (x as CustomWebApp).url === 'string')
      }
    }
  } catch { /* см. loadWallpaper */ }
  return []
}
function saveCustomApps(list: CustomWebApp[]): void {
  try { localStorage.setItem(CUSTOM_APPS_KEY, JSON.stringify(list)) } catch { /* см. loadWallpaper */ }
}
function customToDef(c: CustomWebApp): AppDef {
  return { id: c.id, label: c.name, kind: 'web', icon: null, gradient: 'var(--appicon-webcustom)', url: c.url }
}

// ── Порядок иконок на домашнем экране ────────────────────────────────────────────────────────
// Хранится СПИСКОМ id, а не индексами: набор приложений меняется (встроенные добавляются с
// обновлениями, свои — руками), и любой индекс от этого протух бы молча.
// ⚠️ Неизвестные id дописываются В КОНЕЦ в их естественном порядке, а сохранённые, которых больше
// нет, просто игнорируются. Поэтому новое приложение появляется на экране, а удалённое не
// оставляет дырки — без всякой миграции хранилища.
const APPS_ORDER_KEY = 'aipanel-apps-order'

function loadAppsOrder(): string[] {
  try {
    const raw = localStorage.getItem(APPS_ORDER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch { /* см. loadWallpaper */ }
  return []
}
function saveAppsOrder(order: string[]): void {
  try { localStorage.setItem(APPS_ORDER_KEY, JSON.stringify(order)) } catch { /* см. loadWallpaper */ }
}
// ── Спрятанные с экрана приложения ───────────────────────────────────────────────────────────
// Встроенное приложение удалить нельзя (оно часть браузера), но и держать на глазах то, чем не
// пользуешься, незачем — поэтому «скрыть», с возвратом из «Настроить». Своё веб-приложение
// удаляется по-настоящему: его добавил человек, ему и решать.
const HIDDEN_APPS_KEY = 'aipanel-apps-hidden'

function loadHiddenApps(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_APPS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch { /* см. loadWallpaper */ }
  return []
}
function saveHiddenApps(ids: string[]): void {
  try { localStorage.setItem(HIDDEN_APPS_KEY, JSON.stringify(ids)) } catch { /* см. loadWallpaper */ }
}

// ── Размер слотов ────────────────────────────────────────────────────────────────────────────
// Доля высоты, которую занимает ВЕРХНИЙ слот, когда открыты оба. Границы 0.2…0.8 — не вкусовщина:
// у слота есть шапка с названием и кнопками (~36 px), и за пределами этой вилки от приложения
// остаётся одна шапка, то есть «схлопнул и не понял, куда делось».
const SPLIT_KEY = 'aipanel-apps-split'
const SPLIT_MIN = 0.2
const SPLIT_MAX = 0.8

function loadSplit(): number {
  try {
    const raw = Number(localStorage.getItem(SPLIT_KEY))
    if (Number.isFinite(raw) && raw >= SPLIT_MIN && raw <= SPLIT_MAX) return raw
  } catch { /* см. loadWallpaper */ }
  return 0.5
}
function saveSplit(v: number): void {
  try { localStorage.setItem(SPLIT_KEY, String(v)) } catch { /* см. loadWallpaper */ }
}

function orderApps(all: AppDef[], order: string[]): AppDef[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  const known = all.filter((a) => rank.has(a.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  const rest = all.filter((a) => !rank.has(a.id))
  return [...known, ...rest]
}

// ── Обои ─────────────────────────────────────────────────────────────────────────────────────
// Персистентность — localStorage самой панели (origin oblako-chrome://localhost переживает
// рестарт), НЕ SettingsManager: чисто косметическая настройка одного renderer'а, тащить её
// через IPC/main ради ключа-строки незачем.
// css: '' — «Без обоев»: остров остаётся нейтральным белым (surface-solid), подписи иконок
// переходят на цвета темы вместо белого с тенью (см. HomeGrid).
const WALLPAPERS: { id: string; label: string; css: string }[] = [
  { id: 'none', label: 'Без обоев', css: '' },
  { id: 'ocean', label: 'Океан', css: 'var(--wallpaper-ocean)' },
  { id: 'sunset', label: 'Закат', css: 'var(--wallpaper-sunset)' },
  { id: 'aurora', label: 'Аврора', css: 'var(--wallpaper-aurora)' },
  { id: 'lavender', label: 'Лаванда', css: 'var(--wallpaper-lavender)' },
  { id: 'graphite', label: 'Графит', css: 'var(--wallpaper-graphite)' },
]
const WALLPAPER_STORAGE_KEY = 'aipanel-apps-wallpaper'
// Своя картинка пользователя — отдельный ключ: data-URL (jpeg, ужат канвасом при загрузке,
// см. handleWallpaperFile) может весить сотни КБ, не мешаем его строке-идентификатору выбора.
const WALLPAPER_CUSTOM_KEY = 'aipanel-apps-wallpaper-custom'
// undefined = ещё не читали localStorage (строка большая — читаем лениво один раз).
let customWallpaperCache: string | null | undefined = undefined

export function getCustomWallpaper(): string | null {
  if (customWallpaperCache === undefined) {
    try { customWallpaperCache = localStorage.getItem(WALLPAPER_CUSTOM_KEY) } catch { customWallpaperCache = null }
  }
  return customWallpaperCache
}

function saveCustomWallpaper(dataUrl: string): void {
  // Бросает QuotaExceededError при переполнении — ловит вызывающий (показывает ошибку в шите).
  localStorage.setItem(WALLPAPER_CUSTOM_KEY, dataUrl)
  customWallpaperCache = dataUrl
}

export function loadWallpaper(): string {
  try {
    const saved = localStorage.getItem(WALLPAPER_STORAGE_KEY)
    if (saved === 'custom' && getCustomWallpaper() !== null) return 'custom'
    if (saved && WALLPAPERS.some((w) => w.id === saved)) return saved
  } catch { /* приватный режим/выключенный storage — просто дефолт */ }
  return 'ocean'
}

export function saveWallpaper(id: string): void {
  try { localStorage.setItem(WALLPAPER_STORAGE_KEY, id) } catch { /* см. loadWallpaper */ }
}

// Фон-обои для острова панели (aipanel.tsx красит ими ВЕСЬ остров в режиме «Приложения», не
// только область под сеткой). «Холст» фиксированной ширины: 640 = AI_PANEL_WIDTH_MAX
// (AiPanelManager.ts), шире панель не бывает — при драге ширины картинка ОБРЕЗАЕТСЯ по
// центру, а не растягивается/сжимается (как обои телефона). Высота — от бокса: по вертикали
// панель меняется только с окном, это не живой драг.
export function wallpaperBackground(id: string): React.CSSProperties {
  if (id === 'custom') {
    const img = getCustomWallpaper()
    if (img === null) return {}
    // Фото — cover, не фикс-холст градиентов: '640px 100%' исказило бы пропорции снимка.
    // Кроп-требование всё равно соблюдается на драге ширины: картинка при загрузке ужата
    // высокой (до 2560px), масштаб cover почти всегда задаёт высота панели — изменение
    // ширины только подрезает бока, не масштабирует.
    return {
      backgroundImage: `url(${img})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center top',
      backgroundRepeat: 'no-repeat',
    }
  }
  const w = WALLPAPERS.find((x) => x.id === id)
  if (!w || w.css === '') return {} // «Без обоев» / неизвестный id — остров остаётся белым
  return {
    backgroundImage: w.css,
    backgroundSize: '640px 100%',
    backgroundPosition: 'center top',
    backgroundRepeat: 'no-repeat',
  }
}

// ── Виджеты: конфиг и город для погоды ───────────────────────────────────────────────────────
// Персистентность та же, что у обоев (localStorage панели — косметика одного renderer'а).
export interface WidgetsConfig { weather: boolean; currency: boolean }
const WIDGETS_STORAGE_KEY = 'aipanel-apps-widgets'
const WEATHER_CITY_KEY = 'aipanel-weather-city'

function loadWidgets(): WidgetsConfig {
  try {
    const raw = localStorage.getItem(WIDGETS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WidgetsConfig>
      return { weather: parsed.weather !== false, currency: parsed.currency !== false }
    }
  } catch { /* см. loadWallpaper */ }
  return { weather: true, currency: true }
}
function saveWidgets(cfg: WidgetsConfig): void {
  try { localStorage.setItem(WIDGETS_STORAGE_KEY, JSON.stringify(cfg)) } catch { /* см. loadWallpaper */ }
}
function loadWeatherCity(): string {
  try { return localStorage.getItem(WEATHER_CITY_KEY) || 'Москва' } catch { return 'Москва' }
}
function saveWeatherCity(city: string): void {
  try { localStorage.setItem(WEATHER_CITY_KEY, city) } catch { /* см. loadWallpaper */ }
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
  const [openApps, setOpenApps] = useState<AppId[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [widgets, setWidgets] = useState<WidgetsConfig>(loadWidgets)
  const [weatherCity, setWeatherCity] = useState<string>(loadWeatherCity)
  const [cityDraft, setCityDraft] = useState(weatherCity)
  const [customApps, setCustomApps] = useState<CustomWebApp[]>(loadCustomApps)
  const [newAppName, setNewAppName] = useState('')
  const [newAppUrl, setNewAppUrl] = useState('')

  const [appsOrder, setAppsOrder] = useState<string[]>(loadAppsOrder)
  const [hiddenApps, setHiddenApps] = useState<string[]>(loadHiddenApps)
  // Меню у иконки (ПКМ): что за приложение и где рисовать. Координаты — относительно раздела.
  const [iconMenu, setIconMenu] = useState<{ app: AppDef; x: number; y: number } | null>(null)
  const everyApp: AppDef[] = orderApps([...APPS, ...customApps.map(customToDef)], appsOrder)
  // ⚠️ Спрятанное убирается только с ЭКРАНА: открытый слот с ним продолжает работать, пока его не
  // закроют. Иначе «скрыть» на глазах убивало бы наполовину введённое в приложении.
  const allApps: AppDef[] = everyApp.filter((a) => !hiddenApps.includes(a.id))
  const hiddenDefs: AppDef[] = everyApp.filter((a) => hiddenApps.includes(a.id))

  const hideApp = (id: string) => {
    const next = [...hiddenApps, id]
    setHiddenApps(next)
    saveHiddenApps(next)
  }
  const unhideApp = (id: string) => {
    const next = hiddenApps.filter((x) => x !== id)
    setHiddenApps(next)
    saveHiddenApps(next)
  }
  const reorderApps = (ids: string[]) => {
    setAppsOrder(ids)
    saveAppsOrder(ids)
  }
  // Шит рисуется только пока виден домашний экран; отдельный флаг нужен и веб-слотам —
  // WebContentsView лежит ПОВЕРХ панели, открытый шит иначе оказался бы под сайтом.
  const sheetVisible = sheetOpen && openApps.length < 2

  const openApp = (id: AppId) => {
    setOpenApps((prev) => (prev.includes(id) || prev.length >= 2 ? prev : [...prev, id]))
  }
  const closeApp = (id: AppId) => setOpenApps((prev) => prev.filter((a) => a !== id))

  // Внешний запрос: открыть приложение и сразу сообщить, что он обработан, — иначе повторный
  // клик по той же иконке не сработал бы (значение в родителе не поменялось бы).
  useEffect(() => {
    if (!requestedApp) return
    openApp(requestedApp)
    onRequestHandled?.()
    // openApp/onRequestHandled стабильны по смыслу вызова; следим только за самим запросом.
     
  }, [requestedApp])
  // Обмен верхнего/нижнего слота — ключи не меняются, React переставляет DOM без ремаунта,
  // состояние приложений (набранное в калькуляторе, таймер) переезжает вместе со слотом.
  const swapSlots = () => setOpenApps((prev) => (prev.length === 2 ? [prev[1], prev[0]] : prev))

  // ── Какой слот активен ──
  // ⚠️ Нужно ровно тогда, когда открыты ОБА: они занимают всю площадь, и по виду не отличить, в
  // каком сейчас идёт работа. Живой случай: набираешь в конвертере — калькулятор рядом не
  // принимает ввод, но выглядит так же. Кольцо на иконке этого не решало: сетка иконок при двух
  // открытых приложениях вообще не видна.
  const [activeApp, setActiveApp] = useState<AppId | null>(null)
  // Клик в САЙТ веб-слота панель не видит — про него сообщает main (см. WebAppManager.ts).
  useEffect(() => window.aiPanel.onWebAppFocused((id) => setActiveApp(id)), [])
  // Закрыли слот — активным становится оставшийся, иначе рамка осталась бы на пустом месте.
  useEffect(() => {
    if (openApps.length === 1) setActiveApp(openApps[0])
    else if (openApps.length === 0) setActiveApp(null)
    else if (activeApp === null || !openApps.includes(activeApp)) setActiveApp(openApps[0])
  }, [openApps, activeApp])

  // Esc закрывает СЛОТ, а не панель, пока открыто хоть одно приложение.
  // ⚠️ Слушатель в фазе ПЕРЕХВАТА и с stopPropagation: панель закрывает себя по Esc своим
  // обработчиком на document (см. aipanel.tsx), и без перехвата один Esc делал бы оба дела разом
  // — закрывал приложение и захлопывал панель. Закрывается ПОСЛЕДНИЙ открытый: он верхний в
  // стопке внимания, как последняя открытая вкладка при Ctrl+W.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Tab — переключить активное приложение с клавиатуры. Обычные стрелки для этого не
      // годятся: они уже ходят по сетке иконок, а внутри приложений живут поля ввода.
      if (e.key === 'Tab' && e.ctrlKey && openApps.length === 2) {
        e.preventDefault()
        e.stopPropagation()
        setActiveApp((cur) => (cur === openApps[0] ? openApps[1] : openApps[0]))
        return
      }
      if (e.key !== 'Escape') return
      // Открытое меню у иконки забирает Esc себе — оно «поверх» и по смыслу, и на экране.
      if (iconMenu) { e.stopPropagation(); setIconMenu(null); return }
      if (openApps.length === 0) return
      e.stopPropagation()
      // ⚠️ Закрывается АКТИВНОЕ приложение, а не последнее в списке. Прежнее «последнее» было
      // прямым багом: подсвечен конвертер, жмёшь Esc — закрывается калькулятор, потому что он
      // оказался нижним. Esc обязан относиться к тому же, к чему относится рамка.
      const target = activeApp && openApps.includes(activeApp) ? activeApp : openApps[openApps.length - 1]
      setOpenApps((prev) => prev.filter((x) => x !== target))
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [openApps, iconMenu, activeApp])

  // Перетаскивание слотов: тот же порог в 5 px, что у иконок, — иначе нажатие на шапку (кнопки
  // свопа и закрытия живут там же) считалось бы началом жеста.
  const slotSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [draggingSlot, setDraggingSlot] = useState(false)

  // ── Размер слотов перетаскиванием разделителя ──
  const slotsRef = useRef<HTMLDivElement>(null)
  const [splitRatio, setSplitRatio] = useState<number>(loadSplit)
  const ratioRef = useRef(splitRatio)
  // ⚠️ Пока тянут разделитель, веб-слоты ПРЯЧУТСЯ. Не косметика: их WebContentsView лежит ПОВЕРХ
  // панели, и как только указатель заходит на сайт, панель перестаёт получать pointermove — тот
  // же закон, из-за которого зоны дропа вкладок считает main, а не рендерер. Спрятанная вью
  // отдаёт указатель панели, и разделитель доезжает до конца; сайт возвращается на отпускании.
  const [resizing, setResizing] = useState(false)

  const startResize = (e: React.PointerEvent) => {
    const box = slotsRef.current?.getBoundingClientRect()
    if (!box || box.height <= 0) return
    e.preventDefault()
    setResizing(true)
    const move = (ev: PointerEvent) => {
      const r = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (ev.clientY - box.top) / box.height))
      ratioRef.current = r
      setSplitRatio(r)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setResizing(false)
      saveSplit(ratioRef.current)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const addCustomApp = () => {
    const rawUrl = newAppUrl.trim()
    if (!rawUrl) return
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    let name = newAppName.trim()
    if (!name) {
      try { name = new URL(url).hostname.replace(/^www\./, '') } catch { name = rawUrl }
    }
    const next = [...customApps, { id: `web:custom-${Date.now()}`, name, url }]
    setCustomApps(next)
    saveCustomApps(next)
    setNewAppName('')
    setNewAppUrl('')
  }
  const removeCustomApp = (id: string) => {
    closeApp(id) // если открыт в слоте — слот закрывается (и view в main умирает с ним)
    const next = customApps.filter((c) => c.id !== id)
    setCustomApps(next)
    saveCustomApps(next)
  }

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
          onWallpaper={wallpaper !== 'none'}
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
              background: 'var(--surface-solid)', borderRadius: 'var(--radius-card)',
              border: '1px solid var(--glass-edge)', boxShadow: 'var(--shadow-card)',
            }}>
              {/* Шапка шита: явный крестик — раньше закрыть можно было только повторным кликом
                  по «Настроить», что неочевидно. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                  Настройки
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
              <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)' }}>
                Обои
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {WALLPAPERS.map((w) => {
                  const selected = w.id === wallpaper
                  const isNone = w.css === ''
                  return (
                    <button
                      key={w.id}
                      onClick={() => onSelectWallpaper(w.id)}
                      title={w.label}
                      style={{
                        width: 28, height: 28, borderRadius: '50%', padding: 0, cursor: 'pointer',
                        background: isNone ? 'var(--surface-solid)' : w.css,
                        border: selected
                          ? '2px solid var(--accent)'
                          : isNone ? '2px solid var(--divider-strong)' : '2px solid transparent',
                      }}
                    />
                  )
                })}
                {customWallpaper !== null && (
                  <button
                    onClick={() => onSelectWallpaper('custom')}
                    title="Своя картинка"
                    style={{
                      width: 28, height: 28, borderRadius: '50%', padding: 0, cursor: 'pointer',
                      backgroundImage: `url(${customWallpaper})`,
                      backgroundSize: 'cover', backgroundPosition: 'center',
                      border: wallpaper === 'custom' ? '2px solid var(--accent)' : '2px solid transparent',
                    }}
                  />
                )}
                {/* label оборачивает скрытый file-input — тот же приём, что «Палитра» в пипетке. */}
                <label
                  title="Загрузить свою картинку"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: '50%', cursor: 'pointer',
                    background: 'var(--surface-sunken)', border: '2px dashed var(--divider-strong)',
                    color: 'var(--text-muted)', position: 'relative',
                  }}
                >
                  <ImagePlus size={13} />
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
              <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)' }}>
                Виджеты
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {([['weather', 'Погода'], ['currency', 'Курс валют']] as [keyof WidgetsConfig, string][]).map(([key, label]) => {
                  const active = widgets[key]
                  return (
                    <button
                      key={key}
                      onClick={() => toggleWidget(key)}
                      style={{
                        padding: '4px 10px', borderRadius: 'var(--radius-chip)', cursor: 'pointer',
                        border: active ? '1px solid var(--accent)' : '1px solid var(--glass-edge)',
                        background: active ? 'var(--accent-soft)' : 'var(--surface-sunken)',
                        color: active ? 'var(--accent)' : 'var(--text-muted)',
                        fontSize: 'var(--fs-xs)', fontWeight: 500,
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              {widgets.weather && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={cityDraft}
                    onChange={(e) => setCityDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') applyCity() }}
                    placeholder="Город для погоды"
                    style={{
                      flex: 1, minWidth: 0, border: 'none', outline: 'none',
                      borderRadius: 'var(--radius-sm)', padding: '7px 10px',
                      background: 'var(--surface-sunken)', color: 'var(--text-strong)',
                      fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
                    }}
                  />
                  <button
                    onClick={applyCity}
                    disabled={cityDraft.trim() === '' || cityDraft.trim() === weatherCity}
                    style={{
                      padding: '0 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                      background: 'var(--accent)', color: 'var(--text-on-accent)',
                      fontSize: 'var(--fs-xs)', fontWeight: 600,
                      cursor: 'pointer',
                      opacity: cityDraft.trim() === '' || cityDraft.trim() === weatherCity ? 0.45 : 1,
                    }}
                  >
                    ОК
                  </button>
                </div>
              )}
              <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)' }}>
                Веб-приложения
              </span>
              {customApps.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--text-strong)',
                  }}>
                    {c.name}
                  </span>
                  <span style={{
                    maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
                  }}>
                    {c.url}
                  </span>
                  <button
                    onClick={() => removeCustomApp(c.id)}
                    title="Удалить"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 20, height: 20, flexShrink: 0, padding: 0,
                      background: 'transparent', border: 'none', borderRadius: '50%',
                      color: 'var(--text-faint)', cursor: 'pointer',
                    }}
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>
              ))}
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
                  onKeyDown={(e) => { if (e.key === 'Enter') addCustomApp() }}
                  placeholder="URL сайта"
                  style={{
                    flex: 1, minWidth: 0, border: 'none', outline: 'none',
                    borderRadius: 'var(--radius-sm)', padding: '7px 10px',
                    background: 'var(--surface-sunken)', color: 'var(--text-strong)',
                    fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
                  }}
                />
                <button
                  onClick={addCustomApp}
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

              {/* Спрятанные — здесь же, а не отдельным экраном: это единственное место, откуда их
                  можно вернуть, и оно обязано быть рядом с самим списком приложений. Пусто —
                  блока нет вовсе, чтобы не занимать место обещанием. */}
              {hiddenDefs.length > 0 && (
                <>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
                    Скрытые с экрана
                  </span>
                  {hiddenDefs.map((h) => (
                    <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AppIconBadge app={h} size={20} radius={6} iconSize={12} />
                      <span style={{
                        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
                      }}>
                        {h.label}
                      </span>
                      <button
                        onClick={() => unhideApp(h.id)}
                        style={{
                          padding: '0 10px', height: 24, flexShrink: 0,
                          borderRadius: 'var(--radius-pill)', border: '1px solid var(--glass-edge)',
                          background: 'transparent', color: 'var(--text-body)',
                          fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer',
                        }}
                      >
                        Вернуть
                      </button>
                    </div>
                  ))}
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

// ── Домашний экран: виджеты + сетка иконок ───────────────────────────────────────────────────
// onWallpaper: подписи иконок белые с тенью только ПОВЕРХ обоев; на «Без обоев» (белый остров)
// они переходят на цвета темы — иначе нечитаемы.
// Иконка приложения: lucide-глиф либо первая буква названия (пользовательские веб-приложения).
// Плитки приложений.
//
// ⚠️ Форма — SQUIRCLE (суперэллипс), а не border-radius. Это не придирка: у Apple иконки
// строятся по суперэллипсу, где кривизна нарастает плавно, а обычное скругление даёт прямые
// участки сторон и заметный «стык» с дугой. Именно этот силуэт первым выдаёт самоделку, даже
// когда цвет и глиф подобраны верно. Задаётся маской с data-URI: id-шный clipPath работал бы
// только в своём документе, а плитки живут в двух разных (чром и AI-панель).
const SQUIRCLE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'%3E%3Cpath d='M50 0C77.6 0 88.8 3.4 94.2 11.8C98.4 18.4 100 27.4 100 50C100 72.6 98.4 81.6 94.2 88.2C88.8 96.6 77.6 100 50 100C22.4 100 11.2 96.6 5.8 88.2C1.6 81.6 0 72.6 0 50C0 27.4 1.6 18.4 5.8 11.8C11.2 3.4 22.4 0 50 0Z' fill='%23000'/%3E%3C/svg%3E"

// ⚠️ Глиф рисуется CSS-МАСКОЙ, а не <img>: файлы Phosphor чёрные, а на цветной плитке нужен
// белый силуэт. Маска красит его заливкой родителя и не требует ни правки самих SVG, ни
// filter-хаков вроде invert. Если файла нет (пользовательское веб-приложение) — остаётся
// прежняя буквенная подпись.
// Свои составные глифы (см. src/components/appGlyphs.tsx) — они рисуют сам предмет, а не его
// силуэт. Маски Phosphor остались только запасным путём для приложений без своего глифа.
const PHOSPHOR_APPS = new Set(['calc', 'convert', 'timer', 'color', 'kitten', 'counter'])

// Цвет глифа для СВЕТЛЫХ плиток (см. --appicon-counter/--appicon-color в tokens/apps.css):
// на белой поверхности белый силуэт, разумеется, не виден, и цвет берёт на себя он.
const GLYPH_TINT: Record<string, string> = {
  counter: '#007AFF', // systemBlue
  color: '#FF2D55',   // systemPink — фиолетового в системе нет, см. --tile-* в colors.css
}

// Светлым плиткам нужна собственная кромка: на белом фоне светлые блики не работают, а без
// границы иконка сливается со светлыми обоями.
const LIGHT_TILES = new Set(Object.keys(GLYPH_TINT))

export function AppIconBadge({ app, size, radius, iconSize, shadow }: {
  app: AppDef
  size: number
  /** Оставлен для совместимости с вызовами; форму задаёт squircle-маска, а не радиус. */
  radius?: number | string
  iconSize: number
  shadow?: boolean
}) {
  void radius
  const Icon = app.icon
  const maskFile = PHOSPHOR_APPS.has(app.id) ? app.id : app.kind === 'web' ? 'web' : null
  const glyphColor = GLYPH_TINT[app.id] ?? 'var(--appicon-glyph)'
  const isLightTile = LIGHT_TILES.has(app.id)
  const squircle: React.CSSProperties = {
    WebkitMaskImage: `url("${SQUIRCLE}")`,
    maskImage: `url("${SQUIRCLE}")`,
    WebkitMaskSize: '100% 100%',
    maskSize: '100% 100%',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
  }

  return (
    // Внешняя обёртка несёт ТЕНЬ: тень от элемента с маской обрезается вместе с ним, поэтому
    // отбрасывать её должен слой снаружи маски (drop-shadow, а не box-shadow — он повторяет
    // форму суперэллипса, а не прямоугольника).
    <span style={{
      display: 'inline-flex', width: size, height: size, flexShrink: 0, position: 'relative',
      filter: shadow ? 'drop-shadow(0 1px 2px rgba(12,14,24,0.28)) drop-shadow(0 7px 14px rgba(12,14,24,0.30))' : undefined,
    }}>
      <span style={{
        ...squircle,
        position: 'relative', width: size, height: size,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: app.gradient,
      }}>
        {/* Слои света. Порядок и смысл те же, что у иконок iOS: мягкая засветка сверху-слева
            (откуда «падает свет»), тонкая светлая кромка по верхнему краю и лёгкое затемнение
            к низу. Каждый по отдельности почти незаметен — вместе они и дают объём. */}
        <span style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: isLightTile
            ? 'radial-gradient(120% 90% at 28% 0%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 60%)'
            : 'radial-gradient(130% 100% at 30% -10%, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.06) 55%, rgba(255,255,255,0) 78%)',
        }} />
        <span style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: isLightTile
            ? 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(0,0,0,0.05) 100%)'
            : 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 12%, rgba(0,0,0,0) 78%, rgba(0,0,0,0.10) 100%)',
        }} />

        {hasGlyph(app.id) || (app.kind === 'web' && hasGlyph('web')) ? (
          <span style={{ position: 'relative', display: 'inline-flex', filter: isLightTile ? undefined : 'drop-shadow(0 1px 1px rgba(0,0,0,0.18))' }}>
            <AppGlyph id={hasGlyph(app.id) ? app.id : 'web'} size={iconSize} color={glyphColor} />
          </span>
        ) : maskFile ? (
          <span style={{
            width: iconSize, height: iconSize, position: 'relative',
            background: glyphColor,
            WebkitMaskImage: `url("./appicons/${maskFile}.svg")`,
            maskImage: `url("./appicons/${maskFile}.svg")`,
            WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center', maskPosition: 'center',
            WebkitMaskSize: 'contain', maskSize: 'contain',
            // Тень под глифом — он должен лежать НА поверхности, а не быть в неё впечатан.
            filter: isLightTile ? undefined : 'drop-shadow(0 1px 1px rgba(0,0,0,0.22))',
          }} />
        ) : Icon !== null ? (
          <Icon size={iconSize} strokeWidth={2.4} style={{ color: 'var(--appicon-glyph)', position: 'relative' }} />
        ) : (
          <span style={{
            fontSize: Math.round(iconSize * 0.82), fontWeight: 600, lineHeight: 1,
            color: 'var(--appicon-glyph)', position: 'relative',
            textShadow: '0 1px 1px rgba(0,0,0,0.22)',
          }}>
            {app.label.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
    </span>
  )
}

// ⚠️ «Активен ли слот, в котором я нарисован» — контекстом, а не пропсом через каждое приложение.
// Повод не в удобстве: приложения слушают клавиши ГЛОБАЛЬНО на window (иначе клавиатура работала бы
// только при фокусе внутри самой кнопки), и при двух открытых приложениях цифры доставались
// обоим — набираешь в конвертере, а считает калькулятор. Живая жалоба, и рамка активного слота
// без этой проверки была чистым украшением.
const SlotActiveContext = React.createContext(true)
export function useSlotActive(): boolean {
  return React.useContext(SlotActiveContext)
}

// Столбцов в сетке иконок. Держится рядом с самой сеткой: по нему же ходят стрелки вверх/вниз,
// и разъехавшись, они бы прыгали через ряд.
const GRID_COLUMNS = 4

// Иконка приложения. Вынесена отдельно намеренно: ровно ею же рисуется призрак под курсором
// (DragOverlay), а призрак, нарисованный «похоже, но не тем же», — классический источник
// расхождений вида «в руке одно, приземлилось другое».
function AppIcon({ app, opened, onWallpaper, dragging, onOpen, onMenu }: {
  app: AppDef
  opened: boolean
  onWallpaper: boolean
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
        color: onWallpaper ? 'var(--app-label)' : 'var(--text-body)',
        textShadow: onWallpaper ? 'var(--app-label-shadow)' : undefined,
      }}>
        {app.label}
      </span>
    </button>
  )
}

// DnD-обёртка иконки — ровно та же, что у ячеек закреплённых вкладок в сайдбаре.
// Исходная позиция становится прозрачной, пока идёт жест: рисует её призрак.
function SortableAppIcon({ app, opened, onWallpaper, onOpen, onMenu }: {
  app: AppDef
  opened: boolean
  onWallpaper: boolean
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
      <AppIcon app={app} opened={opened} onWallpaper={onWallpaper} onOpen={onOpen} onMenu={onMenu} />
    </div>
  )
}

// Размеры меню известны заранее — по ним раздел решает, в какую сторону его раскрывать (см.
// onIconMenu). Мерить фактическую высоту после отрисовки значило бы показать меню за краем и
// дёрнуть его на следующем кадре; два пункта плюс заголовок дают предсказуемые ~104 px.
const ICON_MENU_WIDTH = 168
const ICON_MENU_HEIGHT = 104
const ICON_MENU_EDGE = 8

// Меню у иконки (ПКМ). Своё, а не системное контекстное меню Electron: пункты зависят от того,
// СВОЁ приложение или встроенное, и рисовать их надо там же, где живёт остальной интерфейс
// панели, — своим стеклом и своими токенами, а не серым системным списком.
function IconMenu({ app, x, y, opened, onOpen, onClose, onHide, onRemove, onDismiss }: {
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

function HomeGrid({ apps, openApps, onOpen, onReorder, onIconMenu, widgets, weatherCity, onWallpaper }: {
  apps: AppDef[]
  openApps: AppId[]
  onOpen: (id: AppId) => void
  /** Новый порядок иконок целиком — перетаскивание завершилось. */
  onReorder: (ids: string[]) => void
  /** ПКМ по иконке — координаты окна, меню рисует раздел (ему известны его границы). */
  onIconMenu: (app: AppDef, x: number, y: number) => void
  widgets: WidgetsConfig
  weatherCity: string
  onWallpaper: boolean
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
                onWallpaper={onWallpaper}
                onOpen={() => onOpen(app.id)}
                onMenu={(x, y) => onIconMenu(app, x, y)}
              />
            ))}
          </div>
        </SortableContext>
        {/* Призрак под курсором — иначе иконка «прыгает» на место лишь в конце жеста, и человек
            не понимает, тащит он что-то или нет (ровно эта жалоба и была). */}
        <DragOverlay dropAnimation={null}>
          {dragged && <AppIcon app={dragged} opened={false} onWallpaper={onWallpaper} dragging />}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

// ── Виджеты домашнего экрана ─────────────────────────────────────────────────────────────────
const widgetCardStyle: React.CSSProperties = {
  background: 'var(--surface-solid)', borderRadius: 'var(--radius-card)',
  border: '1px solid var(--glass-edge)', boxShadow: 'var(--shadow-card)',
  padding: '10px 12px', flexShrink: 0,
}

// WMO weather code → человекочитаемое состояние. Диапазоны из документации Open-Meteo.
function describeWeather(code: number): { icon: string; text: string } {
  if (code === 0) return { icon: '☀️', text: 'Ясно' }
  if (code === 1) return { icon: '🌤️', text: 'В основном ясно' }
  if (code === 2) return { icon: '⛅', text: 'Переменная облачность' }
  if (code === 3) return { icon: '☁️', text: 'Пасмурно' }
  if (code === 45 || code === 48) return { icon: '🌫️', text: 'Туман' }
  if (code >= 51 && code <= 57) return { icon: '🌦️', text: 'Морось' }
  if (code >= 61 && code <= 67) return { icon: '🌧️', text: 'Дождь' }
  if (code >= 71 && code <= 77) return { icon: '🌨️', text: 'Снег' }
  if (code >= 80 && code <= 82) return { icon: '🌧️', text: 'Ливень' }
  if (code === 85 || code === 86) return { icon: '🌨️', text: 'Снегопад' }
  if (code >= 95) return { icon: '⛈️', text: 'Гроза' }
  return { icon: '🌡️', text: '' }
}

const fmtTemp = (t: number): string => `${t > 0 ? '+' : ''}${Math.round(t)}°`

function WeatherWidget({ city }: { city: string }) {
  const [data, setData] = useState<WeatherResult | null>(null)
  // Инкремент — ручной повтор после ошибки (перезапускает effect с тем же городом).
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setData(null)
    const load = () => {
      window.aiPanel.weather(city).then((res) => { if (!cancelled) setData(res) })
    }
    load()
    // Панель живёт долго (не размонтируется при переключении в чат) — без периодического
    // обновления температура протухла бы навсегда. 15 мин = TTL кэша в main.
    const id = setInterval(load, 15 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [city, reloadKey])

  return (
    <div style={widgetCardStyle}>
      {data === null ? (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
        }}>
          <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
          Погода…
        </span>
      ) : !data.ok ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            Погода недоступна: {data.error}
          </span>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            style={{
              padding: '4px 10px', borderRadius: 'var(--radius-chip)', border: 'none',
              background: 'var(--surface-sunken)', color: 'var(--text-muted)',
              fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer', flexShrink: 0,
            }}
          >
            Повторить
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 26, lineHeight: 1 }}>
            {describeWeather(data.weatherCode ?? -1).icon}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {data.city}
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
              {describeWeather(data.weatherCode ?? -1).text}
              {data.windKmh !== undefined ? ` · ветер ${Math.round(data.windKmh)} км/ч` : ''}
            </div>
          </div>
          <span style={{ fontSize: 22, fontWeight: 300, color: 'var(--text-strong)', flexShrink: 0 }}>
            {data.tempC !== undefined ? fmtTemp(data.tempC) : ''}
          </span>
        </div>
      )}
    </div>
  )
}

// Пары для виджета курсов — две самые ходовые, компактно (полный список — в конвертере).
const WIDGET_CURRENCIES: { code: string; sym: string }[] = [
  { code: 'USD', sym: '$' },
  { code: 'EUR', sym: '€' },
]

function CurrencyWidget() {
  const [rates, setRates] = useState<CurrencyRatesData | null>(currencyCache)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setError(null)
    void ensureCurrencyRates().then(({ data, error: err }) => {
      if (data) setRates(data)
      else setError(err)
    })
  }
  // Курсы суточные — одного захода на маунт достаточно (main кэширует на час сам),
  // пустые deps намеренно.
  useEffect(() => {
    if (currencyCache) { setRates(currencyCache); return }
    load()
  }, [])

  return (
    <div style={{ ...widgetCardStyle, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)' }}>
          Курс ЦБ
        </span>
        {rates !== null && rates.date !== '' && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{rates.date}</span>
        )}
      </div>
      {rates === null && error === null && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
        }}>
          <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
          Загружаю…
        </span>
      )}
      {error !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            Курсы недоступны: {error}
          </span>
          <button
            onClick={load}
            style={{
              padding: '4px 10px', borderRadius: 'var(--radius-chip)', border: 'none',
              background: 'var(--surface-sunken)', color: 'var(--text-muted)',
              fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer', flexShrink: 0,
            }}
          >
            Повторить
          </button>
        </div>
      )}
      {rates !== null && WIDGET_CURRENCIES.map(({ code, sym }) => {
        const value = rates.rates[code]
        if (value === undefined) return null
        return (
          <div key={code} style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
              {sym} {code}
            </span>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', fontVariantNumeric: 'tabular-nums' }}>
              {value.toFixed(2).replace('.', ',')} ₽
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Слот открытого приложения ────────────────────────────────────────────────────────────────
// Общая карточка слота: шапка (иконка + название + свап при двух слотах + крестик) и содержимое.
// Разделитель между двумя слотами: тянут за него, меняется доля высоты. Ручка нарисована
// полоской по центру — без неё зона в 10 px читается как пустой зазор, а не как ручка.
function SlotDivider({ onPointerDown, active }: {
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
        width: 40, height: 4, borderRadius: 2,
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

function AppSlot({ app, grow, active, showRing, onActivate, onSwap, onClose }: {
  app: AppDef; grow?: number; active?: boolean; showRing?: boolean; onActivate?: () => void
  onSwap?: () => void; onClose: () => void
}) {
  return (
    <SlotFrame app={app} grow={grow} active={active} showRing={showRing} onActivate={onActivate}
      onSwap={onSwap} onClose={onClose}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {app.id === 'calc' && <CalcApp />}
        {app.id === 'convert' && <ConverterApp />}
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
function WebAppSlot({ app, slotIndex, grow, active, showRing, onActivate, hidden, onSwap, onClose }: {
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

// ── Калькулятор ──────────────────────────────────────────────────────────────────────────────
// Арифметика, формат и правило процента — в shared/calc.ts под scripts/calc-check.mjs. Здесь
// остаётся автомат состояний и отрисовка.

function CalcApp() {
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

  // Ввод с клавиатуры: цифры (верхний ряд И намбар дают одинаковый e.key), операторы * / + -,
  // Enter/= — равно, Backspace — стереть, Delete — сброс. Escape намеренно НЕ трогаем — он
  // закрывает панель (см. aipanel.tsx). Без deps-массива: подписка пересоздаётся на каждый
  // рендер — обработчик всегда видит свежие display/acc/op без ручного списка зависимостей.
  const calcRootRef = useRef<HTMLDivElement>(null)
  const slotActive = useSlotActive()
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
      setDisplay(fmtCalc(n))
      // Вставленное — полноценный операнд: после «50 +» оно становится вторым слагаемым, а не
      // затирается следующей цифрой. И это уже НЕ процент, даже если помеченное число было им.
      setWaiting(false)
      setPercentPending(false)
      // Действие не начато — значит это новый расчёт, прошлое выражение над дисплеем уже не контекст.
      if (op === null) setExpr('')
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const keys: { label: string; kind: 'fn' | 'op' | 'digit'; span?: number; onPress: () => void }[] = [
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

function TimerApp() {
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

  const start = () => {
    if (remaining === 0) return
    endAtRef.current = Date.now() + remaining * 1000
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

// ── Конвертер: валюты + офлайн-единицы ───────────────────────────────────────────────────────
// Валюты — главная категория (дефолтная): живые курсы ЦБ приходят из main по
// ai-panel:currency-rates (см. electron/CurrencyRates.ts — там же почему fetch не отсюда).
// Остальные категории полностью офлайн.
interface ConvUnit { id: string; label: string; factor: number }
interface ConvCategory { id: string; label: string; units: ConvUnit[] }

const CONVERT_CATEGORIES: ConvCategory[] = [
  {
    id: 'length', label: 'Длина', units: [
      { id: 'mm', label: 'мм', factor: 0.001 },
      { id: 'cm', label: 'см', factor: 0.01 },
      { id: 'm', label: 'м', factor: 1 },
      { id: 'km', label: 'км', factor: 1000 },
      { id: 'in', label: 'дюйм', factor: 0.0254 },
      { id: 'ft', label: 'фут', factor: 0.3048 },
      { id: 'mi', label: 'миля', factor: 1609.344 },
    ],
  },
  {
    id: 'mass', label: 'Масса', units: [
      { id: 'g', label: 'г', factor: 0.001 },
      { id: 'kg', label: 'кг', factor: 1 },
      { id: 't', label: 'т', factor: 1000 },
      { id: 'oz', label: 'унция', factor: 0.0283495 },
      { id: 'lb', label: 'фунт', factor: 0.453592 },
    ],
  },
  {
    // factor у температур не используется (нелинейная шкала — см. convertValue), но поле
    // обязательно по типу; 1 — заглушка.
    id: 'temp', label: 'Темп.', units: [
      { id: 'c', label: '°C', factor: 1 },
      { id: 'f', label: '°F', factor: 1 },
      { id: 'k', label: 'K', factor: 1 },
    ],
  },
  {
    id: 'data', label: 'Данные', units: [
      { id: 'kb', label: 'КБ', factor: 1 },
      { id: 'mb', label: 'МБ', factor: 1024 },
      { id: 'gb', label: 'ГБ', factor: 1024 * 1024 },
      { id: 'tb', label: 'ТБ', factor: 1024 * 1024 * 1024 },
    ],
  },
]

// Порядок валют в селектах — ходовые сверху; фильтруется по фактически пришедшим курсам.
// factor = RUB за единицу (base — рубль), та же линейная схема, что у остальных категорий.
const CURRENCY_ORDER = ['USD', 'EUR', 'RUB', 'CNY', 'GBP', 'JPY', 'CHF', 'TRY', 'KZT', 'BYN', 'AED', 'INR']

interface CurrencyRatesData { date: string; rates: Record<string, number> }
// Кэш уровня модуля: конвертер размонтируется при закрытии слота — не перезапрашиваем курсы
// (даже IPC-раундтрип) на каждое переоткрытие. Main кэширует сам fetch независимо.
// Общий для конвертера и виджета «Курс валют» (см. ensureCurrencyRates).
let currencyCache: CurrencyRatesData | null = null

// Единая точка получения курсов для конвертера и виджета: кэш → иначе IPC в main.
async function ensureCurrencyRates(): Promise<{ data: CurrencyRatesData | null; error: string | null }> {
  if (currencyCache) return { data: currencyCache, error: null }
  const res = await window.aiPanel.currencyRates()
  if (res.ok && res.rates) {
    currencyCache = { date: res.date ?? '', rates: res.rates }
    return { data: currencyCache, error: null }
  }
  return { data: null, error: res.error ?? 'нет данных' }
}

// Табы категорий: «Валюты» строятся динамически из курсов, офлайн-категории — статика выше.
const CATEGORY_TABS: { id: string; label: string }[] = [
  { id: 'currency', label: 'Валюты' },
  ...CONVERT_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
]

function convertValue(cat: ConvCategory, from: ConvUnit, to: ConvUnit, v: number): number {
  if (cat.id === 'temp') {
    const c = from.id === 'f' ? (v - 32) * 5 / 9 : from.id === 'k' ? v - 273.15 : v
    return to.id === 'f' ? c * 9 / 5 + 32 : to.id === 'k' ? c + 273.15 : c
  }
  return v * from.factor / to.factor
}

const fmtConvert = (n: number): string => parseFloat(n.toPrecision(9)).toString().replace('.', ',')

// Общий стиль «утопленных» полей конвертера (инпут/селекты/результат) — единый вид ряда.
const convFieldStyle: React.CSSProperties = {
  border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 10px',
  background: 'var(--surface-sunken)', color: 'var(--text-strong)',
  fontSize: 'var(--fs-md)', fontFamily: 'var(--font-sans)', outline: 'none',
}

function ConverterApp() {
  // Валюты — дефолт: ради них конвертер и затевался, доллар→рубль как самая ходовая пара.
  const [catId, setCatId] = useState('currency')
  const [fromId, setFromId] = useState('USD')
  const [toId, setToId] = useState('RUB')
  const [raw, setRaw] = useState('')
  const [currency, setCurrency] = useState<CurrencyRatesData | null>(currencyCache)
  const [currencyError, setCurrencyError] = useState<string | null>(null)

  const loadCurrency = () => {
    setCurrencyError(null)
    void ensureCurrencyRates().then(({ data, error }) => {
      if (data) setCurrency(data)
      else setCurrencyError(error)
    })
  }
  // Лениво — на первый заход в «Валюты» (а это дефолтная категория, т.е. обычно сразу).
  useEffect(() => {
    if (catId === 'currency' && currency === null && currencyError === null) loadCurrency()
  }, [catId, currency, currencyError])

  const cat: ConvCategory = catId === 'currency'
    ? {
        id: 'currency', label: 'Валюты',
        units: currency
          ? CURRENCY_ORDER.filter((c) => currency.rates[c] !== undefined)
              .map((c) => ({ id: c, label: c, factor: currency.rates[c] }))
          : [], // курсы ещё не пришли/ошибка — вместо рядов рисуется статус ниже
      }
    : CONVERT_CATEGORIES.find((c) => c.id === catId) ?? CONVERT_CATEGORIES[0]
  // ?? — страховка от рассинхрона fromId/toId при смене категории (switchCat ставит дефолты,
  // но fallback дешевле, чем полагаться на порядок setState).
  const from = cat.units.find((u) => u.id === fromId) ?? cat.units[0]
  const to = cat.units.find((u) => u.id === toId) ?? cat.units[1]

  const switchCat = (id: string) => {
    setCatId(id)
    if (id === 'currency') { setFromId('USD'); setToId('RUB'); return }
    const c = CONVERT_CATEGORIES.find((x) => x.id === id)
    if (c) { setFromId(c.units[0].id); setToId(c.units[1].id) }
  }
  const swap = () => { setFromId(to.id); setToId(from.id) }

  const parsed = Number(raw.trim().replace(',', '.'))
  const result = raw.trim() === '' || isNaN(parsed) ? '' : fmtConvert(convertValue(cat, from, to, parsed))

  const tabs = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {CATEGORY_TABS.map((c) => {
        const active = c.id === catId
        return (
          <button
            key={c.id}
            onClick={() => switchCat(c.id)}
            style={{
              padding: '4px 10px', borderRadius: 'var(--radius-chip)', cursor: 'pointer',
              border: active ? '1px solid var(--accent)' : '1px solid var(--glass-edge)',
              background: active ? 'var(--accent-soft)' : 'var(--surface-sunken)',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: 'var(--fs-xs)', fontWeight: 500,
            }}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )

  // Валюты без курсов: загрузка или ошибка с повтором — рядов конвертации ещё нет.
  if (cat.units.length < 2) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
        {tabs}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 8, textAlign: 'center',
        }}>
          {currencyError ? (
            <>
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
                Не удалось загрузить курсы: {currencyError}
              </span>
              <button
                onClick={loadCurrency}
                style={{
                  padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                  background: 'var(--accent)', color: 'var(--text-on-accent)',
                  fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Повторить
              </button>
            </>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
            }}>
              <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
              Загружаю курсы ЦБ…
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
      {tabs}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="0"
          inputMode="decimal"
          style={{ ...convFieldStyle, flex: 1, minWidth: 0 }}
        />
        <select
          value={from.id}
          onChange={(e) => setFromId(e.target.value)}
          style={{ ...convFieldStyle, width: 88, flexShrink: 0, padding: '8px 6px', fontSize: 'var(--fs-sm)' }}
        >
          {cat.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </div>
      <button
        onClick={swap}
        title="Поменять местами"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
          width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--glass-edge)',
          background: 'var(--surface-sunken)', color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
        }}
      >
        <ArrowDownUp size={14} />
      </button>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{
          ...convFieldStyle, flex: 1, minWidth: 0,
          color: result ? 'var(--text-strong)' : 'var(--text-faint)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {result || '—'}
        </div>
        <select
          value={to.id}
          onChange={(e) => setToId(e.target.value)}
          style={{ ...convFieldStyle, width: 88, flexShrink: 0, padding: '8px 6px', fontSize: 'var(--fs-sm)' }}
        >
          {cat.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </div>
      {catId === 'currency' && currency !== null && currency.date !== '' && (
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', textAlign: 'center' }}>
          Курсы ЦБ РФ · {currency.date}
        </span>
      )}
    </div>
  )
}

// ── Пипетка (цвет с экрана) ──────────────────────────────────────────────────────────────────
function hexToRgb(hex: string): string {
  if (hex.length !== 7) return ''
  const n = parseInt(hex.slice(1), 16)
  if (isNaN(n)) return ''
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

function ColorApp() {
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

// ── Счётчик символов ─────────────────────────────────────────────────────────────────────────
// Живой подсчёт на каждый ввод — без кнопки «Посчитать» (см. задачу: важен результат, не текст).
// Главные метрики — всего символов и без пробелов — крупными плитками, остальное мелкими строками.
function CounterApp() {
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

// ── Котёнок-тамагочи (основа будущего маскота) ───────────────────────────────────────────────
// Заложена структура под большой маскот с анимациями: персистентное состояние с офлайн-декеем
// (потребности убывают и пока браузер закрыт), настроение выводится из потребностей, реакции
// на действия — отдельные анимации (keyframes в global.css, мордочка пока эмодзи — заменится
// на рисованного кота без изменения логики).
interface KittenStats { food: number; water: number; fun: number; savedAt: number }
const KITTEN_KEY = 'aipanel-kitten'
// Скорость убывания: 1 пункт за N мс. Еда ~17ч от 100 до нуля, вода быстрее, скука быстрее всех.
const KITTEN_DECAY_MS = { food: 10 * 60_000, water: 8 * 60_000, fun: 6 * 60_000 } as const

const clampStat = (v: number): number => Math.max(0, Math.min(100, v))

// Пересчёт потребностей по прошедшему времени — одна и та же математика для офлайн-декея
// (загрузка) и живого тика (setInterval ниже).
function decayKitten(prev: KittenStats, now: number): KittenStats {
  const dt = Math.max(0, now - prev.savedAt)
  return {
    food: clampStat(prev.food - dt / KITTEN_DECAY_MS.food),
    water: clampStat(prev.water - dt / KITTEN_DECAY_MS.water),
    fun: clampStat(prev.fun - dt / KITTEN_DECAY_MS.fun),
    savedAt: now,
  }
}

function loadKittenStats(): KittenStats {
  try {
    const raw = localStorage.getItem(KITTEN_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<KittenStats>
      if (typeof p.food === 'number' && typeof p.water === 'number'
        && typeof p.fun === 'number' && typeof p.savedAt === 'number') {
        return decayKitten({ food: p.food, water: p.water, fun: p.fun, savedAt: p.savedAt }, Date.now())
      }
    }
  } catch { /* см. loadWallpaper */ }
  return { food: 80, water: 80, fun: 80, savedAt: Date.now() }
}
function saveKittenStats(s: KittenStats): void {
  try { localStorage.setItem(KITTEN_KEY, JSON.stringify(s)) } catch { /* см. loadWallpaper */ }
}

type KittenAction = 'feed' | 'drink' | 'play'

function KittenApp() {
  const [stats, setStats] = useState<KittenStats>(loadKittenStats)
  // Текущая реакция — на время анимации-прыжка мордочка меняется (см. face ниже).
  const [action, setAction] = useState<KittenAction | null>(null)

  // Живой тик раз в 30с — потребности убывают на глазах у открытого слота.
  useEffect(() => {
    const id = setInterval(() => setStats((prev) => decayKitten(prev, Date.now())), 30_000)
    return () => clearInterval(id)
  }, [])
  // Персист на каждое изменение — состояние переживает и закрытие слота, и рестарт браузера.
  useEffect(() => { saveKittenStats(stats) }, [stats])

  const act = (kind: KittenAction) => {
    setStats((prev) => {
      const now = decayKitten(prev, Date.now())
      if (kind === 'feed') now.food = clampStat(now.food + 30)
      if (kind === 'drink') now.water = clampStat(now.water + 30)
      if (kind === 'play') now.fun = clampStat(now.fun + 25)
      return now
    })
    setAction(kind)
    window.setTimeout(() => setAction((cur) => (cur === kind ? null : cur)), 900)
  }

  // Настроение — из самой просевшей потребности; реакция на действие приоритетнее.
  const low = Math.min(stats.food, stats.water, stats.fun)
  const face = action === 'feed' ? '😋'
    : action === 'drink' ? '😽'
      : action === 'play' ? '😸'
        : low < 25 ? '😿' : low < 55 ? '🐱' : '😺'
  const status = action !== null ? 'мур-мур!'
    : low >= 55 ? 'мурчит'
      : stats.food === low ? 'хочет есть'
        : stats.water === low ? 'хочет пить' : 'скучает'

  const bars: { label: string; value: number }[] = [
    { label: 'Еда', value: stats.food },
    { label: 'Вода', value: stats.water },
    { label: 'Игры', value: stats.fun },
  ]
  const actions: { kind: KittenAction; emoji: string; label: string }[] = [
    { kind: 'feed', emoji: '🍗', label: 'Покормить' },
    { kind: 'drink', emoji: '💧', label: 'Напоить' },
    { kind: 'play', emoji: '🧶', label: 'Поиграть' },
  ]

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 10, padding: 14,
    }}>
      <span style={{
        fontSize: 54, lineHeight: 1,
        animation: action !== null
          ? 'oblako-kitten-hop 0.5s ease'
          : 'oblako-kitten-idle 3s ease-in-out infinite',
      }}>
        {face}
      </span>
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{status}</span>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bars.map((b) => (
          <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
              {b.label}
            </span>
            <div style={{
              flex: 1, height: 5, borderRadius: 'var(--radius-pill)',
              background: 'var(--surface-sunken)', overflow: 'hidden',
            }}>
              <div style={{
                width: `${b.value}%`, height: '100%',
                // Просевшая потребность подсвечивается danger — системный сигнал «плохо».
                background: b.value < 25 ? 'var(--danger-500)' : 'var(--accent)',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {actions.map((a) => (
          <button
            key={a.kind}
            onClick={() => act(a.kind)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 'var(--radius-chip)', cursor: 'pointer',
              border: '1px solid var(--glass-edge)', background: 'var(--surface-sunken)',
              color: 'var(--text-body)', fontSize: 'var(--fs-xs)', fontWeight: 500,
            }}
          >
            <span>{a.emoji}</span> {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function CopyChip({ label, copied, onCopy }: { label: string; copied: boolean; onCopy: () => void }) {
  return (
    <button
      onClick={onCopy}
      title="Скопировать"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        flex: 1, minWidth: 0, padding: '7px 10px',
        borderRadius: 'var(--radius-sm)', border: 'none',
        background: 'var(--surface-sunken)', color: 'var(--text-body)',
        fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono, monospace)', cursor: 'pointer',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {copied
        ? <Check size={12} style={{ color: 'var(--success-500)', flexShrink: 0 }} />
        : <Copy size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />}
    </button>
  )
}
