// Индексация истории эмбеддингами (заход G, блок 3+4). Вызывается из main.ts после recordVisit —
// recordVisit/updateTitle в HistoryManager.ts не меняются, это отдельная обёртка над call site.
// Каждый уровень (id → embed → запись) изолирован: сбой здесь не должен всплыть как сбой
// навигации/записи истории для пользователя — тихий лог, запись остаётся неиндексированной до
// следующей попытки (или до бэкфилла, блок 5). Успешная индексация НЕ логируется намеренно —
// иначе обычный браузинг захламляет stdout логом на каждый визит.
//
// Заход на обогащение эмбеддинга контентом страницы (после очистки истории — см. history, чистый
// корпус, миграция не нужна): текст для embed() теперь — Readability-контент страницы, когда
// удалось его дождаться и извлечь, иначе честный fallback на title+hostname (как было). Реюз
// extractPageText из AiPanelManager.ts — тот же пайплайн, что у AI-панели, не дублируем его.
import type { WebContents } from 'electron';
import type { HistoryManager } from './HistoryManager';
import { requestEmbedding } from './EmbedClient';
import { extractPageText } from './AiPanelManager';
import { isNoisyForEmbedding } from './HistoryNoiseFilter';

// Блок 4: не в HistoryManager.ts (тот в этом заходе не трогается) — держим факт «уже
// проиндексирована в этой сессии» здесь же, в памяти процесса. Не персистентно между
// перезапусками (после рестарта первая ревизита ранее проиндексированной страницы отправит
// embed() ещё раз один-единственный раз, дальше снова тихо пропускается) — сознательный
// компромис ради того, чтобы не трогать HistoryManager.ts. Без этой проверки каждая
// ПОВТОРНАЯ навигация на уже посещённую страницу (recordVisit — upsert, стреляет на любой
// повторный визит, не только на первый) слала бы новый embed:request в ту же очередь, что
// кластеризация вкладок — то, от чего явно предостерегает бриф блока 4.
const indexedHistoryIds = new Set<number>();

// Сколько ждать did-finish-load, прежде чем сдаться и уйти в fallback (title+hostname) —
// страница может вообще не догрузиться (сеть/ошибка/редирект в никуда), fire-and-forget
// индексация не должна зависать на ней навсегда.
const EXTRACTION_TIMEOUT_MS = 8000;

// did-finish-load — это конец СЕТЕВОЙ загрузки, не конец отрисовки. Тяжёлые SPA (Google Диск,
// почта, ленты) в этот момент ещё показывают скелетон/спиннер — реальный контент дорисовывается
// позже через XHR/fetch. Живой аудит истории (см. задачу про качество умного поиска) поймал
// ровно это: чанк с текстом "Загружается... (собрано 74%)" вместо содержимого папки. Задержка
// перед первым снимком — не блокирует навигацию/UI, извлечение всё ещё fire-and-forget.
const SPA_SETTLE_DELAY_MS = 1200;
// Повторный снимок ПОСЛЕ первого — если текст заметно вырос, первый снимок поймал страницу
// в процессе дорисовки. Один повтор с фиксированным бюджетом, не опрос до полной стабилизации —
// для страниц, которым и этого мало, остаётся fallback на title+hostname, не зависание.
const SPA_SETTLE_RECHECK_MS = 1000;
const SPA_SETTLE_GROWTH_RATIO = 1.3;

// Отдельный, куда меньший лимит, чем PAGE_TEXT_MAX_CHARS у AI-панели (28000 симв., там нужен
// полный контекст для LLM-диалога) — эмбеддинг сжимает вход в 256 чисел, длинный текст не даёт
// пропорционально лучший вектор, только лишняя нагрузка на общую очередь embed().
export const HISTORY_EMBED_TEXT_MAX_CHARS = 2000;
const HISTORY_CHUNK_SOURCE_MAX_CHARS = 12_000;
const HISTORY_CHUNK_TARGET_CHARS = 1400;
const HISTORY_CHUNK_OVERLAP_CHARS = 220;
const HISTORY_CHUNK_MAX = 8;

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Экспортирована для HistoryContentBackfill.ts — тот же пайплайн чанкинга для тихого
// переоткрытия старых страниц, дублировать логику незачем.
export function buildTextChunks(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, HISTORY_CHUNK_SOURCE_MAX_CHARS);
  if (!normalized) return [];
  if (normalized.length <= HISTORY_CHUNK_TARGET_CHARS) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length && chunks.length < HISTORY_CHUNK_MAX) {
    const hardEnd = Math.min(normalized.length, start + HISTORY_CHUNK_TARGET_CHARS);
    let end = hardEnd;
    if (hardEnd < normalized.length) {
      const punctuation = normalized.lastIndexOf('.', hardEnd);
      const boundary = punctuation > start + 500 ? punctuation + 1 : normalized.lastIndexOf(' ', hardEnd);
      if (boundary > start + 500) end = boundary;
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(end - HISTORY_CHUNK_OVERLAP_CHARS, start + 1);
  }
  return chunks;
}

