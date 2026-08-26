import { useEffect, useState } from 'react';
import type { PageTranslateState, PageTranslateProgress } from '../../shared/ipc';

// Полностраничный перевод: состояние кнопки в тулбаре и живой прогресс батчей.
// Обе половины приходят из PageTranslateManager.ts и всегда читаются вместе.
export function usePageTranslate() {
  const [pageTranslateState, setPageTranslateState] = useState<PageTranslateState>('idle');
  const [pageTranslateProgress, setPageTranslateProgress] = useState<PageTranslateProgress | null>(null);

  // Состояние полностраничного перевода для кнопки в тулбаре (см. PageTranslateManager.ts).
  useEffect(() => {
    void window.oblako.getPageTranslateState().then(setPageTranslateState);
    const unsub = window.oblako.onPageTranslateStateChanged(setPageTranslateState);
    return () => unsub();
  }, []);

  // Прогресс перевода страницы (батч N/M + живой счётчик символов) — только push, без get: живёт
  // секунды, гонка старта окна ей не грозит (см. PageTranslateProgress в shared/ipc.ts).
  useEffect(() => {
    const unsub = window.oblako.onPageTranslateProgressChanged(setPageTranslateProgress);
    return () => unsub();
  }, []);

  return { pageTranslateState, pageTranslateProgress };
}
