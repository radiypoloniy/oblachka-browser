// Минимальный preload для изолированного тест-окна перевода (src/translatetest.ts).
// Отдельный от боевого preload.ts/shared/ipc.ts — временный мост, сносится без следа.
import { contextBridge, ipcRenderer } from 'electron'

type Direction = 'ru->en' | 'en->ru' | 'auto'
type TranslateResult =
  | { ok: true; out: string; dirUsed: 'ru->en' | 'en->ru'; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string }

contextBridge.exposeInMainWorld('translateTest', {
  run: (text: string, dir: Direction): Promise<TranslateResult> =>
    ipcRenderer.invoke('translatetest:run', text, dir),
})