// Резолвится либо по событию did-finish-load ЭТОЙ вкладки, либо по таймауту — что раньше.
// Не различает, чья именно навигация закончилась (см. extractEnrichedText — проверка URL после).
function waitForFinishLoad(wc: WebContents): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      wc.removeListener('did-finish-load', finish);
      clearTimeout(timer);
      resolve();
    };
    wc.once('did-finish-load', finish);
    const timer = setTimeout(finish, EXTRACTION_TIMEOUT_MS);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Гонка: юзер успел уйти со страницы (или навигация вообще не завершилась, а сработал
// did-finish-load ПОЗДНЕЙШЕЙ навигации той же вкладки) — извлекать нечего, честный fallback.
function stillOnPage(wc: WebContents, url: string): boolean {
  return !wc.isDestroyed() && wc.getURL() === url;
}

// null — не удалось (вкладка закрыта/страница не догрузилась к таймауту/юзер ушёл на другой
// URL до конца загрузки/Readability не нашла текста) — indexVisit уходит в fallback.
// Экспортирована для HistoryContentBackfill.ts — тот же did-finish-load/SPA-settle пайплайн,
// что и обычная индексация визита, просто источник wc другой (скрытая фоновая вьюха, не
// реальная вкладка пользователя).
export async function extractEnrichedText(wc: WebContents | null, url: string): Promise<string | null> {
  if (!wc || wc.isDestroyed()) return null;
  await waitForFinishLoad(wc);
  if (!stillOnPage(wc, url)) return null;

  // Первый снимок — не сразу: см. SPA_SETTLE_DELAY_MS про скелетон/спиннер SPA на did-finish-load.
  await wait(SPA_SETTLE_DELAY_MS);
  if (!stillOnPage(wc, url)) return null;
  const first = await extractPageText(wc);
  if (!stillOnPage(wc, url)) return first.text || null;

  // Повторный снимок: если текст заметно вырос — страница ещё дорисовывалась на первом снимке,
  // берём более полный второй. Иначе первый снимок уже стабилен — не тратим лишний прогон.
  await wait(SPA_SETTLE_RECHECK_MS);
  if (!stillOnPage(wc, url)) return first.text || null;
  const second = await extractPageText(wc);
  if (!stillOnPage(wc, url)) return first.text || null;

  if (second.text.length > first.text.length * SPA_SETTLE_GROWTH_RATIO) return second.text || null;
  return first.text || second.text || null;
}

export async function indexVisit(
  history: HistoryManager,
  url: string,
  title: string,
  wc: WebContents | null,
): Promise<void> {
  // Шаг 1: id. getIdByUrl() уже не бросает (свой try/catch внутри HistoryManager.ts, заход G
  // блок 2) — здесь дополнительный try/catch был бы мёртвым кодом на сценарий, который не
  // может случиться; null уже покрывает и «не найдено», и «БД недоступна».
  const historyId = history.getIdByUrl(url);
  if (historyId === null) return; // #shouldRecord отфильтровал (about:/поиск-result/…) — индексировать нечего

  // Идемпотентность (блок 4): ревизит уже проиндексированной страницы — no-op, не спамим
  // очередь embed() повторно на каждый повторный визит.
  if (indexedHistoryIds.has(historyId)) return;

  // Шумные для эмбеддинга страницы (логин/OAuth/голый домен/техническая заглушка, см.
  // HistoryNoiseFilter.ts) — в history остаются как есть, просто не индексируем вектором.
  // Здесь без записи заглушки в history_embeddings: indexVisit не работает через очередь
  // «дай непроиндексированное» (в отличие от HistoryBackfill.ts), так что вечного цикла нет —
  // достаточно молча пропускать на каждый визит, ничего не персистим.
  if (isNoisyForEmbedding(url, title)) {
    indexedHistoryIds.add(historyId); // не пересчитывать фильтр на каждый повторный визит
    return;
  }

  // Тот же формат сигнала, что и AI-группировка вкладок (ClusteringService.ts::buildCandidates) —
  // title + hostname, без пути/query. Используется как fallback, если обогащённый текст
  // недоступен (страница не догрузилась/Readability не справилась/вкладка уже закрыта).
  const fallbackText = `${title} ${hostnameOf(url)}`.trim();

  let enrichedText: string | null = null;
  try {
    enrichedText = await extractEnrichedText(wc, url);
  } catch (e) {
    console.warn(`[HistoryIndexer] извлечение контента не удалось для ${url}:`, (e as Error).message);
  }

  const text = (enrichedText ? enrichedText.trim().slice(0, HISTORY_EMBED_TEXT_MAX_CHARS) : '') || fallbackText;
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
  // изменится, успешный embed без записи не должен молча помечаться как проиндексированную.
  try {
    history.saveEmbedding(historyId, embedded.vector, embedded.dims, embedded.modelVersion);
    if (enrichedText) {
      const chunks = buildTextChunks(enrichedText);
      const chunkInputs = [];
      for (let i = 0; i < chunks.length; i++) {
        try {
          const chunkEmbedded = await requestEmbedding(chunks[i]!);
          chunkInputs.push({
            chunkIndex: i,
            url,
            title,
            text: chunks[i]!,
            vector: chunkEmbedded.vector,
            dims: chunkEmbedded.dims,
          });
        } catch (e) {
          console.warn(`[HistoryIndexer] embed чанка не удался для ${url}:`, (e as Error).message);
        }
      }
      history.saveContentChunks(historyId, chunkInputs, embedded.modelVersion);
    }
    indexedHistoryIds.add(historyId); // помечаем ТОЛЬКО после реально успешной записи
  } catch (e) {
    console.warn(`[HistoryIndexer] запись эмбеддинга не удалась для ${url}:`, (e as Error).message);
  }
}
