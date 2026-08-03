// Умный поиск истории — лексика + FTS по сохранённому тексту чанков, Qwen-реранк top-k кандидатов
// (заход на Qwen-переключатель). Раньше здесь же жил векторный (cosine) поиск для омнибокса и
// смешанной семантической ветки умного поиска — оба пути удалены вместе с эмбеддингами (диагностика
// показала «магниты» без порога, отделяющего их от шума, см. git log).
import type { HistoryContentChunk, HistoryManager } from './HistoryManager';
import { TEXT_EXTRACTION_VERSION } from './HistoryManager';
import { rerankHistoryCandidates } from './TranslationService';
import { isNoisyForEmbedding } from './HistoryNoiseFilter';
import { normalizeForOmnibox } from '../shared/frecency';
import type { HistoryEntry, SemanticSearchResult, SmartSearchResponse } from '../shared/ipc';

function makeSnippet(text: string, max = 360): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max).trim()}...`;
}

function chunkToResult(chunk: HistoryContentChunk, score: number): SemanticSearchResult {
  return {
    id: chunk.historyId,
    url: chunk.url,
    title: chunk.title,
    lastVisit: chunk.lastVisit,
    visitCount: chunk.visitCount,
    score,
    snippet: makeSnippet(chunk.text),
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
// (dedupChunksByHistoryId) достаёт уже SMART_FTS_CANDIDATE_LIMIT РАЗНЫХ страниц.
const SMART_FTS_SQL_LIMIT = 60;
const SMART_FTS_CANDIDATE_LIMIT = 12;

// Строки уже отсортированы по bm25 (searchContentChunksFts::ORDER BY rank ASC) — первое
// вхождение historyId в порядке обхода и есть лучший по релевантности чанк этой страницы.
function dedupChunksByHistoryId(chunks: HistoryContentChunk[], limit: number): HistoryContentChunk[] {
  const seen = new Set<number>();
  const result: HistoryContentChunk[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.historyId)) continue;
    seen.add(chunk.historyId);
    result.push(chunk);
    if (result.length >= limit) break;
  }
  return result;
}

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

export async function searchHistorySmart(
  history: HistoryManager,
  query: string,
  limit = 8,
  // background — поиск, которого человек не заказывал (подсказка «вы это уже читали», см.
  // RelatedHistory.ts). Такой ждёт, пока пользовательская полоса очереди не опустеет.
  opts?: { background?: boolean },
): Promise<SmartSearchResponse> {
  const q = query.trim();
  if (!q) return { results: [], degraded: false };

  let ftsCandidates: SemanticSearchResult[] = [];
  try {
    // Фильтр шума — до дедупа (не после), чтобы шумная страница не отъедала слот у
    // SMART_FTS_CANDIDATE_LIMIT впустую. h.title (см. коммит "заголовок из history, не из
    // чанка") — без него isNoisyForEmbedding почти всегда сработал бы по isBareDomainTitle:
    // заголовок-URL выглядит как «домен целиком», что выкосило бы валидные результаты, а не только шум.
    const ftsChunks = history.searchContentChunksFts(q, TEXT_EXTRACTION_VERSION, SMART_FTS_SQL_LIMIT)
      .filter((chunk) => !isNoisyForEmbedding(chunk.url, chunk.title));
    ftsCandidates = dedupChunksByHistoryId(ftsChunks, SMART_FTS_CANDIDATE_LIMIT)
      .map((chunk) => chunkToResult(chunk, 1.12));
  } catch (e) {
    console.warn('[HistorySearch] FTS для smart search не удался:', (e as Error).message);
  }
  const lexicalCandidates = history.search(q)
    .slice(0, SMART_LEXICAL_CANDIDATE_LIMIT)
    .map((entry) => historyEntryToSemanticResult(entry, 1));

  const lexicalKeys = new Set(lexicalCandidates.map((c) => normalizeForOmnibox(c.url)));
  // Лексика → FTS: точное совпадение по заголовку/URL (лексика) весомее текстового FTS-совпадения
  // внутри чанка, поэтому идёт первым — при коллизии URL ниже побеждает бОльший score, а не порядок
  // сам по себе, но порядок определяет, чья версия («первая встреченная» при равном score) войдёт
  // в byUrl. SMART_LEXICAL_CANDIDATE_LIMIT(8) + SMART_FTS_CANDIDATE_LIMIT(12) = SMART_CANDIDATE_LIMIT(20)
  // — весь бюджет кандидатов честно делят эти два источника.
  const byUrl = new Map<string, SemanticSearchResult>();
  for (const c of [...lexicalCandidates, ...ftsCandidates]) {
    const key = normalizeForOmnibox(c.url);
    const existing = byUrl.get(key);
    if (!existing || c.score > existing.score) byUrl.set(key, c);
  }
  const candidates = [...byUrl.values()].slice(0, SMART_CANDIDATE_LIMIT);
  if (candidates.length === 0) return { results: [], degraded: false };

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
    return { results: candidates.slice(0, limit), degraded: true };
  }

  if (order.length === 0 && lexicalKeys.size > 0) {
    return { results: candidates.filter((c) => lexicalKeys.has(normalizeForOmnibox(c.url))).slice(0, limit), degraded: false };
  }

  return { results: order.slice(0, limit).map((i) => candidates[i]!), degraded: false };
}
