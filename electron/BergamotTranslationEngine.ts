// Обёртка Bergamot (BergamotService.ts) в общий интерфейс ITranslationEngine (TranslationEngine.ts).
// Единственное, что этот файл добавляет поверх "сырого" сервиса (Этап 2, изолированный воркер) —
// конвертация маркеров DOM-слоя ⟪N⟫...⟪/N⟫ (WALK_SCRIPT/buildApplyScript в
// PageTranslateManager.ts) в настоящий HTML и обратно. Bergamot переносит инлайновую разметку через
// ВЫРАВНИВАНИЕ (html:true в BatchTranslator, см. BergamotWorkerEntry.ts) — ему нужны реальные теги,
// а не наш кастомный синтаксис; Qwen (QwenTranslationEngine.ts) наоборот инструктируется через
// промпт копировать ⟪N⟫ как есть и HTML ему не нужен. DOM-слой не знает ни про то, ни про другое —
// получает и отдаёт только ⟪N⟫, конвертация — целиком внутренняя забота этого файла.
import type { ITranslationEngine, TranslationItem, TranslationResult } from './TranslationEngine'
import { BergamotService } from './BergamotService'

const OPEN = '⟪' // ⟪ — те же символы, что OPEN/CLOSE в PageTranslateManager.ts::WALK_SCRIPT
const CLOSE = '⟫' // ⟫

// Та же грамматика, что PAIR_RE в PageTranslateManager.ts::buildApplyScript: пара ⟪N⟫...⟪/N⟫ ИЛИ
// одиночный ⟪N⟫ (void-теги br/img на входе — сериализованы без пары, см. WALK_SCRIPT::serialize).
const MARKER_RE = new RegExp(`${OPEN}(\\d+)${CLOSE}([\\s\\S]*?)${OPEN}/\\1${CLOSE}|${OPEN}(\\d+)${CLOSE}`, 'g')

// <i data-tr="N">...</i> — нейтральный инлайн-тег: не несёт своей семантики (в отличие от <a> без
// href), поэтому у Marian/WASM меньше повода его "поправить". Void-маркер тоже становится ПАРНЫМ
// тегом с пустым содержимым (не самозакрывающимся) — одна грамматика на конвертацию в обе стороны,
// различие "было ли что-то внутри" читается из htmlToMarkers по пустоте inner, а не по форме тега.
function markersToHtml(text: string): string {
  return text.replace(MARKER_RE, (_m: string, pairId: string | undefined, inner: string | undefined, voidId: string | undefined) => {
    if (pairId !== undefined) return `<i data-tr="${pairId}">${inner}</i>`
    return `<i data-tr="${voidId}"></i>`
  })
}

const HTML_MARKER_RE = /<i data-tr="(\d+)">([\s\S]*?)<\/i>/g

function htmlToMarkers(html: string): string {
  return html.replace(HTML_MARKER_RE, (_m: string, id: string, inner: string) => {
    return inner.length > 0 ? `${OPEN}${id}${CLOSE}${inner}${OPEN}/${id}${CLOSE}` : `${OPEN}${id}${CLOSE}`
  })
}

export class BergamotTranslationEngine implements ITranslationEngine {
  readonly id = 'bergamot' as const

  #service: BergamotService
  #availablePairs: Array<{ from: string; to: string }> = []
  // Тот же дефолт, что и у FileSystemTranslatorBacking в BergamotWorkerEntry.ts — должны совпадать,
  // это не настраивается по отдельности с двух сторон.
  #pivotLanguage = 'en'

  constructor(userDataPath: string) {
    this.#service = new BergamotService(userDataPath)
  }

  // ⚠️ Живой баг, пойманный на реальном прогоне: воркер репортит "ready" уже после того, как
  // BatchTranslator/backing успешно СКОНСТРУИРОВАЛИСЬ — это происходит даже при ПОЛНОСТЬЮ пустом
  // {userData}/models/translation/ (ноль файлов моделей, ничего не скачано вручную по README).
  // Если isReady() отражает только "воркер жив", TranslationEngineRegistry.getActiveEngine()
  // выбирает Bergamot, и КАЖДЫЙ вызов translateBatch тихо падает по каждому юниту ("No model
  // available...", см. BergamotWorkerEntry.ts) — итог: кнопка перевода загорается ("translated"),
  // а страница остаётся нетронутой, без единой видимой ошибки пользователю. #availablePairs.length
  // здесь — обязательная часть проверки "готов", а не просто диагностика.
  isReady(): boolean {
    return this.#service.isReady() && this.#availablePairs.length > 0
  }

  // Прямая пара ИЛИ пивот через #pivotLanguage — та же логика, что TranslatorBacking.findModels
  // (base-класс пакета, см. BergamotWorkerEntry.ts) применяет реально при переводе.
  supportsPair(from: string, to: string): boolean {
    if (!this.isReady()) return false
    if (this.#availablePairs.some((p) => p.from === from && p.to === to)) return true
    const outbound = this.#availablePairs.some((p) => p.from === from && p.to === this.#pivotLanguage)
    const inbound = this.#availablePairs.some((p) => p.from === this.#pivotLanguage && p.to === to)
    return outbound && inbound
  }

  async warmup(): Promise<void> {
    await this.#service.warmup()
    this.#availablePairs = await this.#service.listPairs()
  }

  // signal/onProgress — Bergamot не поддерживает ни отмену ВНУТРИ вызова, ни токен-стриминг (один
  // WASM-вызов на юнит, см. BergamotWorkerEntry.ts) — интерфейс их допускает опционально именно
  // для таких движков (см. комментарий в ITranslationEngine), здесь просто не используются.
  async translateBatch(items: TranslationItem[], from: string, to: string): Promise<TranslationResult[]> {
    const htmlItems = items.map((item) => ({ id: item.id, text: markersToHtml(item.text) }))
    const results = await this.#service.translateBatch(htmlItems, from, to)
    return results.map((r) => ({ id: r.id, text: htmlToMarkers(r.text) }))
  }

  async dispose(): Promise<void> {
    await this.#service.dispose()
  }
}
