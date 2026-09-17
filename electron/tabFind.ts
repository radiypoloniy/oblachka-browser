import type { WebContents } from 'electron';

// Обход документа занимает миллисекунды; таймаут защищает от навигации во время поиска.
const FIND_QUOTE_TIMEOUT_MS = 1000;

export function startPageFind(wc: WebContents, query: string, previousQuery: string, forward: boolean): void {
  const startsNew = query !== previousQuery;
  wc.findInPage(query, { forward, findNext: !startsNew });
  // ⚠️ Electron 40 не шлёт found-in-page на одиночный findNext:false. Второй вызов с тем же
  // запросом возвращает счётчик, оставляя первое совпадение активным.
  if (startsNew) wc.findInPage(query, { forward, findNext: true });
}

/** Первый найденный вариант цитаты и число совпадений; пустая строка означает отсутствие. */
export async function findQuoteInWebContents(
  wc: WebContents,
  candidates: string[],
): Promise<{ matches: number; query: string }> {
  for (const query of candidates) {
    const matches = await findOnce(wc, query);
    // По этому логу отличаем неподходящую цитату модели от сбоя поиска Chromium.
    console.log(`[smart-find] подсветка ${query.length} симв. «${query.slice(0, 40)}…» → ${matches}`);
    if (matches > 0) return { matches, query };
  }
  // Без совпадений старая подсветка не должна оставаться на странице.
  try { wc.stopFindInPage('clearSelection'); } catch { /* вкладка могла закрыться */ }
  return { matches: 0, query: '' };
}

// Ждём финальное событие именно второго запроса: первый в Electron 40 не отвечает.
function findOnce(wc: WebContents, query: string): Promise<number> {
  return new Promise((resolve) => {
    let requestId = 0;
    let done = false;
    const finish = (matches: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      wc.removeListener('found-in-page', onFound);
      resolve(matches);
    };
    const onFound = (_e: unknown, result: Electron.Result) => {
      if (result.requestId !== requestId || !result.finalUpdate) return;
      finish(result.matches);
    };
    const timer = setTimeout(() => {
      // Для диагностики таймаут отличаем от честных нуля совпадений.
      console.warn(`[smart-find] found-in-page не пришёл за ${FIND_QUOTE_TIMEOUT_MS} мс`);
      finish(0);
    }, FIND_QUOTE_TIMEOUT_MS);
    wc.on('found-in-page', onFound);
    try {
      wc.findInPage(query, { forward: true, findNext: false });
      requestId = wc.findInPage(query, { forward: true, findNext: true });
    } catch {
      finish(0);
    }
  });
}
