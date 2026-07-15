// Минимальный preload правой AI-панели (src/aipanel.tsx). Свои маленькие каналы (закрытие + чат +
// контекст вкладки) — не трогают контракт основного хрома (shared/ipc.ts), как и
// preload-translatepopover.ts.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('aiPanel', {
  close: () => ipcRenderer.send('ai-panel:close'),

  // webGrounding — тоггл-глобус (заход 2 задела): main решает по нему, идти ли через
  // SearXNG-ветку или обычный путь Qwen, см. AiPanelManager.ts::ai-panel:chat-send.
  sendChat: (text: string, webGrounding: boolean) => ipcRenderer.send('ai-panel:chat-send', text, webGrounding),
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

  // Заход D — кнопка фактчека: показывается только если ключ Gemini подключён (см. AiKeyStore.ts).
  // Пуш статуса — тот же источник, что и секция настроек AI, не два независимых состояния.
  onKeyStatus: (cb: (connected: boolean) => void) => {
    const handler = (_e: unknown, connected: boolean) => cb(connected);
    ipcRenderer.on('ai-panel:key-status', handler);
    return () => ipcRenderer.removeListener('ai-panel:key-status', handler);
  },
  factCheck: () => ipcRenderer.send('ai-panel:fact-check'),

  // Задел под web-grounding (SearXNG) — тот же приём, что onKeyStatus выше: пуш статуса,
  // не отдельный get (панель узнаёт его при открытии/переключении вкладки, см. AiPanelManager.ts).
  onSearxngStatus: (cb: (configured: boolean) => void) => {
    const handler = (_e: unknown, configured: boolean) => cb(configured);
    ipcRenderer.on('ai-panel:searxng-status', handler);
    return () => ipcRenderer.removeListener('ai-panel:searxng-status', handler);
  },
  // Клик по глобусу, когда SearXNG не настроен — ведёт в настройки (вкладка Settings в чроме),
  // а не молча включает пустой режим.
  openSettings: () => ipcRenderer.send('ai-panel:open-settings'),
})
