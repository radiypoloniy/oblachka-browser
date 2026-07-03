// Минимальный preload правой AI-панели (src/aipanel.tsx). Свой маленький канал закрытия —
// не трогает контракт основного хрома (shared/ipc.ts), как и preload-translatepopover.ts.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('aiPanel', {
  close: () => ipcRenderer.send('ai-panel:close'),
})
