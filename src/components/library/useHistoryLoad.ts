import { useCallback, useEffect, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import { LatestHistoryQuery } from './LatestHistoryQuery';

export function useHistoryQuery(sequence: MutableRefObject<number>) {
  const queue = useMemo(() => new LatestHistoryQuery(query => query.trim()
    ? window.oblako.searchHistory(query)
    : window.oblako.getHistory()), []);
  return useCallback((query: string, generation: number) =>
    queue.run(query, () => sequence.current === generation), [queue, sequence]);
}

export function useHistoryLoad(load: () => Promise<void>, sequence: MutableRefObject<number>): void {
  useEffect(() => {
    void load();
    // Это счётчик запросов, не DOM-ref: инвалидируем последнее поколение при размонтировании,
    // чтобы ответ прежней вкладки/профиля не записал чужие данные в кэш.
    return () => { sequence.current += 1; };
  }, [load, sequence]);
}
