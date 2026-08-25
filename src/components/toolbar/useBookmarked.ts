import { useEffect, useRef, useState } from 'react';

/**
 * Звезда «страница в закладках» для активной вкладки.
 *
 * Возвращает пару: сам признак и способ поставить его оптимистично — клик по звезде сохраняет
 * закладку сразу, а `BOOKMARK_CHANGED` затем подтверждает или поправляет.
 *
 * ⚠️ Счётчик запросов (seq) — не перестраховка, а защита от гонки: быстрое переключение вкладок
 * не должно позволить УСТАРЕВШЕМУ ответу `isBookmarked(старый url)` перезаписать состояние уже
 * другой, текущей вкладки. Тот же приём, что у searchSeqRef в History.tsx.
 *
 * ⚠️ Подписка на изменения закладок нужна отдельно от проверки по url: закладку могли удалить в
 * панели, пока эта же страница открыта здесь, — звезда обязана погаснуть без перезагрузки.
 */
export function useBookmarked(url: string | undefined): [boolean, (v: boolean) => void] {
  const [bookmarked, setBookmarked] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    if (!url) { setBookmarked(false); return; }
    void window.oblako.isBookmarked(url).then((v) => {
      if (seq === seqRef.current) setBookmarked(v);
    });
  }, [url]);

  useEffect(() => {
    return window.oblako.onBookmarksChanged(() => {
      if (!url) return;
      const seq = ++seqRef.current;
      void window.oblako.isBookmarked(url).then((v) => {
        if (seq === seqRef.current) setBookmarked(v);
      });
    });
  }, [url]);

  return [bookmarked, setBookmarked];
}
