// Разовый бэкфилл уже накопленной истории эмбеддингами (заход G, блок 5). Запускается ТОЛЬКО
// по явному действию пользователя (см. Settings.tsx::HistoryBackfillSection) — никогда
// автоматически на старте приложения. Работает как обычный клиент общей очереди
// embeddingService.embed() — тем же каналом embed:request/response и тем же per-текст вызовом,
// что и HistoryIndexer.ts (одна фраза → requestEmbedding() → один вектор), не батчит несколько
// текстов в один embed()-вызов и не трогает саму очередь/её сериализацию — чтобы не быть
// привилегированным потребителем, который может обойти уже проверенную гонку.
import type { HistoryManager } from './HistoryManager';
import type { BackfillProgress } from '../shared/ipc';
import { requestEmbedding, requestEmbeddingModelVersion, isAvailable as isEmbedClientAvailable } from './EmbedClient';
import { isNoisyForEmbedding } from './HistoryNoiseFilter';

// Маркер «намеренно не индексируем» для шумных строк (логин/OAuth/голый домен/заглушка,
// см. HistoryNoiseFilter.ts). Пустой вектор (dims=0) — не настоящий эмбеддинг, HistorySearch.ts
// отфильтровывает такие строки перед скорингом. Без этой отметки getUnindexedHistory() возвращал
// бы одни и те же шумные строки на каждой итерации цикла ниже (они никогда не попадут в
// history_embeddings обычным путём) — цикл не дошёл бы до `chunk.length === 0` и завис бы навсегда.
const EXCLUDED_MODEL_VERSION = 'excluded';

// Размер чанка — тот же порядок, что уже проверенный боевой батч кластеризации (18 текстов).
const CHUNK_SIZE = 18;
// Пауза — ПОСЛЕ того, как все embed-вызовы текущего чанка отработали последовательно (значит,
// на этот момент очередь точно не занята бэкфиллом), а не параллельно им — иначе пауза не
// давала бы реального окна другому потребителю (кластеризации). Стартовое значение для
// эмпирической подстройки на живом тесте (см. бриф блока 5) — не точная константа навсегда.
const PAUSE_BETWEEN_CHUNKS_MS = 500;

let running = false;
let cancelRequested = false;
let onProgress: ((p: BackfillProgress) => void) | null = null;

export function isBackfillRunning(): boolean {
  return running;
}

// main.ts подписывается один раз при старте — тот же приём, что onPick у SuggestDropdownManager.ts.
export function setBackfillProgressListener(cb: ((p: BackfillProgress) => void) | null): void {
  onProgress = cb;
}

// Прерывает цикл МЕЖДУ чанками (или между отдельными визитами внутри чанка) — не обрывает уже
// запущенный вызов requestEmbedding() на середине, просто не даёт стартовать следующему шагу.
export function cancelBackfill(): void {
  cancelRequested = true;
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startBackfill(history: HistoryManager): Promise<void> {
  if (running) return; // защита от повторного запуска — простой флаг, ничего сложнее не нужно
  running = true;
  cancelRequested = false;

  // Считается один раз на старте — обычный браузинг не останавливается на время бэкфилла,
  // новые визиты параллельно уменьшают реальный остаток; индикатор прогресса не претендует
  // на абсолютную точность в моменте, только на общее ощущение хода процесса.
  let activeModelVersion: string | null = null;
  try {
    activeModelVersion = await requestEmbeddingModelVersion();
  } catch (e) {
    console.warn('[HistoryBackfill] версия embedding-модели недоступна:', (e as Error).message);
  }

  const total = history.countUnindexed(activeModelVersion ?? undefined);
  let processed = 0;
  const report = (extra: Partial<BackfillProgress> = {}) =>
    onProgress?.({ processed, total, running: true, cancelled: false, ...extra });
  report();

  try {
    for (;;) {
      if (cancelRequested) break;
      if (!isEmbedClientAvailable()) {
        console.warn('[HistoryBackfill] chromeView недоступен — останавливаюсь');
        break;
      }

      const chunk = history.getUnindexedHistory(CHUNK_SIZE, activeModelVersion ?? undefined);
      if (chunk.length === 0) break; // всё сделано (или ничего никогда не было)

      for (const row of chunk) {
        if (cancelRequested || !isEmbedClientAvailable()) break;

        // Шумные для эмбеддинга строки (логин/OAuth/голый домен/заглушка) — не считаем вектор,
        // но помечаем как обработанные пустым вектором, иначе они вечно будут возвращаться
        // из getUnindexedHistory() и цикл не завершится (см. комментарий у EXCLUDED_MODEL_VERSION).
        if (isNoisyForEmbedding(row.url, row.title)) {
          try {
            history.saveEmbedding(row.id, new Float32Array(0), 0, EXCLUDED_MODEL_VERSION);
          } catch (e) {
            console.warn(`[HistoryBackfill] пометка «исключено» не удалась для ${row.url}:`, (e as Error).message);
          }
          processed++;
          report();
          continue;
        }

        // Тот же формат сигнала, что и AI-группировка вкладок / HistoryIndexer.ts —
        // title + hostname, без пути/query.
        const text = `${row.title} ${hostnameOf(row.url)}`.trim();
        if (text) {
          try {
            const embedded = await requestEmbedding(text, 'document');
            try {
              history.saveEmbedding(row.id, embedded.vector, embedded.dims, embedded.modelVersion);
            } catch (e) {
              console.warn(`[HistoryBackfill] запись эмбеддинга не удалась для ${row.url}:`, (e as Error).message);
            }
          } catch (e) {
            // Строка остаётся неиндексированной — не теряется, просто попадёт в выборку
            // getUnindexedHistory() на следующем запуске бэкфилла (см. блок 5, п.4 брифа).
            console.warn(`[HistoryBackfill] embed не удался для ${row.url}:`, (e as Error).message);
          }
        }

        processed++;
        report();
      }

      if (cancelRequested || !isEmbedClientAvailable()) break;
      await wait(PAUSE_BETWEEN_CHUNKS_MS);
    }
  } finally {
    running = false;
    onProgress?.({ processed, total, running: false, cancelled: cancelRequested });
  }
}
