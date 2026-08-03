// «Вы это уже читали» — страницы из СВОЕЙ истории, связанные с той, что открыта сейчас.
//
// Зачем: главная ценность истории не в списке за вчера, а в ответе на вопрос «я про это уже
// читал — где?». Ни одно облако на него ответить не может в принципе: ему неоткуда знать, что
// вы читали. А локально всё уже лежит — FTS5-индекс содержимого страниц и переранжирование
// (см. HistorySearch.ts), — и новую машинерию строить не нужно вовсе.
//
// ⚠️ Запросом служит ЗАГОЛОВОК открытой страницы, очищенный от хвоста с именем сайта. Без чистки
// («Расчёт НДФЛ — Госуслуги») в запрос попадает имя сайта, и поиск честно возвращает другие
// страницы того же сайта — то есть «связанное» вырождается в «этот же домен».
import type { HistoryManager } from './HistoryManager';
import { searchHistorySmart } from './HistorySearch';
import { isModelWarm } from './TranslationService';
import type { SemanticSearchResult } from '../shared/ipc';
import { normalizeForOmnibox } from '../shared/frecency';

// Разделители «заголовок — сайт», которыми пользуется практически весь веб.
const SITE_TAIL = /\s+[—–\-|·]\s+[^—–\-|·]{2,40}$/;

/** Запрос из заголовка: без хвоста-сайта, без служебных префиксов вроде «(3)» у почты. */
export function queryFromTitle(title: string): string {
  let t = (title || '').trim().replace(/^\(\d+\)\s*/, '');
  const stripped = t.replace(SITE_TAIL, '').trim();
  // Если после чистки осталось совсем мало — значит хвост и был всем заголовком, берём как есть.
  if (stripped.length >= 12) t = stripped;
  return t.slice(0, 120);
}

/**
 * Связанные страницы из истории. Пустой массив — «нечего показать», и это нормальный ответ:
 * подсказка появляется, только когда ей действительно есть что сказать.
 *
 * ⚠️ Только на ТЁПЛОЙ модели и фоновой полосой — как и остальные фичи, которые человек не
 * заказывал явно (он всего лишь щёлкнул в адресную строку).
 */
export async function findRelatedPages(
  history: HistoryManager,
  currentUrl: string,
  currentTitle: string,
  limit = 3,
): Promise<SemanticSearchResult[]> {
  const q = queryFromTitle(currentTitle);
  if (q.length < 8 || !isModelWarm()) return [];

  const currentKey = normalizeForOmnibox(currentUrl);
  const res = await searchHistorySmart(history, q, limit + 4, { background: true });
  const out: SemanticSearchResult[] = [];
  const seen = new Set<string>([currentKey]);
  for (const r of res.results) {
    const key = normalizeForOmnibox(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  console.log(`[related] «${q.slice(0, 40)}» → ${out.length} страниц${res.degraded ? ' (без реранка)' : ''}`);
  return out;
}
