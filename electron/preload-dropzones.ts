// Минимальный preload оверлея зон дропа (src/dropzones.tsx). Вью только рисует подсветку по
// присланной зоне — своих решений не принимает и наружу ничего не шлёт.
import { contextBridge, ipcRenderer } from 'electron'

// Что подсвечивать (см. ZoneVisual в DropZoneManager.ts) — картинка, а не действие.
type ZoneVisual = 'split-left' | 'split-right' | 'window'

contextBridge.exposeInMainWorld('dropzones', {
  onZone: (cb: (zone: ZoneVisual | null) => void) => {
    const handler = (_e: unknown, zone: ZoneVisual | null) => cb(zone)
    ipcRenderer.on('dropzones:zone', handler)
    return () => ipcRenderer.removeListener('dropzones:zone', handler)
  },
})
