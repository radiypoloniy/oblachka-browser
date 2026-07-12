// Абстракция движка перевода страниц — общий контракт для Qwen (QwenTranslationEngine.ts) и
// Bergamot (BergamotTranslationEngine.ts). PageTranslateManager.ts (DOM-слой) зовёт ТОЛЬКО через
// этот интерфейс, никогда не импортирует конкретный движок напрямую — какой движок сейчас активен,
// решает TranslationEngineRegistry.ts, DOM-слой об этом не знает и не должен знать.
//
// TranslationItem/TranslationResult — ровно та форма {id, text}, что уже ходит между DOM-слоем и
// Qwen-переводом (PageBatchUnit на входе в TranslationService.ts::translatePageBatch, entries,
// которые PageTranslateManager.ts собирает из result.translations на выходе) — не новый контракт,
// а имя для уже существующей формы данных.
export interface TranslationItem {
  id: number
  text: string
}

export interface TranslationResult {
  id: number
  text: string
}

// EngineId — алиас TranslationEngineId из shared/ipc.ts (тип нужен и renderer'у — Settings.tsx,
// см. OblakoApi::getTranslationEngine/setTranslationEngine, — поэтому определение живёт в shared/,
// не здесь). Локальное имя короче и не меняет существующие импорты (SettingsManager.ts,
// TranslationEngineRegistry.ts).
import type { TranslationEngineId } from '../shared/ipc'
export type EngineId = TranslationEngineId

export interface ITranslationEngine {
  readonly id: EngineId

  // Готов ли движок ПРЯМО СЕЙЧАС переводить (модель загружена и не сломана). Qwen — всегда true (см.
  // QwenTranslationEngine.ts, модель грузится лениво по первому вызову, как и раньше это работало).
  // Bergamot — false, пока модель/воркер не поднялись; TranslationEngineRegistry.ts откатывается на
  // Qwen, если активный движок не готов.
  isReady(): boolean

  // Поддерживает ли движок конкретную пару языков — есть ли под неё модель. Qwen поддерживает любую
  // пару из TranslationService.ts::LANG_NAME без отдельной модели на пару.
  supportsPair(from: string, to: string): boolean

  // Прогрев (фоновая загрузка модели до первого реального вызова пользователя) — см. main.ts,
  // TRANSLATION_WARMUP_DELAY_MS.
  warmup(from: string, to: string): Promise<void>

  // signal — отмена перевода страницы (навигация/повторный клик/переключение вкладки уже покрыты
  // bumpSeq/isCancelled в PageTranslateManager.ts на уровне ОРКЕСТРАЦИИ батчей; signal — для
  // движков, которым есть что реально прервать ВНУТРИ одного вызова, например долгий WASM-прогон).
  // onProgress — суммарные символы стримингового ответа движка К ЭТОМУ МОМЕНТУ (не дельта), нужны
  // только для "живого" счётчика в тулбаре (см. PageTranslateManager.ts::pushProgressThrottled).
  // Движки без токен-стриминга (один WASM-вызов на батч, без промежуточных чанков) просто не зовут
  // колбэк — PageTranslateManager обязан корректно работать и без единого вызова onProgress
  // (тогда прогресс двигается только по границам батчей, как раньше у пакетного движка).
  // Батч, который движок не смог перевести целиком, — исключение (reject), не часть результата:
  // вызывающая сторона (PageTranslateManager.ts) ловит его и просто пропускает батч, как раньше.
  translateBatch(
    items: TranslationItem[],
    from: string,
    to: string,
    signal?: AbortSignal,
    onProgress?: (charsSoFar: number) => void,
  ): Promise<TranslationResult[]>

  // Освобождает ресурсы движка (выгрузка модели/остановка воркера) — на смену движка в настройках
  // или выключение приложения. Qwen резидентен весь процесс сессии (см. TranslationService.ts) —
  // no-op, но интерфейс симметричен для движков, которые реально что-то освобождают (Bergamot —
  // worker_thread).
  dispose(): Promise<void>
}
