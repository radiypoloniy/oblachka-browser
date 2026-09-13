// «Вы это уже читали» — страницы из СВОЕЙ истории, связанные с той, что открыта сейчас.
//
// Зачем: главная ценность истории не в списке за вчера, а в ответе на вопрос «я про это уже
// читал — где?». Ни одно облако на него ответить не может в принципе: ему неоткуда знать, что
// вы читали. А локально всё уже лежит — FTS5-индекс содержимого страниц и переранжирование
// (см. HistorySearch.ts).
//
// ⚠️ Запрос — тема из заголовка (shared/relatedHistory.ts), не headline целиком. Иначе
// «Караван, процедурная генерация… Diablo V» теряет Diablo за лимитом FTS в 8 слов, а реранк
// ищет ту же статью и молчит. FTS без модели уже ответ; модель только переставляет.
import type { HistoryManager } from './HistoryManager';
import { collectHistoryCandidates, searchHistorySmart } from './HistorySearch';
import { isModelWarm } from './TranslationService';
import type { SemanticSearchResult } from '../shared/ipc';
import { normalizeForOmnibox } from '../shared/frecency';
import { relatedQueryFromTitle } from '../shared/relatedHistory';

function takeRelated(
  rows: readonly SemanticSearchResult[],
  currentKey: string,
  limit: number,
): SemanticSearchResult[] {
  const out: SemanticSearchResult[] = [];
  const seen = new Set<string>([currentKey]);
  for (const r of rows) {
    const key = normalizeForOmnibox(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Связанные страницы из истории. Пустой массив — «нечего показать», и это нормальный ответ:
 * подсказка появляется, только когда ей действительно есть что сказать.
 *
 * ⚠️ Холодная модель больше не гасит фичу: FTS не нуждается в Qwen. Реранк — фоновая полоса,
 * только если модель уже тёплая (человек щёлкнул в строку, 30 с загрузки не заказывал).
 */
export async function findRelatedPages(
  history: HistoryManager,
  currentUrl: string,
  currentTitle: string,
  limit = 3,
): Promise<SemanticSearchResult[]> {
  const q = relatedQueryFromTitle(currentTitle);
  if (!q) return [];

  const currentKey = normalizeForOmnibox(currentUrl);
  if (!isModelWarm()) {
    const out = takeRelated(collectHistoryCandidates(history, q), currentKey, limit);
    console.log(`[related] «${q.slice(0, 40)}» → ${out.length} страниц (без реранка)`);
    return out;
  }

  const res = await searchHistorySmart(history, q, limit + 4, { background: true, related: true });
  const out = takeRelated(res.results, currentKey, limit);
  console.log(`[related] «${q.slice(0, 40)}» → ${out.length} страниц${res.degraded ? ' (без реранка)' : ''}`);
  return out;
}
