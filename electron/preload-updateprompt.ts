// Минимальный preload для карточки обновления (src/updateprompt.tsx).
//
// ⚠️ Свои маленькие каналы (update-prompt:*), а не контракт основного хрома — как у поповера
// разрешений и findbar: эта вью не часть интерфейса окна, она задаёт один вопрос и исчезает.
import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateStatus } from '../shared/ipc'

contextBridge.exposeInMainWorld('updatePrompt', {
  respond: (action: 'update' | 'later' | 'skip') => ipcRenderer.send('update-prompt:respond', action),
  reportHeight: (px: number) => ipcRenderer.send('update-prompt:height', px),
  onState: (cb: (s: UpdateStatus | null) => void) => {
    const handler = (_e: unknown, s: UpdateStatus | null) => cb(s)
    ipcRenderer.on('update-prompt:state', handler)
    return () => ipcRenderer.removeListener('update-prompt:state', handler)
  },
})
