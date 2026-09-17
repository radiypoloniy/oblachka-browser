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
import type { RelatedPagesResult, SemanticSearchResult } from '../shared/ipc';
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

const DONE = (results: SemanticSearchResult[]): RelatedPagesResult => ({ results, pending: false });

// Один поиск на адрес+запрос. Первый вызов при тёплой модели отдаёт FTS с pending:true
// (на экран это не кладут) и запускает реранк; второй дожидается реранка. Повторный клик
// присоединяется к тому же промису, а не получает пустой массив.
//
// ⚠️ Раньше IPC при занятом запросе отвечал `[]`. Повторный клик по строке убивал первый
// ответ счётчиком поколений панели и подменял второй пустышкой.
type RelatedJob = {
  key: string;
  fts: SemanticSearchResult[];
  ranked: Promise<SemanticSearchResult[]> | null;
};

let inflight: RelatedJob | null = null;

function jobKey(currentKey: string, q: string): string {
  return `${currentKey}\n${q}`;
}

/**
 * Связанные страницы из истории. Пустой массив — «нечего показать», и это нормальный ответ:
 * подсказка появляется, только когда ей действительно есть что сказать.
 *
 * ⚠️ Холодная модель больше не гасит фичу: FTS не нуждается в Qwen. Реранк — фоновая полоса,
 * только если модель уже тёплая (человек щёлкнул в строку, 30 с загрузки не заказывал).
 * ⚠️ FTS при идущем реранке на экран не кладут: мелькание чужих заголовков хуже секунды
 * ожидания. Renderer рисует скелет той же длины, затем один раз — уже переставленный ряд.
 */
export async function findRelatedPages(
  history: HistoryManager,
  currentUrl: string,
  currentTitle: string,
  limit = 3,
): Promise<RelatedPagesResult> {
  const q = relatedQueryFromTitle(currentTitle);
  if (!q) return DONE([]);

  const currentKey = normalizeForOmnibox(currentUrl);
  const key = jobKey(currentKey, q);
  if (inflight?.key === key) {
    if (inflight.ranked) return DONE(await inflight.ranked);
    return DONE(inflight.fts);
  }

  const fts = takeRelated(collectHistoryCandidates(history, q), currentKey, limit);
  console.log(`[related] «${q.slice(0, 40)}» → ${fts.length} страниц (FTS)`);

  const job: RelatedJob = { key, fts, ranked: null };
  inflight = job;
  if (!isModelWarm()) return DONE(fts);

  job.ranked = searchHistorySmart(history, q, limit + 4, { background: true, related: true })
    .then((res) => {
      const out = takeRelated(res.results, currentKey, limit);
      const final = out.length ? out : fts;
      console.log(`[related] «${q.slice(0, 40)}» → ${final.length} страниц${res.degraded ? ' (без реранка)' : ''}`);
      return final;
    })
    .catch((err) => {
      console.warn('[related] ошибка реранка:', err);
      return fts;
    });
  return { results: fts, pending: true };
}
