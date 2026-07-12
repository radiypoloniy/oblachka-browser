// Прозрачная кэширующая обёртка вокруг ЛЮБОГО ITranslationEngine — кэш проверяется ДО вызова
// движка, заполняется ПОСЛЕ (см. план, Этап 4). Подключается в
// TranslationEngineRegistry.ts::getActiveEngine(), а не в DOM-слое — PageTranslateManager.ts
// как звал getActiveEngine().translateBatch(...), так и продолжает звать, ничего не меняя.
import type { ITranslationEngine, TranslationItem, TranslationResult } from './TranslationEngine';
import type { TranslationCacheManager } from './TranslationCacheManager';

export class CachingTranslationEngine implements ITranslationEngine {
  readonly id: ITranslationEngine['id'];
  #inner: ITranslationEngine;
  #cache: TranslationCacheManager;

  constructor(inner: ITranslationEngine, cache: TranslationCacheManager) {
    this.id = inner.id;
    this.#inner = inner;
    this.#cache = cache;
  }

  isReady(): boolean {
    return this.#inner.isReady();
  }

  supportsPair(from: string, to: string): boolean {
    return this.#inner.supportsPair(from, to);
  }

  warmup(from: string, to: string): Promise<void> {
    return this.#inner.warmup(from, to);
  }

  dispose(): Promise<void> {
    return this.#inner.dispose();
  }

  // onProgress отражает только реально переведённые (не из кэша) юниты — если батч наполовину
  // из кэша, счётчик символов в тулбаре будет чуть ниже итогового при 100% прогресса батча, это
  // не баг: batchIndex/batchCount (границы батчей, см. PageTranslateManager.ts) на этом не строятся.
  async translateBatch(
    items: TranslationItem[],
    from: string,
    to: string,
    signal?: AbortSignal,
    onProgress?: (charsSoFar: number) => void,
  ): Promise<TranslationResult[]> {
    const cached: TranslationResult[] = [];
    const misses: TranslationItem[] = [];

    for (const item of items) {
      const hit = this.#cache.get(this.id, from, to, item.text);
      if (hit !== null) cached.push({ id: item.id, text: hit });
      else misses.push(item);
    }

    console.log(`[translation-cache] ${this.id} [${from}->${to}]: ${cached.length} из кэша, ${misses.length} новых`);
    if (misses.length === 0) return cached;

    const fresh = await this.#inner.translateBatch(misses, from, to, signal, onProgress);

    // Источник по id — заполняем кэш ПОСЛЕ реального перевода (см. план), ключ строится из
    // ОРИГИНАЛЬНОГО текста юнита, не из результата.
    const sourceById = new Map(misses.map((m) => [m.id, m.text]));
    for (const r of fresh) {
      const sourceText = sourceById.get(r.id);
      if (sourceText !== undefined) this.#cache.set(this.id, from, to, sourceText, r.text);
    }

    return [...cached, ...fresh];
  }
}
