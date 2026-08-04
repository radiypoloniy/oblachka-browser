// Минимальный preload для FindBar (src/findbar.tsx). Поиск (findInPage/findNext/stopFind) —
// боевые каналы shared/ipc.ts, переиспользуются напрямую (эта функциональность не новая, только
// вью, где она рисуется, поменялась). Открытие/закрытие/refocus самой панели — свой маленький
// канал (findbar:*), не часть контракта основного хрома, как и у translate-popover/ai-panel.
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { FindResult, SmartFindResult } from '../shared/ipc'

contextBridge.exposeInMainWorld('findbar', {
  search: (query: string, forward: boolean) => ipcRenderer.invoke(IPC.FIND_START, query, forward),
  // Смысловой режим: вопрос вместо подстроки (см. electron/SmartFind.ts). Подсветку ставит main
  // штатным findInPage — панели возвращается только статус.
  smart: (query: string) => ipcRenderer.invoke(IPC.FIND_SMART, query) as Promise<SmartFindResult>,
  // Подсветить конкретную найденную цитату (листание стрелками в смысловом режиме).
  smartShow: (quote: string) => ipcRenderer.invoke(IPC.FIND_SMART_SHOW, quote) as Promise<number>,
  next: (forward: boolean) => ipcRenderer.invoke(IPC.FIND_NEXT, forward),
  stop: () => ipcRenderer.invoke(IPC.FIND_STOP),
  close: () => ipcRenderer.send('findbar:close'),

  onResult: (cb: (r: FindResult) => void) => {
    const handler = (_e: unknown, r: FindResult) => cb(r)
    ipcRenderer.on(IPC.FIND_RESULT, handler)
    return () => ipcRenderer.removeListener(IPC.FIND_RESULT, handler)
  },
  // Панель заново показана (первый показ или после close) — сбросить поле и сфокусировать пустым.
  onShow: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('findbar:show', handler)
    return () => ipcRenderer.removeListener('findbar:show', handler)
  },
  // Ctrl+F при уже открытой панели — сфокусировать и выделить текущий текст (не сбрасывать).
  onRefocus: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('findbar:refocus', handler)
    return () => ipcRenderer.removeListener('findbar:refocus', handler)
  },
})
