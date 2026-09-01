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

/**
 * Разбудить АКТИВНЫЙ движок, если он ещё не готов. Зовётся из PageTranslateManager перед выбором.
 *
 * ⚠️ Заведено потому, что Bergamot больше не греется на старте (см. showWhenReady.ts): его воркер
 * стоит главному процессу 1170 МБ, и платить их до того, как человек хоть раз попросил перевод,
 * незачем. Без этой строки getActiveEngine() видел бы isReady() === false и молча уходил на Qwen —
 * то есть настройка «движок перевода: Bergamot» перестала бы действовать вовсе.
 *
 * ⚠️ Греется только АКТИВНЫЙ, а не все подряд: фолбэк на чужой движок должен оставаться дешёвым.
 * Отказ глушится — getActiveEngine ниже сам разберётся и откатится, как делал и раньше.
 */
export async function ensureActiveEngineWarm(from: string, to: string): Promise<void> {
  const active = engines.get(activeId)
  if (!active || active.isReady()) return
  try {
    await active.warmup(from, to)
  } catch (e) {
    console.warn(`[translation-engine] прогрев "${activeId}" по требованию не удался:`, e)
  }
}

function isUsable(engine: ITranslationEngine, from?: string, to?: string): boolean {
  return engine.isReady() && (from === undefined || to === undefined || engine.supportsPair(from, to))
}

// Единственная точка получения текущего движка. from/to — необязательны (диагностика/warmup не
// всегда их знают), но PageTranslateManager.ts ВСЕГДА передаёт их (уже резолвлены через
// resolveDirection к этому моменту) — иначе движок, у которого просто нет модели под ЭТУ пару
// (при наличии моделей под другие пары, см. живой баг: Bergamot с одним en-ru молча "переводит"
// французскую страницу в никуда), тихо выбирался бы и заваливал КАЖДЫЙ юнит без единого сигнала
// наружу.
//
// Больше нет спец-случая для Qwen: раньше QwenTranslationEngine.isReady() был безусловным true,
// и non-null фолбэк на него (engines.get('qwen')!) был гарантированно рабочим. Теперь Qwen —
// обычный движок в реестре (сверяется с ModelRegistry.ts), поэтому при неготовности активного
// движка перебираются ВСЕ зарегистрированные движки в детерминированном порядке вставки в Map
// (см. начальный литерал ниже — 'qwen' вставлен первым, 'bergamot' — вторым через registerEngine()
// в main.ts) и возвращается первый usable. Если usable нет ни одного — null: вызывающая сторона
// (PageTranslateManager.ts) обязана обработать этот случай сама, гарантии «движок всегда есть»
// больше нет.
export function getActiveEngine(from?: string, to?: string): ITranslationEngine | null {
  const active = engines.get(activeId)
  let real: ITranslationEngine | null = null

  if (active && isUsable(active, from, to)) {
    real = active
  } else {
    if (active) {
      const pairInfo = from && to ? ` для пары ${from}->${to}` : ''
      console.warn(`[translation-engine] "${activeId}" недоступен${pairInfo} — ищу другой готовый движок`)
    }
    for (const engine of engines.values()) {
      if (engine === active) continue // уже проверен выше
      if (isUsable(engine, from, to)) { real = engine; break }
    }
  }

  if (!real) {
    console.error('[translation-engine] ни один зарегистрированный движок перевода не готов')
    return null
  }

  return cacheManager ? new CachingTranslationEngine(real, cacheManager) : real
}
