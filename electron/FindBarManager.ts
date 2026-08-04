// FindBar (Ctrl+F) — отдельная WebContentsView-оверлей поверх страницы, сверху по центру
// КОНТЕНТНОЙ зоны (не всего окна — иначе съедет влево из-за сайдбара). Тот же приём, что и у
// AI-панели/поповера перевода: отдельный view, добавленный ПОСЛЕДНИМ (нативный z-order), контент
// вкладки геометрически не трогаем — раньше FindBar откусывал полосу сверху через reserve в
// pushBounds (App.tsx), теперь просто перекрывает страницу без сдвига (как AI-панель справа).
//
// Живучесть — по образцу AiPanelManager (НЕ поповера): WebContentsView создаётся лениво один раз
// и переживает многократные show/close (add/removeChildView), а не пересоздаётся на каждый показ.
//
// ⚠️ ПАНЕЛЬ — СВОЯ У КАЖДОГО ОКНА. Модуль держал одну вью, одну геометрию контентной зоны и один
// менеджер вкладок на всё приложение; со вторым окном это разъезжается сразу: bounds, присланные
// из окна B, двигали бы панель, открытую в окне A, а результат поиска из A прилетал бы в панель B.
// Поэтому всё состояние лежит в карте по id окна и умирает вместе с ним. Вью по-прежнему создаётся
// лениво — окно, где Ctrl+F не жали, лишнего WebContentsView не заводит.
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
import type { TabManager } from './TabManager'

// ⚠️ Держать в синхроне с BAR_WIDTH в src/findbar.tsx. Шире прежних 360 — из-за кнопки режима
// «по смыслу» и словесного статуса вместо «3 / 12» (см. SmartFind.ts).
const FINDBAR_WIDTH = 420
const FINDBAR_HEIGHT = 48
const TOP_GAP = 8 // отступ от верха контентной зоны (под тулбаром — контентная зона и так под ним)
// Прозрачный запас под CSS box-shadow — WebContentsView обрезает всё, что рисуется за границей
// своего прямоугольника (тот же приём, что SHADOW_MARGIN в TranslatePopoverManager.ts/AiPanelManager.ts,
// здесь меньше — тень панели легче, чем у карточки поповера).
const SHADOW_MARGIN = 20

interface WindowFindBar {
  win: BrowserWindow
  view: WebContentsView | null
  resizeBound: boolean
  // Тот же приём, что AiPanelManager.setTabManager — только для чтения/вызова focusActiveView()
  // при закрытии по IPC (крестик/Esc-в-поле), см. ensureIpcRegistered ниже. Управление вкладками
  // этот модуль не трогает.
  tabs: TabManager | null
  // Последняя геометрия КОНТЕНТНОЙ зоны (не окна) — приходит из App.tsx::pushBounds через тот же
  // CONTENT_SET_BOUNDS, что двигает активную вкладку. Уже учитывает сайдбар (renderer меряет
  // contentRef, который физически начинается ПОСЛЕ сайдбара) — этого main из win.getContentBounds()
  // сам по себе не знает.
  contentBounds: ContentBounds
}

const bars = new Map<number, WindowFindBar>()
let ipcRegistered = false

function stateFor(win: BrowserWindow): WindowFindBar {
  const existing = bars.get(win.id)
  if (existing) return existing
  const created: WindowFindBar = {
    win, view: null, resizeBound: false, tabs: null,
    contentBounds: { x: 0, y: 0, width: 0, height: 0 },
  }
  bars.set(win.id, created)
  // Вместе с окном уходит и его панель: карта не должна копить записи мёртвых окон, а вью
  // Electron уничтожает сам вместе с contentView.
  win.once('closed', () => { bars.delete(win.id) })
  return created
}

export function setTabManager(win: BrowserWindow, tm: TabManager): void {
  stateFor(win).tabs = tm
}

