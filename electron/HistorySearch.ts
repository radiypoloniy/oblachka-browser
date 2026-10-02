// Умный поиск истории — лексика + FTS по сохранённому тексту чанков, Qwen-реранк top-k кандидатов
// (заход на Qwen-переключатель). Раньше здесь же жил векторный (cosine) поиск для омнибокса и
// смешанной семантической ветки умного поиска — оба пути удалены вместе с эмбеддингами (диагностика
// показала «магниты» без порога, отделяющего их от шума, см. git log).
import type { HistoryContentChunk, HistoryManager } from './HistoryManager';
import { TEXT_EXTRACTION_VERSION } from './HistoryManager';
import { expandHistorySearchQuery, rerankHistoryCandidates } from './TranslationService';
import { HISTORY_FTS_PAGE_LIMIT, prepareHistoryCandidateChunks } from './HistorySearchSnippet';
import { historySearchTopic } from './HistorySearchTopic';
import { normalizeForOmnibox } from '../shared/frecency';
import { readHistory } from './HistoryReader';
import { mergeExpandedHistory } from '../shared/historyExpansion';
import type { CandidateChunk, CandidateRows } from './HistoryReadQueries';
import type { HistoryEntry, SemanticSearchResult, SmartSearchResponse, HistorySearchFilters } from '../shared/ipc';

function chunkToResult(chunk: CandidateChunk, score: number): SemanticSearchResult {
  return {
    id: chunk.historyId,
    url: chunk.url,
    title: chunk.title,
    lastVisit: chunk.lastVisit,
    visitCount: chunk.visitCount,
    score,
    snippet: chunk.snippet,
    capturedAt: chunk.indexedAt,
  };
}

// Умный поиск (заход на Qwen-переключатель) — только по явному действию (Enter в панели
// «История»), НЕ на каждый keystroke: генеративный вызов занимает секунды, не миллисекунды.
const SMART_CANDIDATE_LIMIT = 20;
const SMART_LEXICAL_CANDIDATE_LIMIT = 8;

// Одна страница обычно разбита на несколько чанков (до HISTORY_CHUNK_MAX=8, см. HistoryIndexer.ts) —
// SQL-запрос к FTS идёт по чанкам, не по страницам, поэтому топ-N строк bm25 может оказаться
// несколькими чанками ОДНОЙ страницы (живая проверка на "apple": 4 из 12 строк — один и тот же
// историId). SMART_FTS_SQL_LIMIT — запас по чанкам, из которого дедуп по historyId ниже
// (prepareHistoryCandidateChunks) достаёт уже SMART_FTS_CANDIDATE_LIMIT РАЗНЫХ страниц.
const SMART_FTS_CANDIDATE_LIMIT = HISTORY_FTS_PAGE_LIMIT;
// До восьми чанков одной страницы могут подряд занять выдачу FTS. Бюджет строк
// гарантирует место для 12 разных страниц даже при таком худшем порядке.
const SMART_FTS_SQL_LIMIT = SMART_FTS_CANDIDATE_LIMIT * 8;

function historyEntryToSemanticResult(entry: HistoryEntry, score: number): SemanticSearchResult {
  return {
    id: entry.id,
    url: entry.url,
    title: entry.title,
    lastVisit: entry.lastVisit,
    visitCount: entry.visitCount,
    score,
  };
}

/**
 * Кандидаты из истории: лексика + FTS, дедуп по странице.
 *
 * ⚠️ Вынесено из searchHistorySmart БЕЗ изменения поведения — чтобы поиск «куда я это дел»
 * (StuffSearch.ts) брал те же самые кандидаты, а не заводил свою вторую копию этой логики.
 * Реранк сюда не входит намеренно: у объединённого поиска он один на все три источника.
 */
export interface HistoryCandidateSet {
  candidates: SemanticSearchResult[];
  lexicalKeys: ReadonlySet<string>;
}

// Один снимок кандидатов и их происхождения: запасной путь не перечитывает историю после FTS.
export function collectHistoryCandidateSet(history: HistoryManager, query: string): HistoryCandidateSet {
  const q = query.trim();
  if (!q) return { candidates: [], lexicalKeys: new Set() };

  const topic = historySearchTopic(q);
  let chunks: HistoryContentChunk[] = [];
  try {
    // Фильтр шума — до дедупа (не после), чтобы шумная страница не отъедала слот у
    // SMART_FTS_CANDIDATE_LIMIT впустую. h.title (см. коммит "заголовок из history, не из
    // чанка") — без него isNoisyForEmbedding почти всегда сработал бы по isBareDomainTitle:
    // заголовок-URL выглядит как «домен целиком», что выкосило бы валидные результаты, а не только шум.
    chunks = history.searchContentChunksFts(topic, TEXT_EXTRACTION_VERSION, SMART_FTS_SQL_LIMIT);
  } catch (e) {
    console.warn('[HistorySearch] FTS для smart search не удался:', (e as Error).message);
  }
  return mergeCandidateRows({ chunks, lexical: history.search(q, SMART_LEXICAL_CANDIDATE_LIMIT) }, topic);
}

export async function collectHistoryCandidateSetAsync(history: HistoryManager, query: string, filters?: HistorySearchFilters): Promise<HistoryCandidateSet> {
  const q = query.trim();
  if (!q) return { candidates: [], lexicalKeys: new Set() };
  const rows = await readHistory(history, {
    kind: 'candidates', query: q, version: TEXT_EXTRACTION_VERSION,
    lexicalLimit: SMART_LEXICAL_CANDIDATE_LIMIT, ftsLimit: SMART_FTS_SQL_LIMIT, filters,
  });
  return mergeCandidateRows(rows, q);
}

