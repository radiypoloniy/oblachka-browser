// Веб-приложения раздела «Приложения» AI-панели: чужой сайт (Яндекс.Переводчик, пользовательские
// URL) живёт в СОБСТВЕННОЙ WebContentsView, которую main кладёт в «дырку», размеченную панелью
// (см. WebAppSlot в src/components/aiApps.tsx) — тот же приём, что TabManager с областью
// контента вкладки. iframe внутри панели не вариант: X-Frame-Options/frame-ancestors режут
// встраивание у большинства сайтов, а пускать чужой сайт в webContents панели (там preload с
// ipcRenderer) нельзя по изоляции.
//
// Изоляция view намеренно максимальная: sandbox + contextIsolation, БЕЗ preload — чужому сайту
// не положен никакой мост Oblako. session.defaultSession (по умолчанию) — значит адблок,
// разрешения сайтов и куки/логины работают как в обычных вкладках.
//
// Координаты сюда приходят уже АБСОЛЮТНЫЕ (окно) — перевод из вьюпорта панели делает
// AiPanelManager.ts (только он знает ширину дока и высоту тулбара).
import { WebContentsView } from 'electron'
import type { BrowserWindow, Rectangle } from 'electron'
import type { TabManager } from './TabManager'

interface WebAppEntry {
  view: WebContentsView
  bounds: Rectangle | null // последние ненулевые bounds; null — панель ещё не мерила дырку
  visible: boolean         // view сейчас добавлена в contentView
}

const apps = new Map<string, WebAppEntry>()
// Панель открыта (setPanelVisible) — только тогда view добавляются в окно; при закрытой панели
// bounds продолжают копиться (renderer панели жив в фоне), но ничего не показывается.
let panelShown = false

// Тот же путь, что у AiPanelManager: ссылка прокидывается из него (setTabManager там форвардит
// сюда) — window.open/чужие target=_blank уходят обычной вкладкой Oblako, не новым окном.
let tabManagerRef: TabManager | null = null
export function setTabManager(tm: TabManager): void {
  tabManagerRef = tm
}

// Кому сообщить, что человек работает ИМЕННО в этом веб-приложении. ⚠️ Без этого сигнала панель
// про такой клик не узнаёт вовсе: сайт живёт в своей WebContentsView поверх панели и её событий
// мыши не порождает. А знать надо — по этому признаку рисуется рамка активного слота.
let onFocusCb: ((appId: string) => void) | null = null
export function setOnWebAppFocus(cb: (appId: string) => void): void {
  onFocusCb = cb
}

const HTTP_SCHEME = /^https?:\/\//i

// Мобильный UA для веб-слотов: слот шириной с экран телефона (~300–640px), но с десктопным UA
// сайты рисуют десктопную вёрстку — она в таком окне требует скролла и малофункциональна.
// С Android-UA Яндекс.Переводчик и большинство сайтов отдают компактную мобильную версию,
// свёрстанную ровно под эту ширину. Версия Chrome — реальная (из рантайма), не зашитая.
const MOBILE_UA = `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${process.versions.chrome} Mobile Safari/537.36`

export function openWebApp(win: BrowserWindow, appId: string, url: string): void {
  if (!HTTP_SCHEME.test(url)) return // только http(s) — file:/oblako-chrome: и прочее не пускаем
  if (apps.has(appId)) return // уже открыт (повторный маунт слота) — view переживает, не дублируем

  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false, // и так дефолт, но для чужого сайта фиксируем инвариант явно
      // preload намеренно отсутствует — см. шапку файла
    },
  })
  // Белый фон до первой отрисовки сайта — иначе в дырке мигает прозрачность/обои панели.
  view.setBackgroundColor('#FFFFFFFF')
  view.webContents.setUserAgent(MOBILE_UA) // ДО loadURL — первый же запрос уходит «с телефона»

  // Навигация ВНУТРИ слота разрешена (это мини-браузер: клик по ссылке в переводчике легитимен),
  // но только http(s) — попытка увести view на другой протокол глушится. will-redirect отдельно:
  // will-navigate не ловит СЕРВЕРНЫЙ редирект, а тот мог бы затащить в слот привилегированный
  // oblako-chrome:// или file://.
  view.webContents.on('will-navigate', (e, target) => {
    if (!HTTP_SCHEME.test(target)) e.preventDefault()
  })
  view.webContents.on('will-redirect', (e, target) => {
    if (!HTTP_SCHEME.test(target)) e.preventDefault()
  })
  // Новые окна (target=_blank/window.open) — обычной вкладкой браузера, Chromium-окно не даём.
  view.webContents.setWindowOpenHandler(({ url: target }) => {
    if (HTTP_SCHEME.test(target)) tabManagerRef?.createTab(target)
    return { action: 'deny' }
  })

  // Клик по сайту забирает фокус его вью — это и есть «человек работает здесь».
  view.webContents.on('focus', () => onFocusCb?.(appId))

  view.webContents.loadURL(url).catch((e) => console.error('[webapp] loadURL упал:', e))
  apps.set(appId, { view, bounds: null, visible: false })
  void win // win понадобится при первом setWebAppBounds — здесь view ещё не показывается
}

function hideEntry(win: BrowserWindow, entry: WebAppEntry): void {
  if (entry.visible) {
    win.contentView.removeChildView(entry.view)
    entry.visible = false
  }
}

// Нулевой прямоугольник (слот скрыт: режим чата/шит настроек поверх) → спрятать view.
export function setWebAppBounds(win: BrowserWindow, appId: string, rect: Rectangle): void {
  const entry = apps.get(appId)
  if (!entry) return
  if (rect.width < 2 || rect.height < 2) {
    hideEntry(win, entry)
    return
  }
  entry.bounds = rect
  if (!panelShown) return
  if (!entry.visible) {
    // addChildView ПОСЛЕ панели (она уже в contentView) → view поверх панели, в её дырке.
    win.contentView.addChildView(entry.view)
    entry.visible = true
  }
  entry.view.setBounds(rect)
}

export function closeWebApp(win: BrowserWindow, appId: string): void {
  const entry = apps.get(appId)
  if (!entry) return
  hideEntry(win, entry)
  entry.view.webContents.close() // штатное уничтожение webContents (Electron ≥25)
  apps.delete(appId)
}

// Открытие/закрытие всей AI-панели (AiPanelManager.toggleAiPanel/closePanel): веб-view живут
// и умирают ВМЕСТЕ с ней на экране, но переживают закрытие в памяти (как и renderer панели).
export function setPanelVisible(win: BrowserWindow, visible: boolean): void {
  panelShown = visible
  for (const entry of apps.values()) {
    if (!visible) {
      hideEntry(win, entry)
    } else if (entry.bounds) {
      if (!entry.visible) {
        win.contentView.addChildView(entry.view)
        entry.visible = true
      }
      entry.view.setBounds(entry.bounds)
    }
  }
}
