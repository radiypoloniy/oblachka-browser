// FindBar (Ctrl+F) — отдельная WebContentsView-оверлей поверх страницы, сверху по центру
// КОНТЕНТНОЙ зоны (не всего окна — иначе съедет влево из-за сайдбара). Тот же приём, что и у
// AI-панели/поповера перевода: отдельный view, добавленный ПОСЛЕДНИМ (нативный z-order), контент
// вкладки геометрически не трогаем — раньше FindBar откусывал полосу сверху через reserve в
// pushBounds (App.tsx), теперь просто перекрывает страницу без сдвига (как AI-панель справа).
//
// Живучесть — по образцу AiPanelManager (НЕ поповера): WebContentsView создаётся лениво один раз
// и переживает многократные show/close (add/removeChildView), а не пересоздаётся на каждый показ.
//
// Сама логика поиска (findInPage/findNext/stopFind, found-in-page, автосброс на навигации/смене
// вкладки) остаётся в TabManager.ts и IPC-каналах FIND_START/FIND_NEXT/FIND_STOP/FIND_RESULT —
// этот модуль их не трогает, только меняет, ГДЕ рисуется панель и куда идёт push результата.
import { WebContentsView, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import type { ContentBounds, FindResult } from '../shared/ipc'
import { getAiPanelReservedWidth } from './AiPanelManager'

const FINDBAR_WIDTH = 360
const FINDBAR_HEIGHT = 48
const TOP_GAP = 8 // отступ от верха контентной зоны (под тулбаром — контентная зона и так под ним)
// Прозрачный запас под CSS box-shadow — WebContentsView обрезает всё, что рисуется за границей
// своего прямоугольника (тот же приём, что SHADOW_MARGIN в TranslatePopoverManager.ts/AiPanelManager.ts,
// здесь меньше — тень панели легче, чем у карточки поповера).
const SHADOW_MARGIN = 20

let findBarView: WebContentsView | null = null
let attachedWin: BrowserWindow | null = null
let resizeBoundWin: BrowserWindow | null = null
let isOpen = false
let ipcRegistered = false
// Последняя геометрия КОНТЕНТНОЙ зоны (не окна) — приходит из App.tsx::pushBounds через тот же
// CONTENT_SET_BOUNDS, что двигает активную вкладку. Уже учитывает сайдбар (renderer меряет
// contentRef, который физически начинается ПОСЛЕ сайдбара) — этого main из win.getContentBounds()
// сам по себе не знает.
let lastContentBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 }

// Центр — по СВОБОДНОЙ части контентной зоны: если AI-панель открыта, она перекрывает правый
// край страницы (не двигая bounds самой вкладки, см. AiPanelManager.ts), поэтому центр без этой
// поправки попадал бы визуально ПОД панель на обычном окне (сайдбар уже сдвигает контент вправо,
// а AI-панель есть ещё ~400px справа — без вычитания её ширины они гарантированно перекрываются).
function computeBounds(): { x: number; y: number; width: number; height: number } {
  const cb = lastContentBounds
  const aiPanelWidth = attachedWin ? getAiPanelReservedWidth(attachedWin) : 0
  const usableRight = cb.x + cb.width - aiPanelWidth
  const x = (cb.x + usableRight) / 2 - FINDBAR_WIDTH / 2
  const y = cb.y + TOP_GAP
  const result = {
    x: x - SHADOW_MARGIN,
    y: y - SHADOW_MARGIN,
    width: FINDBAR_WIDTH + SHADOW_MARGIN * 2,
    height: FINDBAR_HEIGHT + SHADOW_MARGIN * 2,
  }
  console.log(`[findbar] computeBounds: content=${JSON.stringify(cb)} aiPanelWidth=${aiPanelWidth} -> ${JSON.stringify(result)}`)
  return result
}

function layoutFindBar(): void {
  if (!findBarView || !isOpen) return
  findBarView.setBounds(computeBounds())
}

