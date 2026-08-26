import { useEffect, useRef } from 'react';

/**
 * Push-события от main, которым нужен сам чром: фокус в адресную строку и открытие псевдо-вкладок
 * с клавиатуры или из меню окна.
 *
 * FindBar сюда больше не входит — он переехал в отдельную WebContentsView
 * (см. electron/FindBarManager.ts): main сам решает, когда её показать, спрятать и куда слать
 * счётчик совпадений.
 *
 * Возвращает ссылку на поле адресной строки — её же держит Toolbar.
 */
export function useChromeShortcuts(openSpecial: (k: 'history' | 'settings' | 'downloads') => Promise<void>) {
  const omniboxRef = useRef<HTMLInputElement>(null);

  // ⚠️ Подписки заводятся ОДИН раз на маунт, поэтому openSpecial читается через реф: сам колбэк
  // стабилен, но зависеть от него значило бы пересобирать три подписки на каждое его изменение.
  const openSpecialRef = useRef(openSpecial);
  openSpecialRef.current = openSpecial;

  useEffect(() => {
    const unsubOmnibox = window.oblako.onOmniboxFocus(() => {
      omniboxRef.current?.focus();
      omniboxRef.current?.select();
    });

    // Ctrl+H — та же псевдо-вкладка, что и иконка в сайдбаре: всегда создаёт новую (простая,
    // предсказуемая семантика, как у обычного createTab — без «переключиться на уже открытую».
    const unsubHistory = window.oblako.onHistoryOpen(() => {
      void openSpecialRef.current('history');
    });

    const unsubDownloadsOpen = window.oblako.onDownloadsOpen(() => {
      void openSpecialRef.current('downloads');
    });

    return () => {
      unsubOmnibox();
      unsubHistory(); unsubDownloadsOpen();
    };
  }, []);

  return omniboxRef;
}
