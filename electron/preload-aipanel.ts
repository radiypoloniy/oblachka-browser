// Минимальный preload правой AI-панели (src/aipanel.tsx). Свои маленькие каналы (закрытие + чат +
// контекст вкладки) — не трогают контракт основного хрома (shared/ipc.ts), как и
// preload-translatepopover.ts.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('aiPanel', {
  close: () => ipcRenderer.send('ai-panel:close'),

  sendChat: (text: string) => ipcRenderer.send('ai-panel:chat-send', text),
  // Кнопка-подсказка «Перевести» — без текста: направление (src/tgt) решает main после извлечения
  // и детекции языка страницы, см. AiPanelManager.ts.
  quickTranslate: () => ipcRenderer.send('ai-panel:quick-translate'),
  onChatChunk: (cb: (text: string) => void) => {
    const handler = (_e: unknown, text: string) => cb(text);
    ipcRenderer.on('ai-panel:chat-chunk', handler);
    return () => ipcRenderer.removeListener('ai-panel:chat-chunk', handler);
  },
  // ChatOutcome из TranslationService.ts — не типизируем через shared/ipc.ts (ad-hoc канал, не
  // общий контракт хрома), renderer описывает своей локальной копией формы (см. aipanel.tsx).
  onChatResult: (cb: (outcome: unknown) => void) => {
    const handler = (_e: unknown, outcome: unknown) => cb(outcome);
    ipcRenderer.on('ai-panel:chat-result', handler);
    return () => ipcRenderer.removeListener('ai-panel:chat-result', handler);
  },

  // Беседа привязанной вкладки (Заход 3) — приходит при переключении вкладки, смене её URL и при
  // (пере)открытии панели, см. AiPanelManager.ts::sendCurrentContext.
  onContext: (cb: (ctx: unknown) => void) => {
    const handler = (_e: unknown, ctx: unknown) => cb(ctx);
    ipcRenderer.on('ai-panel:context', handler);
    return () => ipcRenderer.removeListener('ai-panel:context', handler);
  },
})
