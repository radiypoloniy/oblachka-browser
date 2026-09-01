// Обёртка Bergamot (BergamotService.ts) в общий интерфейс ITranslationEngine (TranslationEngine.ts).
// Единственное, что этот файл добавляет поверх "сырого" сервиса (Этап 2, изолированный воркер) —
// конвертация маркеров DOM-слоя ⟪N⟫...⟪/N⟫ (WALK_SCRIPT/buildApplyScript в
// PageTranslateManager.ts) в настоящий HTML и обратно. Bergamot переносит инлайновую разметку через
// ВЫРАВНИВАНИЕ (html:true в BatchTranslator, см. BergamotWorkerEntry.ts) — ему нужны реальные теги,
// а не наш кастомный синтаксис; Qwen (QwenTranslationEngine.ts) наоборот инструктируется через
// промпт копировать ⟪N⟫ как есть и HTML ему не нужен. DOM-слой не знает ни про то, ни про другое —
// получает и отдаёт только ⟪N⟫, конвертация — целиком внутренняя забота этого файла.
import fs from 'node:fs'
import path from 'node:path'
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

  // bundledModelsDir — фолбэк на бандл (resources/models/translation), см. BergamotWorkerEntry.ts:
  // без него после npm run download-translation-models модели оказывались в resources/, а боевой
  // воркер смотрел только в userData и тихо считал Bergamot неготовым (живой баг, см. историю).
  #userModelsDir: string
  #bundledModelsDir: string

  constructor(userDataPath: string, bundledModelsDir: string) {
    this.#service = new BergamotService(userDataPath, bundledModelsDir)
    this.#userModelsDir = path.join(userDataPath, 'models', 'translation')
    this.#bundledModelsDir = bundledModelsDir
  }

  /**
   * Есть ли на диске хоть одна пара моделей — БЕЗ подъёма воркера.
   *
   * ⚠️ Заведено ради того, чтобы настройки могли показать статус движка, не платя за это
   * гигабайтом. Замер 01.09.2026: спавн воркера Bergamot добавляет главному процессу 1170 МБ
   * private bytes за секунду (WASM-память живёт в изоляте worker_thread, поэтому её не видно
   * ни в V8 heap главного потока, ни в external — только в private bytes процесса). Раньше это
   * платилось на КАЖДОМ старте браузера ради строчки в разделе настроек.
   *
   * ⚠️ Та же пара каталогов и тот же порядок, что у воркера (BergamotWorkerEntry.ts): userData
   * сначала, бандл фолбэком. Разъехавшись, они дали бы «модели есть» при пустом каталоге у
   * воркера — то есть кнопку перевода, которая загорается и ничего не переводит.
   */
  hasModelsOnDisk(): boolean {
    const anyPair = (dir: string): boolean => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).some((d) => d.isDirectory())
      } catch {
        return false
      }
    }
    return anyPair(this.#userModelsDir) || anyPair(this.#bundledModelsDir)
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
