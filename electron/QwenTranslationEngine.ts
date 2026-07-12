// Обёртка существующего Qwen-перевода (TranslationService.ts::translatePageBatch) в общий интерфейс
// ITranslationEngine (см. TranslationEngine.ts). Чистый адаптер — поведение не меняет: тот же
// translatePageBatch, тот же resolveDirection снаружи (в PageTranslateManager.ts), просто вызывается
// через ту же форму, что и любой другой движок (Bergamot позже), а не напрямую.
import { translatePageBatch, warmup } from './TranslationService'
import type { ITranslationEngine, TranslationItem, TranslationResult } from './TranslationEngine'

class QwenTranslationEngine implements ITranslationEngine {
  readonly id = 'qwen' as const

  // Qwen всегда доступен — модель грузится лениво по первому вызову (см. ensureLoaded в
  // TranslationService.ts), явного состояния "не готов" у него нет и не было раньше (до введения
  // этого интерфейса PageTranslateManager.ts звал translatePageBatch безусловно).
  isReady(): boolean {
    return true
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
