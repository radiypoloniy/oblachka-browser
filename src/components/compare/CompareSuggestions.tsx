import { useEffect, useRef } from 'react';
import { useCompare } from './useCompare';
import { sp } from '../../styles/system';

/** Предложение — событие, а не ещё один постоянный орган управления в хроме. */
export function CompareSuggestions() {
  const state = useCompare(), seen = useRef(new Set<string>());
  const signature = state?.candidates.map(p => `${p.tabId}:${p.url}`).sort().join('|') ?? '';
  const available = !!state?.enabled && (state?.candidates.length ?? 0) >= 2;
  useEffect(() => {
    if (!available || !signature || seen.current.has(signature)) return;
    const timer = setTimeout(() => {
      if (document.activeElement?.matches('input,textarea,[contenteditable="true"]')) return;
      seen.current.add(signature);
      if (seen.current.size > 40) seen.current.delete(seen.current.values().next().value!);
      void window.oblako.showTabCompareOffer({ x: innerWidth - sp(6), y: sp(8) * 2, width: 1, height: 1, automatic: true }).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [available, signature]);
  return null;
}
