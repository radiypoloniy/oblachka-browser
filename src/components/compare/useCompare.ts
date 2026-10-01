import { useEffect, useState } from 'react';
import type { CompareApi, CompareState } from '../../../shared/tabCompare';

export function useCompare(api: CompareApi = window.oblako) {
  const [state, setState] = useState<CompareState | null>(null);
  useEffect(() => {
    let alive = true, received = false;
    const off = api.onTabCompareState(value => { received = true; setState(value); });
    void api.tabCompareState().then(value => { if (alive && !received) setState(value); }).catch(() => {});
    return () => { alive = false; off(); };
  }, [api]);
  return state;
}
