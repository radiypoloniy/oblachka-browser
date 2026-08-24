// Поповер быстрого поиска (Ctrl+E) — отдельная WebContentsView поверх страницы, сверху по
// центру КОНТЕНТНОЙ зоны. Построен ровно по образцу FindBarManager (тот же расчёт геометрии,
// та же живучесть вью, тот же возврат OS-фокуса странице) — отличается только содержимым.
//
// Почему отдельная вью, а не оверлей в DOM страницы: во-первых, CSP многих сайтов такое просто
// не пустит; во-вторых (и главное) — страница смогла бы читать, что человек печатает в поиске.
// Ввод должен жить в НАШЕМ процессе рендеринга, недоступном сайту.
//
// Про фокус: здесь он нам НУЖЕН (в отличие от дропдауна подсказок, где стоит страж, возвращающий
// фокус чрому) — поэтому копируется поведение FindBar: явный wc.focus() при показе и явный
// focusActiveView() при закрытии, иначе Ctrl+E повторно не долетит до before-input-event.
import { WebContentsView, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import path from 'node:path'
import type { ContentBounds, SearchTarget, QuickHit, QuickQueryResult } from '../shared/ipc'
import { getAiPanelReservedWidth } from './AiPanelManager'
import type { TabManager } from './TabManager'
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';

// ⚠️ Ширина и базовая высота ДУБЛИРУЮТСЯ в src/searchpopover.tsx (WIDTH) — держать в синхроне.
// Здесь они задают размер самой вью, там — ширину карточки внутри неё; разойдутся — карточка
// либо обрежется, либо повиснет в пустой вью.
const POPOVER_WIDTH = 720
// Высота БЕЗ списка находок — с ним карточка растёт, и её сообщает сам поповер (см.
// 'searchpopover:resize'): сколько строк поместилось, знает только он.
const POPOVER_BASE_HEIGHT = 140
const TOP_GAP = 8

export interface SearchPopoverContext {
  targets: SearchTarget[]
  // Выделенный на странице текст — поповер открывается уже заполненным им.
  prefill: string
}

export interface SearchRunRequest {
  query: string
  target: SearchTarget
  // true — открыть в текущей вкладке (Ctrl+Enter). По умолчанию поиск уходит в новую, чтобы
  // страница, с которой человек искал, никуда не девалась.
  sameTab: boolean
}

let popoverView: WebContentsView | null = null
let attachedWin: BrowserWindow | null = null
let resizeBoundWin: BrowserWindow | null = null
let ipcRegistered = false
let tabManagerRef: TabManager | null = null
let onRunCb: ((req: SearchRunRequest) => void) | null = null
let onQueryCb: ((text: string) => QuickQueryResult) | null = null
let onOpenCb: ((hit: QuickHit) => void) | null = null
// Текущая высота карточки. Сбрасывается на базовую при каждом показе: поповер открывается
// пустым, и висящая с прошлого раза высота дала бы пустой прямоугольник поверх страницы.
let popoverHeight = POPOVER_BASE_HEIGHT
// Контекст последнего показа: вью персистентная, а did-finish-load бывает только раз — при
// повторных открытиях контекст досылается явным сигналом (тот же приём, что у FindBar).
let pendingContext: SearchPopoverContext | null = null
let lastContentBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 }

export function setTabManager(tm: TabManager): void {
  tabManagerRef = tm
}

// Что делать с введённым запросом, решает main.ts (он владеет вкладками) — менеджер знает
// только про свою вью.
export function setOnSearchRun(cb: (req: SearchRunRequest) => void): void {
  onRunCb = cb
}

// Поиск по своим данным и открытие находки — тоже main: вкладки, история и закладки живут там.
export function setOnQuickQuery(cb: (text: string) => QuickQueryResult): void {
  onQueryCb = cb
}

export function setOnQuickOpen(cb: (hit: QuickHit) => void): void {
  onOpenCb = cb
}

function computeBounds(): { x: number; y: number; width: number; height: number } {
  const cb = lastContentBounds
  const aiPanelWidth = attachedWin ? getAiPanelReservedWidth(attachedWin) : 0
  const naiveRight = cb.x + cb.width / 2 + POPOVER_WIDTH / 2
  const panelLeft = cb.x + cb.width - aiPanelWidth
  const usableRight = naiveRight > panelLeft ? panelLeft : cb.x + cb.width
  const x = (cb.x + usableRight) / 2 - POPOVER_WIDTH / 2
  const y = cb.y + TOP_GAP
  // Ниже контентной зоны карточка уехать не имеет права: WebContentsView не обрезается окном
  // и вылезла бы за него целиком, вместе со списком находок.
  const maxHeight = Math.max(POPOVER_BASE_HEIGHT, cb.height - TOP_GAP * 2)
  return {
    x: x - SHADOW_MARGIN,
    y: y - SHADOW_MARGIN,
    width: POPOVER_WIDTH + SHADOW_MARGIN * 2,
    height: Math.min(popoverHeight, maxHeight) + SHADOW_MARGIN * 2,
  }
}

