import type { CSSProperties } from 'react'
import { WALLPAPER_PRESETS } from '../../newtab/settings'
import { findMesh, meshCss } from '../../newtab/gradients'
import type { AppDef } from './types'

// Всё, что раздел «Приложения» помнит между запусками: свои веб-приложения, порядок и скрытые
// иконки, доля слотов, обои и набор виджетов. Чистые функции над localStorage — ни одного
// обращения к main и ни одной отрисовки.

export interface CustomWebApp { id: string; name: string; url: string }
const CUSTOM_APPS_KEY = 'aipanel-apps-webapps'

export function loadCustomApps(): CustomWebApp[] {
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
export function saveCustomApps(list: CustomWebApp[]): void {
  try { localStorage.setItem(CUSTOM_APPS_KEY, JSON.stringify(list)) } catch { /* см. loadWallpaper */ }
}
export function customToDef(c: CustomWebApp): AppDef {
  return { id: c.id, label: c.name, kind: 'web', icon: null, gradient: 'var(--appicon-webcustom)', url: c.url }
}

// ── Порядок иконок на домашнем экране ────────────────────────────────────────────────────────
// Хранится СПИСКОМ id, а не индексами: набор приложений меняется (встроенные добавляются с
// обновлениями, свои — руками), и любой индекс от этого протух бы молча.
// ⚠️ Неизвестные id дописываются В КОНЕЦ в их естественном порядке, а сохранённые, которых больше
// нет, просто игнорируются. Поэтому новое приложение появляется на экране, а удалённое не
// оставляет дырки — без всякой миграции хранилища.
const APPS_ORDER_KEY = 'aipanel-apps-order'

export function loadAppsOrder(): string[] {
  try {
    const raw = localStorage.getItem(APPS_ORDER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch { /* см. loadWallpaper */ }
  return []
}
export function saveAppsOrder(order: string[]): void {
  try { localStorage.setItem(APPS_ORDER_KEY, JSON.stringify(order)) } catch { /* см. loadWallpaper */ }
}
// ── Спрятанные с экрана приложения ───────────────────────────────────────────────────────────
// Встроенное приложение удалить нельзя (оно часть браузера), но и держать на глазах то, чем не
// пользуешься, незачем — поэтому «скрыть», с возвратом из «Настроить». Своё веб-приложение
// удаляется по-настоящему: его добавил человек, ему и решать.
const HIDDEN_APPS_KEY = 'aipanel-apps-hidden'

export function loadHiddenApps(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_APPS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch { /* см. loadWallpaper */ }
  return []
}
export function saveHiddenApps(ids: string[]): void {
  try { localStorage.setItem(HIDDEN_APPS_KEY, JSON.stringify(ids)) } catch { /* см. loadWallpaper */ }
}

// ── Размер слотов ────────────────────────────────────────────────────────────────────────────
// Доля высоты, которую занимает ВЕРХНИЙ слот, когда открыты оба. Границы 0.2…0.8 — не вкусовщина:
// у слота есть шапка с названием и кнопками (~36 px), и за пределами этой вилки от приложения
// остаётся одна шапка, то есть «схлопнул и не понял, куда делось».
const SPLIT_KEY = 'aipanel-apps-split'
export const SPLIT_MIN = 0.2
export const SPLIT_MAX = 0.8

export function loadSplit(): number {
  try {
    const raw = Number(localStorage.getItem(SPLIT_KEY))
    if (Number.isFinite(raw) && raw >= SPLIT_MIN && raw <= SPLIT_MAX) return raw
  } catch { /* см. loadWallpaper */ }
  return 0.5
}
export function saveSplit(v: number): void {
  try { localStorage.setItem(SPLIT_KEY, String(v)) } catch { /* см. loadWallpaper */ }
}

export function orderApps(all: AppDef[], order: string[]): AppDef[] {
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

export function saveCustomWallpaper(dataUrl: string): void {
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
export function wallpaperBackground(id: string): CSSProperties {
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
export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// ── Виджеты: конфиг и город для погоды ───────────────────────────────────────────────────────
// Персистентность та же, что у обоев (localStorage панели — косметика одного renderer'а).
export interface WidgetsConfig { weather: boolean; currency: boolean }
const WIDGETS_STORAGE_KEY = 'aipanel-apps-widgets'
const WEATHER_CITY_KEY = 'aipanel-weather-city'

export function loadWidgets(): WidgetsConfig {
  try {
    const raw = localStorage.getItem(WIDGETS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WidgetsConfig>
      return { weather: parsed.weather !== false, currency: parsed.currency !== false }
    }
  } catch { /* см. loadWallpaper */ }
  return { weather: true, currency: true }
}
export function saveWidgets(cfg: WidgetsConfig): void {
  try { localStorage.setItem(WIDGETS_STORAGE_KEY, JSON.stringify(cfg)) } catch { /* см. loadWallpaper */ }
}
export function loadWeatherCity(): string {
  try { return localStorage.getItem(WEATHER_CITY_KEY) || 'Москва' } catch { return 'Москва' }
}
export function saveWeatherCity(city: string): void {
  try { localStorage.setItem(WEATHER_CITY_KEY, city) } catch { /* см. loadWallpaper */ }
}
