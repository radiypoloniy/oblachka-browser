// Минимальный preload поповера быстрого поиска (src/searchpopover.tsx). Свои маленькие каналы
// (searchpopover:*), не часть контракта основного хрома — как у findbar/translate-popover:
// поповер живёт в изолированной WebContentsView и боевой preload.ts ему не положен.
import { contextBridge, ipcRenderer } from 'electron'
import type { SearchTarget } from '../shared/ipc'

export interface SearchPopoverShowPayload {
  targets: SearchTarget[]
  prefill: string
}

contextBridge.exposeInMainWorld('searchPopover', {
  // Показ (первый или повторный) — приходит список целей и текст выделения со страницы.
  onShow: (cb: (p: SearchPopoverShowPayload) => void) => {
    const handler = (_e: unknown, p: SearchPopoverShowPayload) => cb(p)
    ipcRenderer.on('searchpopover:show', handler)
    return () => ipcRenderer.removeListener('searchpopover:show', handler)
  },
  run: (query: string, target: SearchTarget, sameTab: boolean) =>
    ipcRenderer.send('searchpopover:run', { query, target, sameTab }),
  close: () => ipcRenderer.send('searchpopover:close'),
})
