// Раздел «Приложения» AI-панели — «домашний экран» в стиле iOS: обои, сетка иконок-сквирклов,
import { RADIUS } from '../styles/system';
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
import { altitude, ALTITUDE, DISPLAY, CAPS, grain } from '../styles/system'
import { WALLPAPER_PRESETS } from '../newtab/settings'
import { allMeshes, findMesh, subscribeMeshes, meshCss } from '../newtab/gradients'
import {
  Calculator, RefreshCw, Timer, Pipette, X, SlidersHorizontal, ImagePlus, Languages, Cat, Type,
  ArrowUpDown, Check, Loader2, Globe, Plus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AppGlyph, hasGlyph } from './appGlyphs'
import { SlotActiveContext } from './apps/slotActive'
import { cachedCurrencyRates, ensureCurrencyRates, type CurrencyRatesData } from './apps/currencyRates'
import CalcApp from './apps/CalcApp'
import TimerApp from './apps/TimerApp'
import ConverterApp from './apps/ConverterApp'
import ColorApp from './apps/ColorApp'
import CounterApp from './apps/CounterApp'
import KittenApp from './apps/KittenApp'
// Тот же тумблер, что в настройках браузера: состояние «включено» обязано выглядеть
// одинаково везде, а пилюля-кнопка означает действие и для состояния не годится.
import Toggle from './Toggle'
import ZonesApp from './ZonesApp'
// Значок погоды и словесное состояние — те же, что на столе (см. weatherIcon.tsx).
import { WeatherIcon, wmoText, weatherSkin } from './desktop/weather'

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
    if (saved === 'none') return 'none'
    if (saved === 'custom' && getCustomWallpaper() !== null) return 'custom'
    if (saved && (saved === 'none' || findMesh(saved) || WALLPAPER_PRESETS.some((p) => p.id === saved))) return saved
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
  if (id === 'none' || id === '') return {}
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
  const mesh = findMesh(id)
  if (mesh) {
    return {
      backgroundImage: meshCss(mesh),
      backgroundSize: '100% 100%',
      backgroundPosition: 'center top',
      backgroundRepeat: 'no-repeat',
    }
  }
  const w = WALLPAPER_PRESETS.find((x) => x.id === id)
  if (!w) return {}
  return {
    backgroundImage: w.css,
    backgroundSize: '640px 100%',
    backgroundPosition: 'center top',
    backgroundRepeat: 'no-repeat',
  }
}

/**
 * Светлые ли обои — то есть нужна ли на них ТЁМНАЯ краска подписей.
 *
 * ⚠️ Данные для этого решения были всё время: флаг `light` стоит у восьми пресетов
 * (WALLPAPER_PRESETS в src/newtab/settings.ts). До места он просто не доезжал — подписи иконок
 * красились белым по факту «обои есть», и на Горчице, Лайме, Небе и трёх Бумагах их было не
 * прочитать. Живой градиент и своя картинка светлоты не объявляют — там остаётся белая с тенью.
 */
export function wallpaperIsLight(id: string): boolean {
  return WALLPAPER_PRESETS.find((w) => w.id === id)?.light === true
}

/** Человеческое имя выбранных обоев — для подписи под выбором. */
export function wallpaperTitle(id: string, meshes: { id: string; name: string }[]): string {
  if (id === 'none') return 'Без обоев'
  if (id === 'custom') return 'Своя картинка'
  return WALLPAPER_PRESETS.find((w) => w.id === id)?.label
    ?? meshes.find((m) => m.id === id)?.name
    ?? 'Обои'
}

/** Домен веб-приложения — в списке он читается лучше полного адреса с хвостом параметров. */
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
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
  const [openApps, setOpenApps] = useState<AppId[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetTab, setSheetTab] = useState<SheetTab>('bg')
  // Поля добавления сайта развёрнуты только по просьбе — пустыми они занимали место обещанием.
  const [addOpen, setAddOpen] = useState(false)
  const [widgets, setWidgets] = useState<WidgetsConfig>(loadWidgets)
  const [weatherCity, setWeatherCity] = useState<string>(loadWeatherCity)
  const [cityDraft, setCityDraft] = useState(weatherCity)
  const [customApps, setCustomApps] = useState<CustomWebApp[]>(loadCustomApps)
  const [newAppName, setNewAppName] = useState('')
  const [newAppUrl, setNewAppUrl] = useState('')
  const [meshes, setMeshes] = useState(() => allMeshes())
  useEffect(() => subscribeMeshes(() => setMeshes(allMeshes())), [])

  const [appsOrder, setAppsOrder] = useState<string[]>(loadAppsOrder)
  const [hiddenApps, setHiddenApps] = useState<string[]>(loadHiddenApps)
  // Меню у иконки (ПКМ): что за приложение и где рисовать. Координаты — относительно раздела.
  const [iconMenu, setIconMenu] = useState<{ app: AppDef; x: number; y: number } | null>(null)
  const everyApp: AppDef[] = orderApps([...APPS, ...customApps.map(customToDef)], appsOrder)
  // ⚠️ Спрятанное убирается только с ЭКРАНА: открытый слот с ним продолжает работать, пока его не
  // закроют. Иначе «скрыть» на глазах убивало бы наполовину введённое в приложении.
  const allApps: AppDef[] = everyApp.filter((a) => !hiddenApps.includes(a.id))
  // ⚠️ Отдельного списка спрятанных больше нет: во вкладке «Приложения» они стоят в общем списке
  // с выключенным тумблером. Прежний блок «Скрытые с экрана» появлялся и исчезал сам, и был
  // единственной дверью назад — при том что прячут приложение совсем в другом месте.

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
      // Следом — лист настроек: он тоже «поверх» экрана, и закрывать его повторным кликом по
      // «Настроить» было единственным способом.
      if (sheetOpen) { e.stopPropagation(); setSheetOpen(false); return }
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
  }, [openApps, iconMenu, activeApp, sheetOpen])

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

