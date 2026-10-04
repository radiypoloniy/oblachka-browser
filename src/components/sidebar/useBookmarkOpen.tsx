import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { BookmarkNode } from '../../../shared/ipc';

interface OpenConfirmation {
  nodeId: number;
  title: string;
  tabIds: string[];
  serial: number;
}

export function useBookmarkOpen(onOpen: (url: string, background?: boolean) => Promise<string>) {
  const [opened, setOpened] = useState<OpenConfirmation | null>(null);
  const [openError, setOpenError] = useState(false);
  // Подтверждение приходит только после создания вкладки в main, а не по нажатию мыши.
  const openBookmark = async (node: BookmarkNode, background = false): Promise<void> => {
    try {
      const tabId = await onOpen(node.url, background);
      setOpenError(false);
      if (background) setOpened((prev) => ({
        nodeId: node.id, title: node.title || node.url,
        tabIds: prev?.tabIds.includes(tabId) ? prev.tabIds : [...(prev?.tabIds ?? []), tabId],
        serial: (prev?.serial ?? 0) + 1,
      }));
    } catch {
      setOpenError(true);
    }
  };
  useEffect(() => {
    if (!opened && !openError) return;
    const timer = setTimeout(() => { setOpened(null); setOpenError(false); }, 3000);
    return () => clearTimeout(timer);
  }, [opened, openError]);
  return { opened, openError, openBookmark };
}

export function BookmarkOpenFeedback({ opened, openError }: { opened: OpenConfirmation | null; openError: boolean }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" style={{
      padding: '4px 8px 8px', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
    }}>
      {openError ? 'Не удалось открыть вкладку. Попробуйте ещё раз.' : opened ? (
        <span key={opened.serial} className="oblako-bookmark-confirm" title={opened.title}>
          <Check size={13} /> Открыто в фоне: {opened.tabIds.length}
        </span>
      ) : 'СКМ по закладке — открыть в фоне'}
    </div>
  );
}
