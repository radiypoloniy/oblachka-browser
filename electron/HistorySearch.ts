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
import type { HistoryEntry, SemanticSearchResult, SmartSearchResponse } from '../shared/ipc';

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

// МЁРТВАЯ с точки зрения UI: единственный вызывающий (Toolbar.tsx::buildSuggestions, семантические
// подсказки омнибокса) убран — диагностика показала «магниты» без порога, отделяющего их от шума.
// Функция намеренно НЕ удалена — уходит вместе с EmbedClient.ts на этапе полного удаления
// эмбеддингов (requestEmbedding ниже), не раньше. IPC-канал HISTORY_SEARCH_SEMANTIC (shared/ipc.ts)
// помечен тем же образом.
//
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
    const embedded = await requestEmbedding(q, 'query');
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

// По диагностике от 2026-07-20 (11 живых запросов, 8 присутствующих тем + 3 заведомо
// отсутствующих, вручную размечено по title/url): cosine по этому корпусу структурно не даёт
// сигнала для коротких запросов — фиксированный набор generic-«магнитов» (Unsplash-главная,
// CMS-админка admin.imweb.ru, Remnawave-дашборд, Wikipedia-главная, Газета.Ru-главная,
// французская статья "Porc — Wikipédia") доминирует топ-20 ПОЧТИ ДЛЯ ЛЮБОГО запроса
// (0.53–0.85), включая заведомо отсутствующие темы (потолок шума там — 0.75). Диапазон
// релевантных результатов (0.53–0.84) целиком лежит внутри диапазона шума — порога, отделяющего
// одно от другого, не существует (см. диагностику). Единственные случаи, где скор хоть что-то
// показывал — буквальное лексическое пересечение слова запроса с заголовком (не семантика).
// Возможная причина — эмбеддинг без task-префиксов EmbeddingGemma (модель ожидает
// query/document-префиксы для осмысленного different-typed similarity, конвейер их не
// проставляет); до проверки этой гипотезы семантическая ветка в умном поиске отключена.
// scoreSemanticCandidates НЕ удалена — переключить обратно можно одной строкой, когда гипотеза
// проверена (или найдено другое решение).
const SEMANTIC_IN_SMART_SEARCH = false;

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
): Promise<SmartSearchResponse> {
  const q = query.trim();
  if (!q) return { results: [], degraded: false };

  let semanticCandidates: SemanticSearchResult[] = [];
  let ftsCandidates: SemanticSearchResult[] = [];
  try {
    const embedded = await requestEmbedding(q, 'query');
    const queryEmbedding = { vector: embedded.vector, modelVersion: embedded.modelVersion };
    // SEMANTIC_IN_SMART_SEARCH=false — semanticCandidates остаётся [] (см. комментарий у флага
    // выше). Эмбеддинг запроса всё равно нужен ниже для FTS-пути (searchContentChunksFts берёт
    // modelVersion из него, не сам вектор), поэтому requestEmbedding() не пропускаем.
    if (SEMANTIC_IN_SMART_SEARCH) {
      semanticCandidates = scoreSemanticCandidates(history, queryEmbedding, SMART_CANDIDATE_LIMIT)
        .filter((c) => c.score >= SMART_SEMANTIC_MIN_SCORE);
    }
    // Фильтр шума — до дедупа (не после), чтобы шумная страница не отъедала слот у
    // SMART_FTS_CANDIDATE_LIMIT впустую (тот же порядок «фильтр → лимит», что и в
    // scoreSemanticCandidates ниже). h.title (см. коммит "заголовок из history, не из чанка") —
    // без него isNoisyForEmbedding почти всегда сработал бы по isBareDomainTitle: заголовок-URL
    // выглядит как «домен целиком», что выкосило бы валидные результаты, а не только шум.
    const ftsChunks = history.searchContentChunksFts(q, queryEmbedding.modelVersion, SMART_FTS_SQL_LIMIT)
      .filter((chunk) => !isNoisyForEmbedding(chunk.url, chunk.title));
    ftsCandidates = dedupChunksByHistoryId(ftsChunks, SMART_FTS_CANDIDATE_LIMIT)
      .map((chunk) => chunkToResult(chunk, 1.12));
  } catch (e) {
    console.warn('[HistorySearch] embed запроса для smart search не удался:', (e as Error).message);
  }
  const lexicalCandidates = history.search(q)
    .slice(0, SMART_LEXICAL_CANDIDATE_LIMIT)
    .map((entry) => historyEntryToSemanticResult(entry, 1));

  const lexicalKeys = new Set(lexicalCandidates.map((c) => normalizeForOmnibox(c.url)));
  // Лексика → FTS → семантика (при SEMANTIC_IN_SMART_SEARCH=false — пустой хвост): точное
  // совпадение по заголовку/URL (лексика) весомее текстового FTS-совпадения внутри чанка,
  // поэтому идёт первым — при коллизии URL ниже побеждает бОльший score, а не порядок сам
  // по себе, но порядок определяет, чья версия («первая встреченная» при равном score) войдёт
  // в byUrl. SMART_LEXICAL_CANDIDATE_LIMIT(8) + SMART_FTS_CANDIDATE_LIMIT(12) = SMART_CANDIDATE_LIMIT(20)
  // — весь бюджет кандидатов теперь честно делят только эти два источника.
  const byUrl = new Map<string, SemanticSearchResult>();
  for (const c of [...lexicalCandidates, ...ftsCandidates, ...semanticCandidates]) {
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
    })));
  } catch (e) {
    // degraded:true — вызывающая сторона (History.tsx) честно показывает пользователю, что это
    // cosine top-k без участия Qwen, а не молчаливая подмена результата умного поиска.
    console.warn('[HistorySearch] Qwen-реранк не удался, отдаю cosine top-k как есть:', (e as Error).message);
    return { results: candidates.slice(0, limit), degraded: true };
  }

  if (order.length === 0 && lexicalKeys.size > 0) {
    return { results: candidates.filter((c) => lexicalKeys.has(normalizeForOmnibox(c.url))).slice(0, limit), degraded: false };
  }

  return { results: order.slice(0, limit).map((i) => candidates[i]!), degraded: false };
}
