import { useCallback, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { SuggestDropdownItem } from '../../../shared/ipc';

// Стрелки показывают вариант временно: исходный черновик меняется только при следующем вводе.
export function useOmniboxPreview(tabId: string | undefined, value: string,
  setValue: (value: string) => void, inputRef: RefObject<HTMLInputElement>) {
  const original = useRef<{ tabId: string | undefined; value: string } | null>(null);
  const currentTab = useRef(tabId);
  currentTab.current = tabId;
  const restore = useCallback(() => {
    if (original.current?.tabId === currentTab.current && original.current) setValue(original.current.value);
    original.current = null;
  }, [setValue]);
  const preview = (item: SuggestDropdownItem) => {
    if (!original.current || original.current.tabId !== tabId) original.current = { tabId, value };
    setValue(item.fillIntoEdit ?? (item.kind === 'search' ? original.current.value
      : item.kind === 'suggest' ? item.label : item.url));
  };
  useLayoutEffect(() => {
    if (!original.current || original.current.tabId !== tabId) return;
    inputRef.current?.setSelectionRange(value.length, value.length);
  }, [value, tabId, inputRef]);
  const accept = () => { original.current = null; };
  return { preview, restore, accept };
}