// Вызывается из main.ts на каждый CONTENT_SET_BOUNDS (ресайз окна, сворачивание/разворот
// сайдбара — оба меняют геометрию contentRef в renderer, оба уже гоняют этот канал).
// width===0/height===0 — тот же сентинел, что renderer шлёт, когда открыты настройки/история/
// загрузки (см. pushBounds) — прячем FindBar вместе с контентом вкладки, а не оставляем висеть
// поверх панели настроек.
export function syncFindBarBounds(b: ContentBounds): void {
  lastContentBounds = b
  if (b.width === 0 && b.height === 0) {
    closeFindBar()
    return
  }
  layoutFindBar()
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  // Крестик / Esc-внутри-поля — надёжный путь закрытия (аналог translate-popover:close).
  // Esc, когда фокус НЕ в самом FindBar (на странице) — отдельный путь через findBarOpen в
  // TabManager.registerHotkeyHandler, не через этот канал (см. main.ts, onFindClose-колбэк).
  ipcMain.on('findbar:close', () => { if (attachedWin) closeFindBar() })
}

function ensureFindBarView(): WebContentsView {
  if (findBarView) return findBarView
  findBarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-findbar.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  })
  // Обязателен на самой view (не только CSS background:transparent) — иначе виден непрозрачный
  // прямоугольник-подложка вокруг панели (тот же инвариант, что у поповера/AI-панели).
  findBarView.setBackgroundColor('#00000000')
  // Первая загрузка: показываем и фокусируем ПОСЛЕ did-finish-load — не раньше. Явный wc.focus()
  // здесь (а не полагание на какой-либо blur/focus-эвент) — тот же приём, что у поповера: Electron
  // сам шлёт focus→blur парой в первые ~50мс после addChildView (гонка инициализации виджета, не
  // уход фокуса пользователем), поэтому blur НИКОГДА не используется как триггер закрытия — только
  // явные сигналы (Esc/крестик через IPC, см. ensureIpcRegistered, и findBarOpen в TabManager).
  findBarView.webContents.once('did-finish-load', () => {
    findBarView?.webContents.send('findbar:show')
    findBarView?.webContents.focus()
  })
  findBarView.webContents.loadURL('oblako-chrome://localhost/findbar.html')
  return findBarView
}

// Ctrl+F: открыть (первый раз) / показать заново (после close) / просто перефокусировать+выделить
// текущий запрос, если уже открыт (тот же UX, что был в App.tsx: повторный Ctrl+F выделяет текст
// в поле, а не открывает второй раз).
export function showFindBar(win: BrowserWindow): void {
  ensureIpcRegistered()
  attachedWin = win
  if (resizeBoundWin !== win) {
    win.on('resize', layoutFindBar) // подписка один раз на окно, как layoutPanel в AiPanelManager
    resizeBoundWin = win
  }

  if (isOpen) {
    findBarView?.webContents.send('findbar:refocus')
    findBarView?.webContents.focus()
    return
  }

  const firstTime = findBarView === null
  const view = ensureFindBarView()
  view.setBounds(computeBounds())
  win.contentView.addChildView(view) // последней → нативный z-order поверх уже добавленной вкладки
  isOpen = true
  if (!firstTime) {
    // View уже когда-то загружался — did-finish-load повторно не сработает, шлём explicit сигнал
    // (аналог sendCurrentContext-при-повторном-открытии в AiPanelManager.toggleAiPanel).
    view.webContents.send('findbar:show')
    view.webContents.focus()
  }
}

// Вызывается из main.ts после toggleAiPanel() — открытие/закрытие AI-панели меняет свободную
// ширину, под которую центрируется FindBar (см. computeBounds), но само не знает о FindBar.
export function relayoutFindBar(): void {
  layoutFindBar()
}

export function closeFindBar(): void {
  if (!findBarView || !isOpen) return
  if (attachedWin) {
    try { attachedWin.contentView.removeChildView(findBarView) } catch { /* окно могло уже закрыться */ }
  }
  isOpen = false
}

// Результат findInPage — пробрасываем в НАШУ view вместо chromeView (единственное изменение в
// самой трубе поиска: куда идёт push, а не как считается результат).
export function sendFindResult(r: FindResult): void {
  if (findBarView && isOpen) findBarView.webContents.send(IPC.FIND_RESULT, r)
}
