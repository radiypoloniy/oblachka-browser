// Обёртка существующего Qwen-перевода (TranslationService.ts::translatePageBatch) в общий интерфейс
// ITranslationEngine (см. TranslationEngine.ts). Чистый адаптер — поведение не меняет: тот же
// translatePageBatch, тот же resolveDirection снаружи (в PageTranslateManager.ts), просто вызывается
// через ту же форму, что и любой другой движок (Bergamot позже), а не напрямую.
import fs from 'node:fs'
import { translatePageBatch, warmup } from './TranslationService'
import * as ModelRegistry from './ModelRegistry'
import type { ITranslationEngine, TranslationItem, TranslationResult } from './TranslationEngine'

class QwenTranslationEngine implements ITranslationEngine {
  readonly id = 'qwen' as const

  // Готов ровно тогда, когда в реестре есть дефолтная модель И её файл реально существует на
  // диске — то же условие, что ensureLoaded() проверяет перед загрузкой (TranslationService.ts).
  // Без кэша: вызывается редко (см. TranslationEngineRegistry.ts::getActiveEngine — раз на клик
  // «Перевести страницу», не в цикле по батчам), а кэш здесь дал бы то же устаревание, которое уже
  // чинили у loadPromise — existsSync на каждый (редкий) вызов дешевле, чем кэш с инвалидацией.
  isReady(): boolean {
    const installed = ModelRegistry.getDefault()
    return installed !== null && fs.existsSync(installed.filePath)
  }

  // Qwen — инструкционная LLM общего назначения, переводит любую пару языков из LANG_NAME
  // (TranslationService.ts) без отдельной модели на пару — то же поведение, что было раньше.
  supportsPair(): boolean {
    return true
  }

  async warmup(): Promise<void> {
    await warmup()
  }

  // _signal не используется: отмена перевода страницы уже покрыта bumpSeq/isCancelled на уровне
  // оркестрации в PageTranslateManager.ts, у Qwen нет отдельной точки прерывания одного вызова.
  async translateBatch(
    items: TranslationItem[],
    from: string,
    to: string,
    _signal?: AbortSignal,
    onProgress?: (charsSoFar: number) => void,
  ): Promise<TranslationResult[]> {
    const result = await translatePageBatch(items, from, to, onProgress)
    if (!result.ok) throw new Error(result.error)
    return [...result.translations.entries()].map(([id, text]) => ({ id, text }))
  }

  // Qwen резидентен весь процесс (см. TranslationService.ts) — намеренно не выгружается на смену
  // движка в настройках, тот же принцип, что и раньше (единственный движок, всегда в памяти).
  async dispose(): Promise<void> {}
}

export const qwenTranslationEngine = new QwenTranslationEngine()
