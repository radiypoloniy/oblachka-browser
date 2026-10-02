import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { HistorySearchFilters, HistorySearchProgress } from '../../../shared/ipc';

export function useHistorySearchTask(query: string, filters: HistorySearchFilters, sequence: MutableRefObject<number>) {
  const request = useRef<string>();
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<HistorySearchProgress['stage']>('retrieving');
  const cancel = useCallback(() => {
    if (request.current) window.oblako.cancelHistorySearch(request.current);
    request.current = undefined; setLoading(false);
  }, []);
  useEffect(() => { cancel(); return cancel; }, [query, filters, cancel]);
  useEffect(() => window.oblako.onProfilesChanged(() => { sequence.current++; cancel(); }), [cancel, sequence]);
  useEffect(() => window.oblako.onHistorySearchProgress(progress => {
    if (progress.requestId === request.current) setStage(progress.stage);
  }), []);
  function start(): string {
    const id = crypto.randomUUID(); request.current = id; setLoading(true); setStage('retrieving'); return id;
  }
  function finish(id: string) {
    if (request.current === id) { request.current = undefined; setLoading(false); }
  }
  return { loading, stage, start, finish };
}
