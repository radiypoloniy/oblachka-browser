// Минимальный preload для поповера AI-действий над выделением (src/translatepopover.tsx).
// Отдельный от боевого preload.ts и от preload-translatetest.ts — свой маленький канал,
// не трогает контракт основного чрома (shared/ipc.ts).
import { contextBridge, ipcRenderer } from 'electron'
import type { AiAction, AiActionOutcome } from '../shared/ipc'

contextBridge.exposeInMainWorld('translatePopover', {
  onOpen: (cb: (text: string, action: AiAction) => void) => {
    const handler = (_e: unknown, payload: { text: string; action: AiAction }) => cb(payload.text, payload.action);
    ipcRenderer.on('translate-popover:open', handler);
    return () => ipcRenderer.removeListener('translate-popover:open', handler);
  },
  onResult: (cb: (outcome: AiActionOutcome) => void) => {
    const handler = (_e: unknown, outcome: AiActionOutcome) => cb(outcome);
    ipcRenderer.on('translate-popover:result', handler);
    return () => ipcRenderer.removeListener('translate-popover:result', handler);
  },
  // Инкрементальный текст сегмента, по готовности каждого — до финального onResult. Тот же
  // канальный приём, что и onOpen/onResult (не новый мост, ещё один канал в том же семействе).
  onSegment: (cb: (text: string) => void) => {
    const handler = (_e: unknown, text: string) => cb(text);
    ipcRenderer.on('translate-popover:segment', handler);
    return () => ipcRenderer.removeListener('translate-popover:segment', handler);
  },
  reportHeight: (px: number) => ipcRenderer.send('translate-popover:height', px),
  close: () => ipcRenderer.send('translate-popover:close'),
})
