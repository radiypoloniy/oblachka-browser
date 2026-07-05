// Минимальный preload для вью дропдауна подсказок (src/suggestdropdown.tsx). Своя маленькая
// точка входа, не боевой preload.ts (тот же принцип, что у preload-findbar.ts/preload-aipanel.ts).
// Заход 3/5: живые подсказки + клик (мышиный выбор). Клавиатура — заход 4.
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
})
