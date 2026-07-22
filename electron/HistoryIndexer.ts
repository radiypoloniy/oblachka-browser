// Индексация истории — извлечение и сохранение ТЕКСТА страницы (заход G, блок 3+4; эмбеддинги
// убраны из этого пути отдельным коммитом — вектор здесь больше не считается и не пишется, см.
// git log). Вызывается из main.ts после recordVisit — recordVisit/updateTitle в HistoryManager.ts
// не меняются, это отдельная обёртка над call site. Каждый уровень (id → извлечение → запись)
// изолирован: сбой здесь не должен всплыть как сбой навигации/записи истории для пользователя —
// тихий лог, запись остаётся неиндексированной до следующей попытки (или до бэкфилла, блок 5).
// Успешная индексация НЕ логируется намеренно — иначе обычный браузинг захламляет stdout логом
// на каждый визит.
//
// Текст — Readability-контент страницы, когда удалось его дождаться и извлечь; если нет —
// индексировать нечего (раньше был fallback title+hostname, но он кормил только whole-page
// эмбеддинг, которого больше нет — просто пропускаем визит, следующий попробует снова). Реюз
// extractPageText из AiPanelManager.ts — тот же пайплайн, что у AI-панели, не дублируем его.
import type { WebContents } from 'electron';
import type { HistoryManager } from './HistoryManager';
import { extractPageText } from './AiPanelManager';
import { isNoisyForEmbedding } from './HistoryNoiseFilter';
import { TEXT_EXTRACTION_VERSION } from './HistoryManager';

// Живой замер (диагностика "переиндексация при рестарте"): 750-850% CPU на 40с при рестарте
// с 10 закреплёнными вкладками — каждая переиндексировалась заново при том, что содержимое не
// менялось. Причина была здесь: раньше этот Set был ЕДИНСТВЕННЫМ источником факта «уже
// проиндексирована» — не персистентно между перезапусками, поэтому каждый рестарт считал всё
// заново непроиндексированным. Источник истины теперь HistoryManager.hasContentForVersion()
// (БД, переживает рестарт) — см. indexVisit ниже. Set остаётся как дешёвый кэш ПОВЕРХ БД-проверки:
// экономит один SQL-запрос на повторные навигации в рамках уже открытого процесса (recordVisit —
// upsert, стреляет на любой повторный визит, не только на первый), но НЕ является источником
// истины сам по себе — на старте процесса он пуст, и это нормально, БД-проверка ниже подхватывает.
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

const HISTORY_CHUNK_SOURCE_MAX_CHARS = 12_000;
const HISTORY_CHUNK_TARGET_CHARS = 1400;
const HISTORY_CHUNK_OVERLAP_CHARS = 220;
const HISTORY_CHUNK_MAX = 8;

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

  // Идемпотентность (блок 4): ревизит уже проиндексированной страницы — no-op. Сначала дешёвый
  // in-memory кэш (без похода в БД для уже проверенных в этом процессе historyId), потом источник
  // истины — БД на TEXT_EXTRACTION_VERSION. Раньше здесь был IPC-round-trip до renderer за версией
  // эмбеддинг-модели (requestEmbeddingModelVersion(), с fail-closed гонкой на закреплённых вкладках,
  // см. git log) — TEXT_EXTRACTION_VERSION синхронная константа, никакого моста не нужно.
  if (indexedHistoryIds.has(historyId)) return;
  const already = history.hasContentForVersion(historyId, TEXT_EXTRACTION_VERSION);
  if (already) {
    indexedHistoryIds.add(historyId); // закэшировать — не спрашивать БД повторно в этом процессе
    return;
  }

  // Шумные страницы (логин/OAuth/голый домен/техническая заглушка, см. HistoryNoiseFilter.ts) —
  // в history остаются как есть, просто не извлекаем текст. Без записи заглушки в
  // history_content_chunks: indexVisit не работает через очередь «дай непроиндексированное»
  // (в отличие от HistoryContentBackfill.ts), вечного цикла нет — достаточно молча пропускать
  // на каждый визит, ничего не персистим.
  if (isNoisyForEmbedding(url, title)) {
    indexedHistoryIds.add(historyId); // не пересчитывать фильтр на каждый повторный визит
    return;
  }

  let enrichedText: string | null = null;
  try {
    enrichedText = await extractEnrichedText(wc, url);
  } catch (e) {
    console.warn(`[HistoryIndexer] извлечение контента не удалось для ${url}:`, (e as Error).message);
  }
  // Раньше здесь был fallback на title+hostname — кормил только whole-page эмбеддинг, которого
  // больше нет. Без реального текста индексировать нечего: не помечаем как проиндексированную,
  // следующий визит попробует извлечь снова.
  if (!enrichedText) return;

  const chunks = buildTextChunks(enrichedText);
  // Векторные колонки history_content_chunks (vector/dims) — NOT NULL, но мёртвые: эмбеддинги
  // убраны из пути индексации на этом этапе (см. git log), схему не мигрируем (нет механизма,
  // риск дороже пустых колонок) — пишем пустышку, а не считаем настоящий вектор.
  const chunkInputs = chunks.map((chunkText, i) => ({
    chunkIndex: i,
    url,
    title,
    text: chunkText,
    vector: new Float32Array(0),
    dims: 0,
  }));
  history.saveContentChunks(historyId, chunkInputs, TEXT_EXTRACTION_VERSION);
  indexedHistoryIds.add(historyId); // помечаем ТОЛЬКО после реально успешной записи
}