// Центр — по СВОБОДНОЙ части контентной зоны, НО только если центрированный без поправки FindBar
// реально пересёкся бы с зоной AI-панели (она перекрывает правый край страницы, не двигая bounds
// самой вкладки, см. AiPanelManager.ts). На широком/фуллскрин окне места хватает и без сдвига —
// вычитать aiPanelWidth там не нужно (иначе FindBar нелепо уезжает влево, хотя перекрытия и так
// не было бы). Сдвигаем только когда naiveRight (правый край без поправки) заходит на панель.
function computeBounds(st: WindowFindBar): { x: number; y: number; width: number; height: number } {
  const cb = st.contentBounds
  const aiPanelWidth = getAiPanelReservedWidth(st.win)
  const naiveRight = cb.x + cb.width / 2 + FINDBAR_WIDTH / 2
  const panelLeft = cb.x + cb.width - aiPanelWidth
  const usableRight = naiveRight > panelLeft ? panelLeft : cb.x + cb.width
  const x = (cb.x + usableRight) / 2 - FINDBAR_WIDTH / 2
  const y = cb.y + TOP_GAP
  // ⚠️ Логировать здесь нельзя: функция зовётся на КАЖДЫЙ CONTENT_SET_BOUNDS, то есть на каждый
  // кадр ресайза окна и перетаскивания разделителя split. Прежний console.log с двумя
  // JSON.stringify исполнялся десятки раз в секунду в main-процессе — том самом, который в это
  // время двигает нативные вью (тот же довод, что уже записан для OMNIBOX_SET_BOUNDS).
  return {
    x: x - SHADOW_MARGIN,
    y: y - SHADOW_MARGIN,
    width: FINDBAR_WIDTH + SHADOW_MARGIN * 2,
    height: FINDBAR_HEIGHT + SHADOW_MARGIN * 2,
  }
}

// Единственный источник истины «открыта ли панель» — реальное присутствие вью среди детей
// contentView (тот же приём, что applySplitBounds/activate используют для вкладок:
// children.includes(view) перед addChildView). Раньше решение о show/close/refocus держалось на
// отдельном булевом isOpen, который мог разойтись с реальностью (если removeChildView не сработал
// по неучтённой причине) — тогда showFindBar() слепо доверял isOpen===true и выходил через
// refocus-ветку, ни разу не вызывая addChildView повторно: панель не появлялась, пока что-то
// постороннее (навигация → did-navigate → closeFindBar) случайно не приводило флаг в соответствие
// с фактом. Теперь флага нет вообще — факт и есть состояние.
function isAttached(st: WindowFindBar): boolean {
  return !!st.view && !st.win.isDestroyed() && st.win.contentView.children.includes(st.view)
}

function layoutFindBar(st: WindowFindBar): void {
  if (!isAttached(st)) return
  st.view!.setBounds(computeBounds(st))
}

// Вызывается из main.ts на каждый CONTENT_SET_BOUNDS (ресайз окна, сворачивание/разворот
// сайдбара — оба меняют геометрию contentRef в renderer, оба уже гоняют этот канал).
// width===0/height===0 — тот же сентинел, что renderer шлёт, когда открыты настройки/история/
// загрузки (см. pushBounds) — прячем FindBar вместе с контентом вкладки, а не оставляем висеть
// поверх панели настроек.
export function syncFindBarBounds(win: BrowserWindow, b: ContentBounds): void {
  const st = stateFor(win)
  st.contentBounds = b
  if (b.width === 0 && b.height === 0) {
    closeFindBar(win)
    return
  }
  layoutFindBar(st)
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  // Крестик / Esc-внутри-поля — надёжный путь закрытия (аналог translate-popover:close).
  // Esc, когда фокус НЕ в самом FindBar (на странице) — отдельный путь через findBarOpen в
  // TabManager.registerHotkeyHandler, не через этот канал (см. main.ts, onFindClose-колбэк).
  // focusActiveView() — обязателен: в момент этого IPC OS-фокус стоит на FindBar (см. wc.focus()
  // при показе), removeChildView его никуда не возвращает — без явного вызова Ctrl+F повторно
  // не долетает (before-input-event молчит на вкладке/chromeView, у которых нет OS-фокуса).
  //
  // ⚠️ Окно ищем по самой вью-отправителю: панелей теперь несколько, и закрывать надо ту, чей
  // крестик нажали. BrowserWindow.fromWebContents для дочерней вью возвращает null — тот же
  // случай, что в WindowRegistry.contextFromSender.
  ipcMain.on('findbar:close', (e) => {
    for (const st of bars.values()) {
      if (st.view?.webContents !== e.sender) continue
      closeFindBar(st.win)
      st.tabs?.focusActiveView()
      return
    }
  })
}

