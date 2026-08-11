// Минимальный preload оверлея зон дропа (src/dropzones.tsx). Вью только рисует подсветку по
// присланному — своих решений не принимает и наружу ничего не шлёт.
import { contextBridge, ipcRenderer } from 'electron'
import type { SplitSwapHint } from '../shared/ipc'

// Что подсвечивать (см. ZoneVisual в DropZoneManager.ts) — картинка, а не действие.
type ZoneVisual = 'split-left' | 'split-right' | 'window'

contextBridge.exposeInMainWorld('dropzones', {
  onZone: (cb: (zone: ZoneVisual | null) => void) => {
    const handler = (_e: unknown, zone: ZoneVisual | null) => cb(zone)
    ipcRenderer.on('dropzones:zone', handler)
    return () => ipcRenderer.removeListener('dropzones:zone', handler)
  },
  // Второй жест на той же вью: половину сплита тащат за шапку, подсвечиваем панель-цель.
  onSwapHint: (cb: (hint: SplitSwapHint | null) => void) => {
    const handler = (_e: unknown, hint: SplitSwapHint | null) => cb(hint)
    ipcRenderer.on('dropzones:swap', handler)
    return () => ipcRenderer.removeListener('dropzones:swap', handler)
  },
  // Курсор того же жеста: призрак обязан ехать и над страницей, а нарисовать его там может
  // только эта вью.
  onCursor: (cb: (pos: { x: number; y: number } | null) => void) => {
    const handler = (_e: unknown, pos: { x: number; y: number } | null) => cb(pos)
    ipcRenderer.on('dropzones:cursor', handler)
    return () => ipcRenderer.removeListener('dropzones:cursor', handler)
  },
})
