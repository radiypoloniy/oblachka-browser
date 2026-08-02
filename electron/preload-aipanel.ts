// Минимальный preload правой AI-панели (src/aipanel.tsx). Свои маленькие каналы (закрытие + чат +
// контекст вкладки) — не трогают контракт основного хрома (shared/ipc.ts), как и
// preload-translatepopover.ts.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('aiPanel', {
  // Иконка приложения на рабочем столе новой вкладки → панель открывается сразу на нём.
  onOpenApp: (cb: (appId: string) => void) => {
    const handler = (_e: unknown, appId: string) => cb(appId)
    ipcRenderer.on('ai-panel:open-app', handler)
    return () => ipcRenderer.removeListener('ai-panel:open-app', handler)
  },
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

  // Коммит 1 (реестр скиллов) — prompt-кнопки панели (Объяснить/Саммари, позже пользовательские)
  // теперь пушатся из main (SkillsStore.ts), а не хардкожены в aipanel.tsx. Тот же приём, что
  // onKeyStatus выше: пуш при (пере)открытии панели + на каждое изменение реестра.
  onSkillsList: (cb: (skills: unknown) => void) => {
    const handler = (_e: unknown, skills: unknown) => cb(skills);
    ipcRenderer.on('ai-panel:skills-list', handler);
    return () => ipcRenderer.removeListener('ai-panel:skills-list', handler);
  },

  // Задел под web-grounding (SearXNG) — тот же приём, что onKeyStatus выше: пуш статуса,
  // не отдельный get (панель узнаёт его при открытии/переключении вкладки, см. AiPanelManager.ts).
  onSearxngStatus: (cb: (configured: boolean) => void) => {
    const handler = (_e: unknown, configured: boolean) => cb(configured);
    ipcRenderer.on('ai-panel:searxng-status', handler);
    return () => ipcRenderer.removeListener('ai-panel:searxng-status', handler);
  },
  // Клик по глобусу, когда SearXNG не настроен — ведёт в настройки (вкладка Settings в чроме),
  // а не молча включает пустой режим. section (опционально) — начальный раздел Settings (напр.
  // 'ai' у кнопки "+" в ряду действий панели); без аргумента — дефолтный раздел, как раньше.
  openSettings: (section?: string) => ipcRenderer.send('ai-panel:open-settings', section),

  // Курсы валют (конвертер раздела «Приложения») — invoke: ответ нужен только запросившему.
  // Форма CurrencyRatesResult (electron/CurrencyRates.ts) зеркалится в renderer локально
  // (aiApps.tsx) — ad-hoc канал, как и chat-result выше, не контракт shared/ipc.ts.
  currencyRates: () => ipcRenderer.invoke('ai-panel:currency-rates'),
  // Погода для виджета «Приложений» — та же схема (форма WeatherResult зеркалится в aiApps.tsx).
  weather: (city: string) => ipcRenderer.invoke('ai-panel:weather', city),

  // Веб-приложения (заход 3, см. WebAppManager.ts): открытие/позиционирование/закрытие
  // WebContentsView чужого сайта в «дырке» слота. bounds — в координатах вьюпорта панели,
  // в окно переводит AiPanelManager.
  webappOpen: (appId: string, url: string) => ipcRenderer.send('ai-panel:webapp-open', appId, url),
  webappBounds: (appId: string, rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('ai-panel:webapp-bounds', appId, rect),
  webappClose: (appId: string) => ipcRenderer.send('ai-panel:webapp-close', appId),
})
