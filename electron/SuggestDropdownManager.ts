// Дропдаун подсказок омнибокса — отдельная WebContentsView-оверлей поверх страницы, под самим
// омнибоксом (не под всей контентной зоной, как FindBar). Заход 3/5 переезда с chrome-DOM:
// живые подсказки + мышиный выбор (клик) — клавиатура ещё заход 4. Старый React-дропдаун
// (Toolbar.tsx, buildSuggestions, OMNIBOX_SUGGEST_RESERVE) работает ПАРАЛЛЕЛЬНО и не тронут.
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
// Фиксированная высота вью — как maxHeight старого дропдауна (Toolbar.tsx), тот же приём:
// список внутри скроллится (overflowY:auto в suggestdropdown.tsx), а не растягивает вью под
// количество строк (до SUGGEST_MAX=8) — без нового IPC для динамического ресайза.
const DROPDOWN_HEIGHT = 280
// Прозрачный запас под CSS box-shadow — WebContentsView обрезает всё, что рисуется за границей
// своего прямоугольника (тот же приём, что SHADOW_MARGIN в FindBarManager.ts/TranslatePopoverManager.ts).
const SHADOW_MARGIN = 16

let dropdownView: WebContentsView | null = null
let attachedWin: BrowserWindow | null = null
let resizeBoundWin: BrowserWindow | null = null
let ipcRegistered = false
// Последний присланный прямоугольник омнибокса (см. IPC.OMNIBOX_SET_BOUNDS, main.ts).
let lastOmniboxBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 }
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

function computeBounds(): { x: number; y: number; width: number; height: number } {
  const ob = lastOmniboxBounds
  const x = ob.x
  const y = ob.y + ob.height + GAP
  const result = {
    x: x - SHADOW_MARGIN,
    y: y - SHADOW_MARGIN,
    width: ob.width + SHADOW_MARGIN * 2,
    height: DROPDOWN_HEIGHT + SHADOW_MARGIN * 2,
  }
  console.log(`[suggest-dropdown] computeBounds: omnibox=${JSON.stringify(ob)} -> ${JSON.stringify(result)}`)
  return result
}

function layoutDropdown(): void {
  if (!isAttached()) return
  dropdownView!.setBounds(computeBounds())
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
  attachedWin = win
  if (resizeBoundWin !== win) {
    win.on('resize', layoutDropdown) // подписка один раз на окно, как layoutPanel в AiPanelManager
    resizeBoundWin = win
  }

  if (isAttached()) return // уже показан — просто пересчитать (см. layoutDropdown выше)

  const view = ensureDropdownView()
  view.setBounds(computeBounds())
  win.contentView.addChildView(view) // последней → нативный z-order поверх уже добавленной вкладки
  // ⚠️ НИКАКОГО view.webContents.focus() здесь — критичный инвариант этого модуля.
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
  if (!isAttached()) return
  try { attachedWin!.contentView.removeChildView(dropdownView!) } catch { /* окно могло уже закрыться */ }
}
