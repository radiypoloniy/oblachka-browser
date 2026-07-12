// Единая точка выбора активного движка перевода страниц — см. ITranslationEngine (TranslationEngine.ts).
// PageTranslateManager.ts зовёт ТОЛЬКО через getActiveEngine(), никогда не импортирует конкретный
// движок напрямую — иначе смена движка в настройках потребовала бы правки DOM-слоя.
import type { EngineId, ITranslationEngine } from './TranslationEngine'
import { qwenTranslationEngine } from './QwenTranslationEngine'

// Bergamot регистрируется отдельным вызовом registerEngine() (main.ts, на старте) — не импортируется
// напрямую здесь, чтобы этот файл не тянул за собой worker_thread и файлы моделей Bergamot уже на
// Этапе 1, когда их ещё нет.
const engines = new Map<EngineId, ITranslationEngine>([
  ['qwen', qwenTranslationEngine],
])

export function registerEngine(engine: ITranslationEngine): void {
  engines.set(engine.id, engine)
}

// Дефолт 'qwen' — настройка persist'ится в SettingsManager.ts::translationEngine, main.ts применяет
// сохранённое значение через setActiveEngineId() один раз при старте (см. main.ts).
let activeId: EngineId = 'qwen'

export function setActiveEngineId(id: EngineId): void {
  activeId = id
}

export function getActiveEngineId(): EngineId {
  return activeId
}

// Единственная точка получения текущего движка. Если выбранный движок не зарегистрирован или не
// готов (Bergamot не поднялся — нет модели/воркер упал, см. план Этапа 3) — тихий откат на Qwen:
// он всегда зарегистрирован и isReady() у него всегда true (см. QwenTranslationEngine.ts), так что
// откат гарантированно не бросает исключение.
export function getActiveEngine(): ITranslationEngine {
  const engine = engines.get(activeId)
  if (engine && engine.isReady()) return engine
  if (activeId !== 'qwen') {
    console.warn(`[translation-engine] "${activeId}" недоступен — откат на Qwen`)
  }
  return engines.get('qwen')!
}
