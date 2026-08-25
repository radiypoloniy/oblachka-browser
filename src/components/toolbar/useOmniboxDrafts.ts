import { useCallback, useEffect, useRef, useState } from 'react';
import type { TabState } from '../../../shared/ipc';

/**
 * Что показано в адресной строке — и черновики по вкладкам.
 *
 * ⚠️ ЧЕРНОВИК ПЕРЕЖИВАЕТ ПОТЕРЮ ФОКУСА И ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК, как в популярных браузерах:
 * отвлечься на соседнюю вкладку не должно стирать набранное. Поэтому он живёт по id вкладки, а
 * стирается только явными действиями — отправкой и Escape, — а не любым blur (клик мимо, фокус на
 * содержимое, переключение поповера этот словарь не трогают вовсе).
 *
 * ⚠️ ХАБ ОТКРЫВАЕТСЯ ЧИСТЫМ. Он не страница, а экран «новая вкладка», и приходят на него, чтобы
 * начать заново. Живая жалоба была ровно об этом: набрал текст, перешёл по нему, открыл новую
 * вкладку — а текст всё ещё в строке. Причина живучая: хаб один на окно (HUB_ID), его черновик
 * переживает и переход, и создание вкладки, и всплывает при следующем возврате.
 *
 * ⚠️ Эффект ЕДИНЫЙ на (id, url), а не два отдельных, и это чинило живой баг. Переход из хаба
 * создаёт НОВУЮ вкладку, и в первый момент у неё url === '' — тот же пустой, что у хаба. Раз
 * значение строки не изменилось, эффект «реальная навигация» на [url] не срабатывал, и признак
 * последней вкладки оставался указывать на хаб; пришедший чуть позже настоящий url считался
 * «другой вкладкой», и адрес оставался пустым навсегда — до принудительного переключения туда-сюда.
 */
export function useOmniboxDrafts(tab: TabState | undefined, editing: boolean): {
  value: string;
  /** Прямая правка поля — без записи черновика (используется отправкой и откатом). */
  setValue: (v: string) => void;
  /** Человек напечатал или бросил текст: показать и запомнить как черновик этой вкладки. */
  setDraft: (v: string) => void;
  /** Черновик отработан (отправка) — хранить нечего. */
  clearDraft: () => void;
  /** Escape: явная отмена правки — вернуть адрес вкладки, на хабе очистить. */
  resetToTab: () => void;
} {
  const [value, setValue] = useState('');
  const draftsRef = useRef<Map<string, string>>(new Map());
  // Последняя (id, url) активной вкладки — отличает «эта же вкладка куда-то перешла» (черновик
  // неактуален) от «просто переключились на другую» (её черновик жив и должен вернуться).
  const lastNavRef = useRef<{ id: string; url: string } | undefined>(undefined);

  useEffect(() => {
    if (!tab) return;
    const switchedTab = lastNavRef.current?.id !== tab.id;
    lastNavRef.current = { id: tab.id, url: tab.url };

    if (switchedTab) {
      if (tab.isHub) { draftsRef.current.delete(tab.id); setValue(''); return; }
      // Черновик этой вкладки, если печатали в ней раньше и не отправили; иначе её текущий url
      // (может быть ещё пустым у только начавшей грузиться — следующий приход url это поправит).
      const draft = draftsRef.current.get(tab.id);
      setValue(draft !== undefined ? draft : tab.url);
      return;
    }

    // Та же вкладка, url изменился — черновик неактуален. ⚠️ Кроме случая, когда человек прямо
    // сейчас печатает: фоновая навигация не должна вырывать значение из-под рук.
    if (editing) return;
    draftsRef.current.delete(tab.id);
    setValue(tab.url);
    // editing намеренно НЕ в зависимостях: он читается в момент навигации, а не запускает пересчёт.

  }, [tab?.id, tab?.url]);

  const setDraft = useCallback((v: string) => {
    setValue(v);
    if (tab) draftsRef.current.set(tab.id, v);
  }, [tab?.id]);

  const clearDraft = useCallback(() => {
    if (tab) draftsRef.current.delete(tab.id);
  }, [tab?.id]);

  const resetToTab = useCallback(() => {
    if (tab) draftsRef.current.delete(tab.id);
    setValue(tab?.isHub ? '' : (tab?.url ?? ''));
  }, [tab?.id, tab?.url, tab?.isHub]);

  return { value, setValue, setDraft, clearDraft, resetToTab };
}
