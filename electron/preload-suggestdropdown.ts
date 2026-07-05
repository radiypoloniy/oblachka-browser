// Минимальный preload для вью дропдауна подсказок (src/suggestdropdown.tsx). Своя маленькая
// точка входа, не боевой preload.ts (тот же принцип, что у preload-findbar.ts/preload-aipanel.ts).
// Заход 4/5: + клавиатурная подсветка (onHighlight) — вью только отрисовывает номер, ничего не решает.
import { contextBridge, ipcRenderer } from 'electron'
import type { SuggestDropdownItem } from '../shared/ipc'

contextBridge.exposeInMainWorld('suggestDropdown', {
  onItems: (cb: (items: SuggestDropdownItem[]) => void) => {
    const handler = (_e: unknown, items: SuggestDropdownItem[]) => cb(items)
    ipcRenderer.on('suggest-dropdown:items', handler)
    return () => ipcRenderer.removeListener('suggest-dropdown:items', handler)
  },
  // Клик по строке — уходит в main как есть, main пересылает в chrome (IPC.SUGGEST_DROPDOWN_PICKED),
  // где Toolbar.tsx вызывает свой существующий pickSuggestion() (см. SuggestDropdownManager.ts::onPick).
  pick: (item: SuggestDropdownItem) => ipcRenderer.send('suggest-dropdown:pick', item),
  // Клавиатурная подсветка — номер строки от омнибокса (-1 = снять). Только отрисовка.
  onHighlight: (cb: (idx: number) => void) => {
    const handler = (_e: unknown, idx: number) => cb(idx)
    ipcRenderer.on('suggest-dropdown:highlight', handler)
    return () => ipcRenderer.removeListener('suggest-dropdown:highlight', handler)
  },
  // Заход 5 (кардинальный фикс): реальная высота карточки (ResizeObserver в suggestdropdown.tsx) —
  // main пересчитывает bounds самой вью под неё, вместо фиксированных 280px (см.
  // SuggestDropdownManager.ts). Тот же приём, что translate-popover:height у поповера перевода.
  reportHeight: (px: number) => ipcRenderer.send('suggest-dropdown:height', px),
})
