// Индексация истории эмбеддингами (заход G, блок 3). Вызывается из main.ts после recordVisit —
// recordVisit/updateTitle в HistoryManager.ts не меняются, это отдельная обёртка над call site.
// Каждый уровень (id → embed → запись) изолирован своим try/catch: сбой здесь не должен всплыть
// как сбой навигации/записи истории для пользователя — тихий лог, запись остаётся
// неиндексированной до следующей попытки (или до бэкфилла, блок 5).
import type { HistoryManager } from './HistoryManager';
import { requestEmbedding } from './EmbedClient';

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export async function indexVisit(history: HistoryManager, url: string, title: string): Promise<void> {
  const historyId = history.getIdByUrl(url);
  if (historyId === null) return; // #shouldRecord отфильтровал (about:/поиск-result/…) — индексировать нечего

  // Тот же формат сигнала, что и AI-группировка вкладок (ClusteringService.ts::buildCandidates) —
  // title + hostname, без пути/query.
  const text = `${title} ${hostnameOf(url)}`.trim();
  if (!text) return;

  let embedded: Awaited<ReturnType<typeof requestEmbedding>>;
  try {
    embedded = await requestEmbedding(text);
  } catch (e) {
    console.warn(`[HistoryIndexer] embed не удался для ${url}:`, (e as Error).message);
    return;
  }

  try {
    history.saveEmbedding(historyId, embedded.vector, embedded.dims, embedded.modelVersion);
  } catch (e) {
    console.warn(`[HistoryIndexer] запись эмбеддинга не удалась для ${url}:`, (e as Error).message);
  }
}