// ── Домашний экран: виджеты + сетка иконок ───────────────────────────────────────────────────
// labelTone: чем красить подписи иконок.
// ⚠️ Раньше решение принималось по факту «обои есть» — и белая подпись ложилась в том числе на
// Горчицу, Лайм, Небо, Персик, Жемчуг и три Бумаги, где её не прочитать. Светлоту объявляет сам
// пресет (флаг light в WALLPAPER_PRESETS), панель просто перестала это игнорировать; живой
// градиент и своя картинка светлоты не объявляют — там остаётся белая с тенью.
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

// Краска глифа там, где светлая не годится. ⚠️ Ходит ПАРОЙ к плитке, как и везде в системе:
// на горчице, небе и бумаге белый силуэт даёт меньше 3:1 — то же правило, что у fillInk на
// плитках стола и у краски погоды.
const GLYPH_TINT: Record<string, string> = {
  counter: 'var(--appicon-glyph-dark)',
  kitten: 'var(--appicon-glyph-dark)',
  webcustom: 'var(--appicon-glyph-dark)',
  // Бумажная плитка: цвет целиком берёт на себя глиф. Страсть из плакатного набора —
  // фиолетового в системе нет, см. --tile-* в colors.css.
  color: 'var(--poster-passion)',
  // ⚠️ «Пояса» — плитка ТЁМНАЯ, а не светлая, но глиф на ней всё равно цветной: янтарное
  // солнце на ночном небе. Единственная такая пара в наборе, ради неё PAPER_TILES ниже
  // перечисляется руками, а не выводится из ключей этой таблицы.
  zones: '#F5B544',   // тёплый янтарь
}

// БУМАЖНЫМ плиткам нужна собственная кромка: на светлых обоях они иначе сливаются с фоном.
// ⚠️ Список явный, а не производный от GLYPH_TINT: тёмный глиф есть и у горчицы с небом, но
// кромка им не нужна — они сами по себе краска.
const PAPER_TILES = new Set(['color', 'webcustom'])

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
  const paper = PAPER_TILES.has(app.id)
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
      filter: shadow ? 'drop-shadow(0 2px 5px rgba(12,14,24,0.22))' : undefined,
    }}>
      <span style={{
        ...squircle,
        position: 'relative', width: size, height: size,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: app.gradient,
        // Кромка ВНУТРЕННЕЙ тенью, а не border: border лёг бы поверх маски прямоугольником.
        boxShadow: paper ? 'inset 0 0 0 1px rgba(20,20,15,0.12)' : undefined,
      }}>
        {/* ⚠️ Слоёв света здесь БОЛЬШЕ НЕТ. Их было три (радиальная засветка сверху-слева,
            светлая кромка по верху, затемнение к низу) — язык иконок iOS, который и читался как
            «переливы». Материал теперь даёт ЗЕРНО: тот же рецепт, что на плитках стола и на
            земле окна, — плоская краска плюс фактура, а не имитация освещения. */}
        <span aria-hidden style={{ ...grain, borderRadius: 'inherit' }} />

        {hasGlyph(app.id) || (app.kind === 'web' && hasGlyph('web')) ? (
          <span style={{ position: 'relative', display: 'inline-flex' }}>
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
          }} />
        ) : Icon !== null ? (
          <Icon size={iconSize} strokeWidth={2.4} style={{ color: glyphColor, position: 'relative' }} />
        ) : (
          <span style={{
            fontSize: Math.round(iconSize * 0.82), fontWeight: 600, lineHeight: 1,
            color: glyphColor, position: 'relative',
          }}>
            {app.label.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
    </span>
  )
}


// Столбцов в сетке иконок. Держится рядом с самой сеткой: по нему же ходят стрелки вверх/вниз,
// и разъехавшись, они бы прыгали через ряд.
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

