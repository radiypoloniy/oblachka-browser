// Единая точка выбора активного движка перевода страниц — см. ITranslationEngine (TranslationEngine.ts).
// PageTranslateManager.ts зовёт ТОЛЬКО через getActiveEngine(), никогда не импортирует конкретный
// движок напрямую — иначе смена движка в настройках потребовала бы правки DOM-слоя.
import type { EngineId, ITranslationEngine } from './TranslationEngine'
import { qwenTranslationEngine } from './QwenTranslationEngine'
import { CachingTranslationEngine } from './CachingTranslationEngine'
import type { TranslationCacheManager } from './TranslationCacheManager'

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

// Кэш переводов (Этап 4) — регистрируется отдельно (main.ts, после TranslationCacheManager.initialize())
// по тому же принципу, что registerEngine: если better-sqlite3 не загрузился (см.
// TranslationCacheManager.ts), cacheManager остаётся null — getActiveEngine() просто отдаёт движок
// БЕЗ кэширующей обёртки, кэш прозрачно выключается, а не ломает перевод.
let cacheManager: TranslationCacheManager | null = null

export function setCacheManager(cache: TranslationCacheManager): void {
  cacheManager = cache
}

// Единственная точка получения текущего движка. Если выбранный движок не зарегистрирован или не
// готов (Bergamot не поднялся — нет модели/воркер упал, см. план Этапа 3) — тихий откат на Qwen:
// он всегда зарегистрирован и isReady() у него всегда true (см. QwenTranslationEngine.ts), так что
// откат гарантированно не бросает исключение.
export function getActiveEngine(): ITranslationEngine {
  const engine = engines.get(activeId)
  let real: ITranslationEngine
  if (engine && engine.isReady()) {
    real = engine
  } else {
    if (activeId !== 'qwen') {
      console.warn(`[translation-engine] "${activeId}" недоступен — откат на Qwen`)
    }
    real = engines.get('qwen')!
  }
  return cacheManager ? new CachingTranslationEngine(real, cacheManager) : real
}