// Единственный источник истины «открыт ли поповер» — факт прикрепления вью, а не отдельный
// флаг: тот мог бы разойтись с реальностью (разбор — в шапке FindBarManager.ts).
function isAttached(): boolean {
  return !!popoverView && !!attachedWin && attachedWin.contentView.children.includes(popoverView)
}

function layout(): void {
  if (!isAttached()) return
  popoverView!.setBounds(computeBounds())
}

// Зовётся из main.ts на каждый CONTENT_SET_BOUNDS. Нулевые bounds — сентинел «контент скрыт»
// (открыты настройки/история/загрузки): поповер прячем вместе со страницей.
export function syncSearchPopoverBounds(b: ContentBounds): void {
  lastContentBounds = b
  if (b.width === 0 && b.height === 0) {
    closeSearchPopover()
    return
  }
  layout()
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.on('searchpopover:close', () => {
    closeSearchPopover()
    // Без явного возврата фокуса странице Ctrl+E повторно не сработает: before-input-event
    // молчит на вкладке, у которой нет OS-фокуса (тот же урок, что у FindBar).
    tabManagerRef?.focusActiveView()
  })

  ipcMain.on('searchpopover:run', (_e, req: SearchRunRequest) => {
    closeSearchPopover()
    onRunCb?.(req)
  })

  ipcMain.handle('searchpopover:query', (_e, text: string) =>
    onQueryCb?.(text) ?? { hits: [], bangTarget: null, strippedQuery: text })

  ipcMain.on('searchpopover:open', (_e, hit: QuickHit) => {
    closeSearchPopover()
    onOpenCb?.(hit)
  })

  ipcMain.on('searchpopover:resize', (_e, height: number) => {
    if (typeof height !== 'number' || !Number.isFinite(height)) return
    const next = Math.max(POPOVER_BASE_HEIGHT, Math.round(height))
    if (next === popoverHeight) return
    popoverHeight = next
    layout()
  })
}

function ensureView(): WebContentsView {
  if (popoverView) return popoverView
  popoverView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-searchpopover.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  })
  // Обязателен на самой вью: без него вокруг карточки виден непрозрачный прямоугольник-подложка.
  popoverView.setBackgroundColor('#00000000')
  popoverView.webContents.once('did-finish-load', () => {
    if (pendingContext) popoverView?.webContents.send('searchpopover:show', pendingContext)
    popoverView?.webContents.focus()
  })
  popoverView.webContents.loadURL('oblako-chrome://localhost/searchpopover.html')
  return popoverView
}

export function showSearchPopover(win: BrowserWindow, ctx: SearchPopoverContext): void {
  ensureIpcRegistered()
  attachedWin = win
  pendingContext = ctx
  // Открываемся всегда пустыми — высота с прошлого показа оставила бы поверх страницы
  // пустой прямоугольник до первого ввода.
  popoverHeight = POPOVER_BASE_HEIGHT
  if (resizeBoundWin !== win) {
    win.on('resize', layout)
    resizeBoundWin = win
  }

  if (isAttached()) {
    // Повторный Ctrl+E при открытом поповере — обновить контекст и выделить набранное
    // (тот же UX, что у повторного Ctrl+F). layout() обязателен: высоту мы только что сбросили
    // в базовую, и без пересчёта вью осталась бы растянутой с прошлого показа — прозрачной,
    // но перехватывающей клики по странице под собой.
    layout()
    popoverView?.webContents.send('searchpopover:show', ctx)
    popoverView?.webContents.focus()
    return
  }

  const firstTime = popoverView === null
  const view = ensureView()
  view.setBounds(computeBounds())
  win.contentView.addChildView(view) // последней → нативный z-order поверх вкладки
  if (!firstTime) {
    // Вью уже загружалась — did-finish-load повторно не сработает, шлём контекст явно.
    view.webContents.send('searchpopover:show', ctx)
    view.webContents.focus()
  }
}

// Открытие/закрытие AI-панели меняет свободную ширину, под которую центрируется поповер.
export function relayoutSearchPopover(): void {
  layout()
}

export function closeSearchPopover(): void {
  if (!isAttached()) return
  try { attachedWin!.contentView.removeChildView(popoverView!) } catch { /* окно могло закрыться */ }
}
