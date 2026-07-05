// Минимальный preload для тестовой вью дропдауна подсказок (src/suggestdropdown.tsx).
// Заход 2/5: только статичный список, без клавиатуры/выбора — своя маленькая точка входа,
// не боевой preload.ts (тот же принцип, что у preload-findbar.ts/preload-aipanel.ts).
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('suggestDropdown', {
  onItems: (cb: (items: string[]) => void) => {
    const handler = (_e: unknown, items: string[]) => cb(items)
    ipcRenderer.on('suggest-dropdown:items', handler)
    return () => ipcRenderer.removeListener('suggest-dropdown:items', handler)
  },
})
