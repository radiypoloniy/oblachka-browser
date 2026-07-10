// Векторный поиск по истории (заход G, блок 6). Без UI, без LLM — top-k по косинусному
// сходству. Новый, отдельный модуль: не внутри HistoryManager.ts (там только SQL) и не внутри
// ClusteringService.ts (та транзитивно тянет EmbeddingService.ts — Worker/DOM lib, недоступно
// в electron/, см. диагностику захода G про main-процесс). cosineSim здесь — намеренный дубль
// той же 4-строчной чистой функции из ClusteringService.ts (не импорт оттуда: импорт затянул бы
// весь модуль ClusteringService.ts вместе с его require('EmbeddingService') и сломал бы сборку
// electron/tsconfig.json, где нет DOM lib) — сама математика (скалярное произведение уже
// нормализованных моделью векторов) зафиксирована и не должна расходиться между копиями.
import type { HistoryContentChunk, HistoryManager } from './HistoryManager';
import { requestEmbedding } from './EmbedClient';
import { rerankHistoryCandidates } from './TranslationService';
import { isNoisyForEmbedding } from './HistoryNoiseFilter';
import { normalizeForOmnibox } from '../shared/frecency';
import type { HistoryEntry, SemanticSearchResult } from '../shared/ipc';

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

function toFloat32Array(buf: Buffer, dims: number): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, dims);
}

export type { SemanticSearchResult };

interface QueryEmbedding {
  vector: Float32Array;
  modelVersion: string;
}

function makeSnippet(text: string, max = 360): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max).trim()}...`;
}

function mergeBestByUrl(items: SemanticSearchResult[], limit: number): SemanticSearchResult[] {
  const byUrl = new Map<string, SemanticSearchResult>();
  for (const item of items) {
    const key = normalizeForOmnibox(item.url);
    const existing = byUrl.get(key);
    if (!existing || item.score > existing.score || (!existing.snippet && item.snippet)) byUrl.set(key, item);
  }
  return [...byUrl.values()].sort((a, b) => b.score - a.score).slice(0, limit);
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

function scoreSemanticCandidates(
  history: HistoryManager,
  query: QueryEmbedding,
  limit: number,
): SemanticSearchResult[] {
  const rows = history.getAllEmbeddings(query.modelVersion)
    .filter((r) => r.dims > 0 && !isNoisyForEmbedding(r.url, r.title));
  const pageResults: SemanticSearchResult[] = rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    lastVisit: r.lastVisit,
    visitCount: r.visitCount,
    score: cosineSim(query.vector, toFloat32Array(r.vector, r.dims)),
  }));

  const chunkResults = history.getAllContentChunks(query.modelVersion)
    .filter((r) => r.dims > 0 && !isNoisyForEmbedding(r.url, r.title))
    .map((r) => chunkToResult(r, cosineSim(query.vector, toFloat32Array(r.vector, r.dims)) + 0.03));

  return mergeBestByUrl([...chunkResults, ...pageResults], limit);
}

// Общий мост embed:request/response — тот же, что уже использует индексатор истории (блоки 3-4)
// и бэкфилл (блок 5). Один лишний вызов на один пользовательский поиск — разовая, малая
// нагрузка на общую очередь embeddingService.embed(), не батч и не серия чанков.
export async function searchHistorySemantic(
  history: HistoryManager,
  query: string,
  limit = 20,
): Promise<SemanticSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  let queryEmbedding: QueryEmbedding;
  try {
    const embedded = await requestEmbedding(q);
    queryEmbedding = { vector: embedded.vector, modelVersion: embedded.modelVersion };
  } catch (e) {
    console.warn('[HistorySearch] embed запроса не удался:', (e as Error).message);
    return [];
  }

  // dims === 0 — заглушка «намеренно не индексировано» (HistoryBackfill.ts, шумные для эмбеддинга
  // строки: логин/OAuth/голый домен). Не настоящий вектор — cosineSim(a, b) читает b[i] по длине
  // a, на пустом b это дало бы NaN (undefined * number), а не 0.
  // isNoisyForEmbedding здесь же — вторая проверка на этапе выборки, не только на этапе индексации
  // (HistoryIndexer.ts/HistoryBackfill.ts). Живой аудит показал дыру в паттернах фильтра (branded
  // хомпейджи вроде "Google Диск"/"Reddit — Сердце сети" её не ловят) — эта строка не чинит саму
  // дыру, но не даёт УЖЕ проиндексированным (с реальным вектором) шумным записям попадать в
  // кандидаты навсегда: если критерии фильтра позже расширятся, старые записи начнут отсеиваться
  // здесь без миграции/переиндексации.
  return scoreSemanticCandidates(history, queryEmbedding, limit);
}

// Умный поиск (заход на Qwen-переключатель) — только по явному действию (Enter в панели
// «История»), НЕ на каждый keystroke: генеративный вызов занимает секунды, не миллисекунды,
// как cosine top-k выше. Кандидаты — тот же searchHistorySemantic, шире (20, не 8) — Qwen сама
// решает, что из них реально релевантно, cosine-порядок для неё только черновой.
const SMART_CANDIDATE_LIMIT = 20;
const SMART_LEXICAL_CANDIDATE_LIMIT = 8;
const SMART_SEMANTIC_MIN_SCORE = 0.35;

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
): Promise<SemanticSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  let semanticCandidates: SemanticSearchResult[] = [];
  let ftsCandidates: SemanticSearchResult[] = [];
  try {
    const embedded = await requestEmbedding(q);
    const queryEmbedding = { vector: embedded.vector, modelVersion: embedded.modelVersion };
    semanticCandidates = scoreSemanticCandidates(history, queryEmbedding, SMART_CANDIDATE_LIMIT)
      .filter((c) => c.score >= SMART_SEMANTIC_MIN_SCORE);
    ftsCandidates = history.searchContentChunksFts(q, queryEmbedding.modelVersion, 12)
      .map((chunk) => chunkToResult(chunk, 1.12));
  } catch (e) {
    console.warn('[HistorySearch] embed запроса для smart search не удался:', (e as Error).message);
  }
  const lexicalCandidates = history.search(q)
    .slice(0, SMART_LEXICAL_CANDIDATE_LIMIT)
    .map((entry) => historyEntryToSemanticResult(entry, 1));

  const lexicalKeys = new Set(lexicalCandidates.map((c) => normalizeForOmnibox(c.url)));
  const byUrl = new Map<string, SemanticSearchResult>();
  for (const c of [...lexicalCandidates, ...ftsCandidates, ...semanticCandidates]) {
    const key = normalizeForOmnibox(c.url);
    const existing = byUrl.get(key);
    if (!existing || c.score > existing.score) byUrl.set(key, c);
  }
  const candidates = [...byUrl.values()].slice(0, SMART_CANDIDATE_LIMIT);
  if (candidates.length === 0) return [];

  let order: number[];
  try {
    order = await rerankHistoryCandidates(q, candidates.map((c) => ({
      id: c.id,
      title: c.title,
      url: c.url,
      score: c.score,
      snippet: c.snippet,
    })));
  } catch (e) {
    console.warn('[HistorySearch] Qwen-реранк не удался, отдаю cosine top-k как есть:', (e as Error).message);
    return candidates.slice(0, limit);
  }

  if (order.length === 0 && lexicalKeys.size > 0) {
    return candidates.filter((c) => lexicalKeys.has(normalizeForOmnibox(c.url))).slice(0, limit);
  }

  return order.slice(0, limit).map((i) => candidates[i]!);
}
