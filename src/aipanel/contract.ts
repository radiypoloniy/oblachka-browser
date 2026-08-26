// Контракт правой AI-панели с main.
//
// ⚠️ Каналы здесь AD-HOC, не из shared/ipc.ts, и это осознанно: панель живёт в изолированной
// WebContentsView со своим preload (electron/preload-aipanel.ts), как и поповеры. Поэтому формы
// ответов ЗЕРКАЛЯТСЯ с main вручную — сторож контракта (scripts/contract-check.mjs) сюда не
// смотрит, и расхождение поймает только человек. Правишь форму в main — правь и здесь.
import type { CurrencyRatesResult, WeatherResult } from '../components/aiApps';

// Код причины отказа (см. electron/TranslationService.ts::ModelError, shared/ipc.ts::ModelErrorCode)
// — зеркалим локально, тот же приём, что и у ChatOutcome ниже.
export type ModelErrorCode = 'NO_MODEL_INSTALLED' | 'MODEL_FILE_MISSING' | 'LOAD_FAILED'

// Форма ChatOutcome из electron/TranslationService.ts — не через shared/ipc.ts (ad-hoc канал,
// как и у поповера, см. preload-aipanel.ts), поэтому просто зеркалим форму локально.
export type ChatOutcome =
  | { ok: true; out: string; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string; errorCode?: ModelErrorCode }

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

// Форма Skill из electron/SkillsStore.ts — зеркалим локально, тот же приём, что у ChatOutcome
// выше (ad-hoc канал, не через shared/ipc.ts).
export interface SkillItem {
  id: string
  label: string
  prompt: string
  icon?: string
  builtin?: boolean
  visible: boolean
}

// Форма пуша ai-panel:context из AiPanelManager.ts::sendCurrentContext.
export interface TabContext {
  tabId: string
  url: string
  title: string
  favicon?: string | null
  messages: ChatMessage[]
}

declare global {
  interface Window {
    aiPanel: {
      close: () => void
      // Фокус в поле ввода чата = намерение поговорить с моделью. Именно по нему main греет
      // Qwen — не по открытию панели (в ней ещё приложения и виджеты), см. AiPanelManager.ts.
      chatIntent: () => void
      // Слот с сайтом стал активным — попросить main отдать фокус его вью.
      webappFocus: (appId: string) => void
      // Фокус ушёл в сайт веб-слота — по этому признаку раздел «Приложения» рисует рамку
      // активного слота (сам он такой клик не видит, см. WebAppManager.ts).
      onWebAppFocused: (cb: (appId: string) => void) => () => void
      // Иконка приложения на рабочем столе новой вкладки открывает панель сразу на нём.
      onOpenApp: (cb: (appId: string) => void) => () => void
      // webGrounding — тоггл-глобус: true → main отвечает через SearXNG-ветку (см. AiPanelManager.ts).
      sendChat: (text: string, webGrounding: boolean) => void
      quickTranslate: () => void
      // Очистить беседу текущей вкладки — main ответит обычным onContext с пустой лентой.
      clearChat: () => void
      onChatChunk: (cb: (text: string) => void) => () => void
      onChatResult: (cb: (outcome: ChatOutcome) => void) => () => void
      onContext: (cb: (ctx: TabContext) => void) => () => void
      // Заход D — кнопка фактчека: показывается только когда ключ Gemini подключён.
      onKeyStatus: (cb: (connected: boolean) => void) => () => void
      factCheck: () => void
      // Коммит 1 (реестр скиллов) — prompt-кнопки панели (Объяснить/Саммари, позже пользовательские)
      // приходят из main (SkillsStore.ts), а не хардкожены здесь.
      onSkillsList: (cb: (skills: SkillItem[]) => void) => () => void
      // Задел под web-grounding (SearXNG) — тоггл-глобус в поле ввода.
      onSearxngStatus: (cb: (configured: boolean) => void) => () => void
      // section — необязательный начальный раздел Settings (напр. 'ai' у кнопки "+" в ряду
      // действий); без аргумента — дефолтный раздел, как у клика по глобусу (handleGlobeClick).
      openSettings: (section?: string) => void
      // Курсы валют (конвертер) и погода (виджет) «Приложений» — формы ответов зеркалятся
      // в aiApps.tsx (ad-hoc каналы, как остальные ai-panel:*).
      modelState: () => Promise<{ label: string | null; loaded: boolean }>
      currencyRates: () => Promise<CurrencyRatesResult>
      weather: (city: string) => Promise<WeatherResult>
      // Веб-приложения (заход 3) — open/bounds/close веб-слотов, см. WebAppManager.ts.
      webappOpen: (appId: string, url: string) => void
      webappBounds: (appId: string, rect: { x: number; y: number; width: number; height: number }) => void
      webappClose: (appId: string) => void
    }
  }
}
