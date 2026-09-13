// Тихий добор текста недавних визитов, пока компьютер простаивает.
//
// ⚠️ Это НЕ полная индексация истории. Полный прогон открывает ВСЕ url без чанка (импорт
// из Chrome, капча, разлогин) и бывает только по кнопке. Здесь — последние несколько
// СВОИХ визитов за 36 часов: last_visit свежий, импорт 2019 года не проходит по давности.
// ⚠️ Стоп, как только человек вернулся: каждый шаг смотрит powerMonitor.getSystemIdleTime.
// ⚠️ Сеть всё равно идёт — поэтому бюджет крошечный (8 страниц) и пауза между ними.
import { powerMonitor } from 'electron';
import type { BrowserWindow } from 'electron';
import type { HistoryManager } from './HistoryManager';
import { isContentBackfillRunning, indexHiddenHistoryRow } from './HistoryContentBackfill';
import {
  isNoisyForEmbedding,
  pickIdleCatchupPages,
  shouldRunIdleCatchup,
  IDLE_CATCHUP_START_DELAY_MS,
  IDLE_CATCHUP_TICK_MS,
  IDLE_CATCHUP_IDLE_SECONDS,
} from '../shared/historyIndex';

let timer: ReturnType<typeof setTimeout> | null = null;
let catchupRunning = false;
const PAUSE_BETWEEN_PAGES_MS = 1500;

export function startHistoryIdleCatchup(opts: {
  history: () => HistoryManager;
  getWin: () => BrowserWindow | null;
}): void {
  if (timer) return;
  // Изолированные AI-стенды не должны ходить в сеть за чужой историей профиля стенда.
  if (process.env.OBLAKO_LLAMA_TEST === '1' || process.env.OBLAKO_TRANSLATE_TEST === '1'
    || process.env.OBLAKO_GPU_TEST === '1') return;
  const tick = (): void => {
    void runCatchup(opts).finally(() => {
      timer = setTimeout(tick, IDLE_CATCHUP_TICK_MS);
    });
  };
  timer = setTimeout(tick, IDLE_CATCHUP_START_DELAY_MS);
}

function systemIdleSeconds(): number {
  try { return powerMonitor.getSystemIdleTime(); } catch { return 0; }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCatchup(opts: {
  history: () => HistoryManager;
  getWin: () => BrowserWindow | null;
}): Promise<void> {
  if (!shouldRunIdleCatchup({
    backfillRunning: isContentBackfillRunning(),
    catchupRunning,
    idleSeconds: systemIdleSeconds(),
  })) return;

  const win = opts.getWin();
  if (!win || win.isDestroyed()) return;

  const history = opts.history();
  const now = Date.now();
  const pages = pickIdleCatchupPages(
    history.getHistoryWithoutContent().map((row) => ({
      ...row,
      noisy: isNoisyForEmbedding(row.url, row.title),
    })),
    now,
  );
  if (pages.length === 0) return;

  catchupRunning = true;
  try {
    for (const row of pages) {
      if (isContentBackfillRunning()) break;
      if (systemIdleSeconds() < IDLE_CATCHUP_IDLE_SECONDS) break;
      if (win.isDestroyed()) break;
      await indexHiddenHistoryRow(history, win, row);
      await wait(PAUSE_BETWEEN_PAGES_MS);
    }
  } finally {
    catchupRunning = false;
  }
}
