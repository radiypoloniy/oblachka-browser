// Дропдаун подсказок омнибокса — отдельная WebContentsView-оверлей поверх страницы, под самим
// омнибоксом (не под всей контентной зоной, как FindBar). Заход 2/5 переезда с chrome-DOM:
// только показ/позиционирование/статичный тестовый список — старый React-дропдаун (Toolbar.tsx,
// buildSuggestions, OMNIBOX_SUGGEST_RESERVE) работает ПАРАЛЛЕЛЬНО и этим модулем не тронут.
//
// ⚠️ Единственное принципиальное отличие от FindBar/AI-панели/поповера — эта вью НИКОГДА не
// вызывает webContents.focus(). Фокус должен остаться в омнибоксе (другой webContents,
// chromeView) — addChildView сам по себе OS-фокус не крадёт (подтверждено поведением, добытым
// в ad5cfed/при отладке FindBar: Windows не передаёт фокус дочерним view автоматически, значит
// бездействие здесь — и есть решение, а не случайность).
//
// isAttached()-проверка по факту прикрепления вместо отдельного флага — тот же урок, что и в
// FindBarManager.ts (флаг мог разойтись с реальностью и ломать повторный показ).
import { WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import path from 'node:path'
import type { ContentBounds } from '../shared/ipc'

const GAP = 4 // зазор между низом омнибокса и верхом дропдауна
// Временная фиксированная высота под статичный тестовый список (3 строки) — заход 3 сделает
// её производной от реального количества/контента подсказок.
const DROPDOWN_HEIGHT = 140
// Прозрачный запас под CSS box-shadow — WebContentsView обрезает всё, что рисуется за границей
// своего прямоугольника (тот же приём, что SHADOW_MARGIN в FindBarManager.ts/TranslatePopoverManager.ts).
const SHADOW_MARGIN = 16

let dropdownView: WebContentsView | null = null
let attachedWin: BrowserWindow | null = null
let resizeBoundWin: BrowserWindow | null = null
// Последний присланный прямоугольник омнибокса (см. IPC.OMNIBOX_SET_BOUNDS, main.ts).
let lastOmniboxBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 }

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

function ensureDropdownView(): WebContentsView {
  if (dropdownView) return dropdownView
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
  // Тестовый статичный список — заход 3 заменит на реальные подсказки по мере ввода.
  // ⚠️ Здесь НЕТ wc.focus() — единственное отличие от аналогичного момента в FindBarManager.ts.
  dropdownView.webContents.once('did-finish-load', () => {
    dropdownView?.webContents.send('suggest-dropdown:items', ['test 1', 'test 2', 'test 3'])
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

export function hideSuggestDropdown(): void {
  if (!isAttached()) return
  try { attachedWin!.contentView.removeChildView(dropdownView!) } catch { /* окно могло уже закрыться */ }
}
