// Снимок текста вкладки перед выгрузкой. Живёт отдельно от TabManager, чтобы не раздувать
// файл сверх храповика structure-check: ожидание индексации — не логика вкладок.
import type { WebContents } from 'electron';
import { SLEEP_INDEX_BUDGET_MS } from '../shared/historyIndex';

export async function prepareSleepUnload(
  onBeforeSleep: ((url: string, title: string, wc: WebContents) => Promise<boolean>) | undefined,
  wc: WebContents,
): Promise<boolean> {
  if (!onBeforeSleep || wc.isDestroyed()) return true;
  try {
    return await Promise.race([
      onBeforeSleep(wc.getURL(), wc.getTitle() || wc.getURL(), wc),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), SLEEP_INDEX_BUDGET_MS)),
    ]);
  } catch (e) {
    console.warn('[tabs] снимок перед усыплением не удался:', (e as Error).message);
    return true;
  }
}
