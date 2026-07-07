// Индексация истории эмбеддингами (заход G, блок 3+4). Вызывается из main.ts после recordVisit —
// recordVisit/updateTitle в HistoryManager.ts не меняются, это отдельная обёртка над call site.
// Каждый уровень (id → embed → запись) изолирован: сбой здесь не должен всплыть как сбой
// навигации/записи истории для пользователя — тихий лог, запись остаётся неиндексированной до
// следующей попытки (или до бэкфилла, блок 5). Успешная индексация НЕ логируется намеренно —
// иначе обычный браузинг захламляет stdout логом на каждый визит.
import type { HistoryManager } from './HistoryManager';
import { requestEmbedding } from './EmbedClient';

// Блок 4: не в HistoryManager.ts (тот в этом заходе не трогается) — держим факт «уже
// проиндексирована в этой сессии» здесь же, в памяти процесса. Не персистентно между
// перезапусками (после рестарта первая ревизита ранее проиндексированной страницы отправит
// embed() ещё раз один-единственный раз, дальше снова тихо пропускается) — сознательный
// компромис ради того, чтобы не трогать HistoryManager.ts. Без этой проверки каждая
// ПОВТОРНАЯ навигация на уже посещённую страницу (recordVisit — upsert, стреляет на любой
// повторный визит, не только на первый) слала бы новый embed:request в ту же очередь, что
// кластеризация вкладок — то, от чего явно предостерегает бриф блока 4.
const indexedHistoryIds = new Set<number>();

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export async function indexVisit(history: HistoryManager, url: string, title: string): Promise<void> {
  // Шаг 1: id. getIdByUrl() уже не бросает (свой try/catch внутри HistoryManager.ts, заход G
  // блок 2) — здесь дополнительный try/catch был бы мёртвым кодом на сценарий, который не
  // может случиться; null уже покрывает и «не найдено», и «БД недоступна».
  const historyId = history.getIdByUrl(url);
  if (historyId === null) return; // #shouldRecord отфильтровал (about:/поиск-result/…) — индексировать нечего

  // Идемпотентность (блок 4): ревизит уже проиндексированной страницы — no-op, не спамим
  // очередь embed() повторно на каждый повторный визит.
  if (indexedHistoryIds.has(historyId)) return;

  // Тот же формат сигнала, что и AI-группировка вкладок (ClusteringService.ts::buildCandidates) —
  // title + hostname, без пути/query.
  const text = `${title} ${hostnameOf(url)}`.trim();
  if (!text) return;

  // Шаг 2: embed.
  let embedded: Awaited<ReturnType<typeof requestEmbedding>>;
  try {
    embedded = await requestEmbedding(text);
  } catch (e) {
    console.warn(`[HistoryIndexer] embed не удался для ${url}:`, (e as Error).message);
    return; // не помечаем как проиндексированную — следующий визит попробует снова
  }

  // Шаг 3: запись. saveEmbedding() тоже не бросает наружу (свой try/catch в HistoryManager.ts),
  // но try/catch здесь остаётся явным по контракту блока 4 — и на случай, если это когда-нибудь
  // изменится, успешный embed без записи не должен молча помечаться как проиндексированный.
  try {
    history.saveEmbedding(historyId, embedded.vector, embedded.dims, embedded.modelVersion);
    indexedHistoryIds.add(historyId); // помечаем ТОЛЬКО после реально успешной записи
  } catch (e) {
    console.warn(`[HistoryIndexer] запись эмбеддинга не удалась для ${url}:`, (e as Error).message);
  }
}
