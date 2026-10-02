import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { HistoryCursor, HistoryPage, HistoryPageRequest } from '../../../shared/ipc';
import { LatestHistoryQuery } from './LatestHistoryQuery';

export function useHistoryPages(query: string, sequence: MutableRefObject<number>,
  accept: (page: HistoryPage, first: boolean) => void, filters?: import('../../../shared/ipc').HistorySearchFilters) {
  const queue = useMemo(() => new LatestHistoryQuery<HistoryPage, HistoryPageRequest>(
    request => window.oblako.getHistoryPage(request)), []);
  // Храним только границы страниц. Сами записи предыдущих страниц не копятся в памяти.
  const cursors = useRef<(HistoryCursor | undefined)[]>([undefined]);
  const [index, setIndex] = useState(0), [next, setNext] = useState<HistoryCursor>();
  const [loading, setLoading] = useState(false), [error, setError] = useState(false);
  const read = useCallback(async (position: number, before?: HistoryCursor) => {
    const generation = ++sequence.current;
    setLoading(true); setError(false);
    try {
      const page = await queue.run({ query, before, filters }, () => sequence.current === generation);
      if (!page) return;
      accept(page, position === 0); setIndex(position); setNext(page.next);
      // При возврате записи могли измениться: следующие переходы строим по свежей границе.
      cursors.current = cursors.current.slice(0, position + 1);
      cursors.current[position] = before;
    } catch {
      if (sequence.current === generation) setError(true);
    } finally {
      if (sequence.current === generation) setLoading(false);
    }
  }, [query, sequence, queue, accept, filters]);
  const load = useCallback(() => {
    cursors.current = [undefined]; setIndex(0); setNext(undefined);
    return read(0);
  }, [read]);
  useEffect(() => {
    void load();
    return () => { sequence.current += 1; };
  }, [load, sequence]);
  return { load, index, loading, error,
    previous: index > 0 ? () => void read(index - 1, cursors.current[index - 1]) : undefined,
    following: next ? () => void read(index + 1, next) : undefined,
  };
}
