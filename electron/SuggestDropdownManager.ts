// Дропдаун подсказок омнибокса — отдельная WebContentsView-оверлей поверх страницы, под самим
// омнибоксом (не под всей контентной зоной, как FindBar). Единственная система дропдауна (заход 5:
// старый React-портал в Toolbar.tsx и резерв места под него — OMNIBOX_SUGGEST_RESERVE в App.tsx —
// удалены; контент вкладки больше никогда не двигается ради дропдауна, эта вью плавает поверх).
// Живые подсказки + мышиный выбор + клавиатурная подсветка (setHighlight ниже) — омнибокс остаётся
// ЕДИНСТВЕННЫМ владельцем selectedIdx, вью только рисует по номеру, Enter выполняется локально
// в омнибоксе без обращения к этой вью.
//
// ⚠️ Единственное принципиальное отличие от FindBar/AI-панели/поповера — эта вью НИКОГДА не
// вызывает webContents.focus(). Фокус должен остаться в омнибоксе (другой webContents,
// chromeView) — addChildView сам по себе OS-фокус не крадёт (подтверждено поведением, добытым
// в ad5cfed/при отладке FindBar: Windows не передаёт фокус дочерним view автоматически, значит
// бездействие здесь — и есть решение, а не случайность).
//
// isAttached()-проверка по факту прикрепления вместо отдельного флага — тот же урок, что и в
// FindBarManager.ts (флаг мог разойтись с реальностью и ломать повторный показ).
import { WebContentsView, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import path from 'node:path'
import type { ContentBounds, SuggestDropdownItem } from '../shared/ipc'

const GAP = 4 // зазор между низом омнибокса и верхом дропдауна
// Заход 5 (кардинальный фикс): высота вью больше НЕ фиксирована. Стартовая высота — до первого
// реального замера от suggestdropdown.tsx (ResizeObserver → 'suggest-dropdown:height', тот же
// приём, что INITIAL_HEIGHT/translate-popover:height у TranslatePopoverManager.ts) — держим её
// маленькой (высота ~1 строки), а не старым потолком в 280: цель этого захода — не накрывать
// вью лишней площадью (мёртвая хит-тест-зона перехватывала клики по кнопкам/контенту под собой —
// pointer-events между разными WebContentsView не работает, см. прецедент AI-панели). Реальная
// высота прилетает почти сразу после показа (did-finish-load уже отрендерил список), поэтому
// стартовый флеш короткий и безвредный — тот же компромисс, что и у поповера.
const INITIAL_HEIGHT = 48
// Прозрачный запас под CSS box-shadow — WebContentsView обрезает всё, что рисуется за границей
// своего прямоугольника (тот же приём, что SHADOW_MARGIN в FindBarManager.ts/TranslatePopoverManager.ts).
const SHADOW_MARGIN = 16

let dropdownView: WebContentsView | null = null
let attachedWin: BrowserWindow | null = null
let resizeBoundWin: BrowserWindow | null = null
let ipcRegistered = false
// Последний присланный прямоугольник омнибокса (см. IPC.OMNIBOX_SET_BOUNDS, main.ts).
let lastOmniboxBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 }
// Последняя реально измеренная высота карточки (см. 'suggest-dropdown:height' ниже) — вью
// персистентна между показами (в отличие от поповера), поэтому переиспользуем последнее известное
// значение при повторном открытии вместо того, чтобы каждый раз падать обратно на INITIAL_HEIGHT.
let currentHeight = INITIAL_HEIGHT
// Последний присланный список подсказок — переотправляется на did-finish-load, если вью ещё
// не успела загрузиться к моменту первого sendSuggestItems() (см. ensureDropdownView).
let lastItems: SuggestDropdownItem[] = []
// Колбэк на клик по строке (см. ensureIpcRegistered) — main.ts подписывается один раз при
// старте и пересылает выбор в chromeView (та же связка, что setTabManager у AiPanelManager).
let onPickCb: ((item: SuggestDropdownItem) => void) | null = null

export function onPick(cb: (item: SuggestDropdownItem) => void): void {
  onPickCb = cb
}

function isAttached(): boolean {
  return !!dropdownView && !!attachedWin && attachedWin.contentView.children.includes(dropdownView)
}

function computeBounds(height: number): { x: number; y: number; width: number; height: number } {
  const ob = lastOmniboxBounds
  const x = ob.x
  const y = ob.y + ob.height + GAP
  const result = {
    x: x - SHADOW_MARGIN,
    y: y - SHADOW_MARGIN,
    width: ob.width + SHADOW_MARGIN * 2,
    height: height + SHADOW_MARGIN * 2,
  }
  console.log(`[suggest-dropdown] computeBounds: omnibox=${JSON.stringify(ob)} height=${height} -> ${JSON.stringify(result)}`)
  return result
}