function ensureFindBarView(st: WindowFindBar): WebContentsView {
  if (st.view) return st.view
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-findbar.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  })
  st.view = view
  // Обязателен на самой view (не только CSS background:transparent) — иначе виден непрозрачный
  // прямоугольник-подложка вокруг панели (тот же инвариант, что у поповера/AI-панели).
  view.setBackgroundColor('#00000000')
  // Первая загрузка: показываем и фокусируем ПОСЛЕ did-finish-load — не раньше. Явный wc.focus()
  // здесь (а не полагание на какой-либо blur/focus-эвент) — тот же приём, что у поповера: Electron
  // сам шлёт focus→blur парой в первые ~50мс после addChildView (гонка инициализации виджета, не
  // уход фокуса пользователем), поэтому blur НИКОГДА не используется как триггер закрытия — только
  // явные сигналы (Esc/крестик через IPC, см. ensureIpcRegistered, и findBarOpen в TabManager).
  view.webContents.once('did-finish-load', () => {
    view.webContents.send('findbar:show')
    view.webContents.focus()
  })
  view.webContents.loadURL('oblako-chrome://localhost/findbar.html')
  return view
}

// Ctrl+F: открыть (первый раз) / показать заново (после close) / просто перефокусировать+выделить
// текущий запрос, если уже открыт (тот же UX, что был в App.tsx: повторный Ctrl+F выделяет текст
// в поле, а не открывает второй раз).
export function showFindBar(win: BrowserWindow): void {
  ensureIpcRegistered()
  const st = stateFor(win)
  if (!st.resizeBound) {
    win.on('resize', () => layoutFindBar(st)) // подписка один раз на окно, как layoutPanel в AiPanelManager
    st.resizeBound = true
  }

  // Решение «уже открыта → перефокусировать» или «нужно открыть» — по факту прикрепления
  // вью (isAttached()), не по флагу: тем самым эта проверка не может разойтись с реальностью.
  if (isAttached(st)) {
    st.view?.webContents.send('findbar:refocus')
    st.view?.webContents.focus()
    return
  }

  const firstTime = st.view === null
  const view = ensureFindBarView(st)
  view.setBounds(computeBounds(st))
  win.contentView.addChildView(view) // последней → нативный z-order поверх уже добавленной вкладки
  if (!firstTime) {
    // View уже когда-то загружался — did-finish-load повторно не сработает, шлём explicit сигнал
    // (аналог sendCurrentContext-при-повторном-открытии в AiPanelManager.toggleAiPanel).
    view.webContents.send('findbar:show')
    view.webContents.focus()
  }
}

// Вызывается из main.ts после toggleAiPanel() — открытие/закрытие AI-панели меняет свободную
// ширину, под которую центрируется FindBar (см. computeBounds), но само не знает о FindBar.
export function relayoutFindBar(win: BrowserWindow): void {
  layoutFindBar(stateFor(win))
}

// Ничего не возвращает и не хранит отдельный флаг — просто приводит реальное прикрепление к
// «откреплено», если оно ещё не такое. Идемпотентна: повторный вызов на уже открепленной вью —
// no-op (isAttached() уже false, до removeChildView дело не доходит).
export function closeFindBar(win: BrowserWindow | null): void {
  if (!win) return
  const st = bars.get(win.id)
  if (!st || !isAttached(st)) return
  try { st.win.contentView.removeChildView(st.view!) } catch { /* окно могло уже закрыться */ }
  // Не считаем закрытие успешным вслепую: если removeChildView по какой-то неучтённой причине
  // не открепил вью, isAttached() это тут же покажет — состояние остаётся консистентным с фактом
  // (следующий showFindBar() увидит isAttached()===true и просто перефокусирует, а не «потеряется»).
}

// Результат findInPage — пробрасываем в НАШУ view вместо chromeView (единственное изменение в
// самой трубе поиска: куда идёт push, а не как считается результат). Шлём, только если панель
// реально видна — та же проверка по факту, что и везде в этом модуле.
export function sendFindResult(win: BrowserWindow, r: FindResult): void {
  const st = bars.get(win.id)
  if (st && isAttached(st)) st.view!.webContents.send(IPC.FIND_RESULT, r)
}