function mergeCandidateRows(rows: CandidateRows, query: string): HistoryCandidateSet {
  const ftsCandidates = (rows.prepared ? rows.chunks : prepareHistoryCandidateChunks(rows.chunks, query))
    .map((chunk, index) => chunkToResult(chunk, 1 / (60 + index + 1)));
  const lexicalCandidates = rows.lexical.map((entry, index) => historyEntryToSemanticResult(entry, 1 / (60 + index + 1)));

  // Ранги источников сопоставимы без сложения сырых BM25. Совместная находка получает бонус.
  const byUrl = new Map<string, SemanticSearchResult>();
  for (const c of [...lexicalCandidates, ...ftsCandidates]) {
    const key = normalizeForOmnibox(c.url);
    const existing = byUrl.get(key);
    if (!existing) byUrl.set(key, c);
    else byUrl.set(key, { ...existing, ...(c.snippet ? { snippet: c.snippet } : {}), score: existing.score + c.score });
  }
  return {
    candidates: [...byUrl.values()].sort((a, b) => b.score - a.score).slice(0, SMART_CANDIDATE_LIMIT),
    lexicalKeys: new Set(lexicalCandidates.map((c) => normalizeForOmnibox(c.url))),
  };
}

export function collectHistoryCandidates(history: HistoryManager, query: string): SemanticSearchResult[] {
  return collectHistoryCandidateSet(history, query).candidates;
}

export async function searchHistorySmart(
  history: HistoryManager,
  query: string,
  limit = 8,
  // background — поиск, которого человек не заказывал (подсказка «вы это уже читали»).
  // related — та же труба, но пустой реранк не должен гасить FTS: для headline это «не та
  // статья», для темы — как раз соседние материалы.
  opts?: { background?: boolean; related?: boolean; abort?: AbortSignal; filters?: HistorySearchFilters; expand?: boolean; onStage?: (stage: 'expanding' | 'retrieving' | 'ranking') => void },
): Promise<SmartSearchResponse> {
  const q = query.trim();
  if (!q) return { results: [], degraded: false };

  opts?.abort?.throwIfAborted();
  opts?.onStage?.('retrieving');
  let collected = await collectHistoryCandidateSetAsync(history, q, opts?.filters);
  if (opts?.expand) {
    try {
      opts.onStage?.('expanding');
      const variants = await expandHistorySearchQuery(q, opts.abort);
      const extra: HistoryCandidateSet[] = [];
      opts.onStage?.('retrieving');
      for (const variant of variants) {
        opts.abort?.throwIfAborted();
        extra.push(await collectHistoryCandidateSetAsync(history, variant, opts.filters));
      }
      if (extra.length) collected = mergeExpandedHistory(collected, extra);
    } catch (error) {
      opts.abort?.throwIfAborted();
      console.warn('[HistorySearch] расширение недоступно, используем исходный запрос');
    }
  }
  opts?.abort?.throwIfAborted();
  return rerankCollectedHistoryCandidates(q, collected, limit, opts);
}

// Связанные страницы передают уже собранный снимок, чтобы не повторять SQL и FTS перед Qwen.
export async function rerankCollectedHistoryCandidates(
  query: string,
  collected: HistoryCandidateSet,
  limit = 8,
  opts?: { background?: boolean; related?: boolean; abort?: AbortSignal; filters?: HistorySearchFilters; expand?: boolean; onStage?: (stage: 'expanding' | 'retrieving' | 'ranking') => void },
): Promise<SmartSearchResponse> {
  const q = query.trim();
  const { candidates, lexicalKeys } = collected;
  if (!q) return { results: [], degraded: false };
  if (candidates.length === 0) return { results: [], degraded: false };

  opts?.onStage?.('ranking');
  let order: number[];
  try {
    order = await rerankHistoryCandidates(q, candidates.map((c) => ({
      id: c.id,
      title: c.title,
      url: c.url,
      score: c.score,
      snippet: c.snippet,
    })), opts);
  } catch (e) {
    // degraded:true — вызывающая сторона (History.tsx) честно показывает пользователю, что это
    // лексика+FTS без участия Qwen, а не молчаливая подмена результата умного поиска.
    console.warn('[HistorySearch] Qwen-реранк не удался, отдаю лексику+FTS как есть:', (e as Error).message);
    // При сбое AI сохраняем приоритет обычных точных совпадений, как до нового ранжирования.
    const fallback = [...candidates].sort((a, b) => Number(lexicalKeys.has(normalizeForOmnibox(b.url))) - Number(lexicalKeys.has(normalizeForOmnibox(a.url))));
    return { results: fallback.slice(0, limit), degraded: true, fallbackReason: 'unavailable' };
  }

  if (order.length === 0 && opts?.related) {
    return { results: candidates.slice(0, limit), degraded: true, fallbackReason: 'no-semantic-match' };
  }
  if (order.length === 0 && lexicalKeys.size > 0) {
    // Совпадение в заголовке полезно сохранить, но отказ модели нельзя выдавать за её одобрение.
    return { results: candidates.filter((c) => lexicalKeys.has(normalizeForOmnibox(c.url))).slice(0, limit),
      degraded: true, fallbackReason: 'no-semantic-match' };
  }

  return { results: order.slice(0, limit).map((i) => candidates[i]!), degraded: false };
}