function layoutDropdown(): void {
  if (!isAttached()) return
  dropdownView!.setBounds(computeBounds(currentHeight))
}

// Вызывается из main.ts на каждый OMNIBOX_SET_BOUNDS (см. Toolbar.tsx::omniboxPillRef) —
// та же геометрия, что двигает и старый chrome-DOM дропдаун (позиционирование от toolbarRef).
export function syncOmniboxBounds(b: ContentBounds): void {
  lastOmniboxBounds = b
  layoutDropdown()
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  // Клик по строке во вью — просто пересылаем колбэку (main.ts форвардит в chromeView).
  // Не боевой канал (не в shared/ipc.ts) — это внутренняя механика ЭТОЙ вью, как и у
  // translate-popover:close/ai-panel:close (см. соответствующие *Manager.ts).
  ipcMain.on('suggest-dropdown:pick', (_e, item: SuggestDropdownItem) => { onPickCb?.(item) })

  // Заход 5 — реальная высота карточки (ResizeObserver в suggestdropdown.tsx). Math.max(1, px) —
  // защита от абсурдных 0/отрицательных значений (карточка ещё не отрендерилась/офскрин), тот же
  // приём, что Math.max(INITIAL_HEIGHT, px) у translate-popover:height.
  ipcMain.on('suggest-dropdown:height', (_e, px: number) => {
    currentHeight = Math.max(1, px)
    layoutDropdown()
  })
}

function ensureDropdownView(): WebContentsView {
  if (dropdownView) return dropdownView
  ensureIpcRegistered()
  dropdownView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-suggestdropdown.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  })
  // Обязателен на самой view (не только CSS background:transparent) — иначе виден непрозрачный
  // прямоугольник-подложка вокруг списка (тот же инвариант, что у FindBar/AI-панели/поповера).
  dropdownView.setBackgroundColor('#00000000')
  // Если sendSuggestItems() пришёл ДО того, как страница успела загрузиться, .send() тогда
  // ушёл бы в никуда (preload ещё не навесил ipcRenderer.on) — did-finish-load переотправляет
  // последний известный список явно, тем же приёмом, что 'findbar:show' в FindBarManager.ts.
  // ⚠️ Здесь НЕТ wc.focus() — единственное отличие от аналогичного момента в FindBarManager.ts.
  dropdownView.webContents.once('did-finish-load', () => {
    dropdownView?.webContents.send('suggest-dropdown:items', lastItems)
  })
  dropdownView.webContents.loadURL('oblako-chrome://localhost/suggestdropdown.html')
  return dropdownView
}

export function showSuggestDropdown(win: BrowserWindow): void {
  console.log(`[DD] showSuggestDropdown called, isAttached(before)=${isAttached()}`) // ВРЕМЕННЫЙ лог диагностики
  attachedWin = win
  if (resizeBoundWin !== win) {
    win.on('resize', layoutDropdown) // подписка один раз на окно, как layoutPanel в AiPanelManager
    resizeBoundWin = win
  }

  if (isAttached()) return // уже показан — просто пересчитать (см. layoutDropdown выше)

  const view = ensureDropdownView()
  view.setBounds(computeBounds(currentHeight))
  win.contentView.addChildView(view) // последней → нативный z-order поверх уже добавленной вкладки
  // ⚠️ НИКАКОГО view.webContents.focus() здесь — критичный инвариант этого модуля.
  console.log(`[DD] addChildView done, isAttached=${isAttached()}`) // ВРЕМЕННЫЙ лог диагностики
}

// Живой список подсказок (заход 3/5) — buildSuggestions в Toolbar.tsx шлёт его на каждый
// пересчёт (дебаунс 150мс). Лениво создаёт вью-приёмник, даже если она ещё не показана —
// показ/скрытие остаются исключительно делом showSuggestDropdown()/hideSuggestDropdown().
export function sendSuggestItems(items: SuggestDropdownItem[]): void {
  lastItems = items
  const view = ensureDropdownView()
  view.webContents.send('suggest-dropdown:items', items)
}

export function hideSuggestDropdown(): void {
  console.log(`[DD] hideSuggestDropdown called, isAttached=${isAttached()}`) // ВРЕМЕННЫЙ лог диагностики
  if (!isAttached()) return
  try { attachedWin!.contentView.removeChildView(dropdownView!) } catch { /* окно могло уже закрыться */ }
  console.log(`[DD] removeChildView done, isAttached=${isAttached()}`) // ВРЕМЕННЫЙ лог диагностики
}

// Клавиатурная подсветка (заход 4/5) — омнибокс держит selectedIdx, эта функция просто
// пересылает номер строки во вью (-1 снимает подсветку). Вью ничего не решает сама — источник
// истины остаётся в Toolbar.tsx. Если вью ещё не создана — подсвечивать нечего, no-op.
export function setHighlight(idx: number): void {
  dropdownView?.webContents.send('suggest-dropdown:highlight', idx)
}