function HomeGrid({ apps, openApps, onOpen, onReorder, onIconMenu, widgets, weatherCity, labelTone }: {
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

// ── Виджеты домашнего экрана ─────────────────────────────────────────────────────────────────
// ⚠️ Высота 1 («туман»): карточки панели ВСЕГДА лежат поверх обоев хаба, а сплошная заливка
// поверх картинки читается заплаткой — тот же разбор, что у виджетов стола (см. altitude в
// src/styles/system.ts). До этой правки панель жила по старым правилам и в редизайн не входила
// вовсе — живая жалоба «панель с хабом наш редизайн как будто не трогает».
const widgetCardStyle: React.CSSProperties = {
  ...altitude(ALTITUDE.mist, { content: true }),
  padding: '10px 12px', flexShrink: 0,
}

/**
 * Плитка виджета панели.
 *
 * ⚠️ Тот же материал, что на столе: плоская краска плюс зерно. До этой правки виджеты панели
 * были стеклянными строками с эмодзи вместо значка — третий способ рисовать те же данные,
 * которые стол уже показывает капсой и дисплейной гарнитурой.
 */
function PanelTile({ bg, ink, children }: {
  bg: string
  ink: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden', flexShrink: 0,
      padding: '10px 12px', borderRadius: 'var(--radius-card)',
      background: bg, color: ink,
      boxShadow: 'var(--shadow-card)',
    }}>
      <span aria-hidden style={grain} />
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  )
}

/** Подпись плитки — моноширинная капса, как на столе (TileCaption). */
function PanelCaption({ children }: { children: React.ReactNode }) {
  return <div style={{ ...CAPS, color: 'inherit', opacity: 0.72 }}>{children}</div>
}

/** Ключевое число — дисплейной гарнитурой с табличными цифрами (TileValue). */
function PanelValue({ children, size }: { children: React.ReactNode; size: number }) {
  return <span style={{ ...DISPLAY, fontSize: size, fontWeight: 600, lineHeight: 1 }}>{children}</span>
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

  if (data === null) {
    return (
      <div style={widgetCardStyle}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
        }}>
          <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
          Погода…
        </span>
      </div>
    )
  }

  if (!data.ok) {
    return (
      <div style={{ ...widgetCardStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
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
    )
  }

  const code = data.weatherCode ?? 0
  // ⚠️ Время суток панели никто не присылает — берём его из самой погоды: ночью Open-Meteo
  // отдаёт коды с ночными значками, а для краски достаточно часа по месту.
  const hour = new Date().getHours()
  const isDay = hour >= 7 && hour <= 20
  const skin = weatherSkin(code, isDay)

  return (
    <PanelTile bg={skin.bg} ink={skin.ink}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PanelCaption>{data.city}</PanelCaption>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <PanelValue size={30}>{data.tempC !== undefined ? fmtTemp(data.tempC) : '—'}</PanelValue>
            <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.85, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {wmoText(code)}
              {data.windKmh !== undefined ? ` · ветер ${Math.round(data.windKmh)} км/ч` : ''}
            </span>
          </div>
        </div>
        <WeatherIcon code={code} day={isDay} size={40} />
      </div>
    </PanelTile>
  )
}

// Пары для виджета курсов — две самые ходовые, компактно (полный список — в конвертере).
const WIDGET_CURRENCIES: { code: string; sym: string }[] = [
  { code: 'USD', sym: '$' },
  { code: 'EUR', sym: '€' },
]

function CurrencyWidget() {
  const [rates, setRates] = useState<CurrencyRatesData | null>(cachedCurrencyRates())
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
    const cached = cachedCurrencyRates()
    if (cached) { setRates(cached); return }
    load()
  }, [])

  if (rates === null && error === null) {
    return (
      <div style={widgetCardStyle}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
        }}>
          <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
          Загружаю…
        </span>
      </div>
    )
  }

  if (error !== null) {
    return (
      <div style={{ ...widgetCardStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
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
    )
  }

  // ⚠️ Бумага, а не краска: ярких плоскостей на экране и так хватает — обои плюс погода. То же
  // решение, что у плитки курсов на столе (там она идёт за темой, а не за цветом).
  return (
    <PanelTile bg="var(--wallpaper-paper)" ink="var(--on-poster-dark)">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <PanelCaption>Курс ЦБ</PanelCaption>
        <span style={{ flex: 1 }} />
        {rates !== null && rates.date !== '' && <PanelCaption>{rates.date}</PanelCaption>}
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 6, flexWrap: 'wrap' }}>
        {rates !== null && WIDGET_CURRENCIES.map(({ code, sym }) => {
          const value = rates.rates[code]
          if (value === undefined) return null
          return (
            <span key={code} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.7 }}>{sym}</span>
              <PanelValue size={22}>{value.toFixed(2).replace('.', ',')}</PanelValue>
            </span>
          )
        })}
      </div>
    </PanelTile>
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
