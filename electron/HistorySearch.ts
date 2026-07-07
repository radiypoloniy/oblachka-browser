// Векторный поиск по истории (заход G, блок 6). Без UI, без LLM — top-k по косинусному
// сходству. Новый, отдельный модуль: не внутри HistoryManager.ts (там только SQL) и не внутри
// ClusteringService.ts (та транзитивно тянет EmbeddingService.ts — Worker/DOM lib, недоступно
// в electron/, см. диагностику захода G про main-процесс). cosineSim здесь — намеренный дубль
// той же 4-строчной чистой функции из ClusteringService.ts (не импорт оттуда: импорт затянул бы
// весь модуль ClusteringService.ts вместе с его require('EmbeddingService') и сломал бы сборку
// electron/tsconfig.json, где нет DOM lib) — сама математика (скалярное произведение уже
// нормализованных моделью векторов) зафиксирована и не должна расходиться между копиями.
import type { HistoryManager } from './HistoryManager';
import { requestEmbedding } from './EmbedClient';
import type { SemanticSearchResult } from '../shared/ipc';

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

function toFloat32Array(buf: Buffer, dims: number): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, dims);
}

export type { SemanticSearchResult };

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

  let queryVector: Float32Array;
  try {
    const embedded = await requestEmbedding(q);
    queryVector = embedded.vector;
  } catch (e) {
    console.warn('[HistorySearch] embed запроса не удался:', (e as Error).message);
    return [];
  }

  // dims === 0 — заглушка «намеренно не индексировано» (HistoryBackfill.ts, шумные для эмбеддинга
  // строки: логин/OAuth/голый домен). Не настоящий вектор — cosineSim(a, b) читает b[i] по длине
  // a, на пустом b это дало бы NaN (undefined * number), а не 0.
  const rows = history.getAllEmbeddings().filter((r) => r.dims > 0);
  const scored: SemanticSearchResult[] = rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    lastVisit: r.lastVisit,
    visitCount: r.visitCount,
    score: cosineSim(queryVector, toFloat32Array(r.vector, r.dims)),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
