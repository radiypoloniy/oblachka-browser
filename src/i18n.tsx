import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UiLanguage } from '../shared/uiLanguage';
import { isUiLanguage } from '../shared/uiLanguage';
import { fill, translate } from '../shared/uiStrings';

export { translate } from '../shared/uiStrings';

/** Переводит строку каталога; узел или пустое оставляет как есть. */
export function tx(t: (source: string) => string, source: ReactNode | undefined): ReactNode | undefined {
  return typeof source === 'string' ? t(source) : source;
}

const CACHE_KEY = 'oblako-ui-language';

interface LanguageContextValue {
  language: UiLanguage;
  t(source: string, vars?: Record<string, string | number>): string;
  setLanguage(language: UiLanguage): Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function makeT(language: UiLanguage) {
  return (source: string, vars?: Record<string, string | number>): string => {
    const out = translate(language, source);
    return vars ? fill(out, vars) : out;
  };
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Кэш — чтобы хром не ждал IPC до первого кадра. Без него после i18n окно всходило
  // на один раунд позже: main уже готов, а renderer ещё null. Источник истины всё равно
  // settings.json; расхождение на кадр правится ответом getUiLanguage.
  const [language, setLanguageState] = useState<UiLanguage | null>(cachedLanguageSafe);

  useEffect(() => {
    let live = true;
    void window.oblako.getUiLanguage().then((value) => {
      if (live) {
        try { localStorage.setItem(CACHE_KEY, value); } catch { /* storage может быть выключен */ }
        setLanguageState(value);
      }
    }).catch(() => {
      if (live) setLanguageState('ru');
    });
    const unsubscribe = window.oblako.onUiLanguageChanged((value) => {
      if (live) {
        try { localStorage.setItem(CACHE_KEY, value); } catch { /* storage может быть выключен */ }
        setLanguageState(value);
      }
    });
    return () => { live = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!language) return;
    document.documentElement.lang = language;
    // Отдельные chrome-вью имеют собственный preload и не видят window.oblako. Это только
    // зеркало для них; источник истины остаётся settings.json в main.
    try { localStorage.setItem(CACHE_KEY, language); } catch { /* storage может быть выключен */ }
  }, [language]);

  const value = useMemo<LanguageContextValue | null>(() => language ? {
    language,
    t: makeT(language),
    setLanguage: (next) => window.oblako.setUiLanguage(next),
  } : null, [language]);

  // До ответа main окно всё равно скрыто. Не показываем на мгновение неверный язык.
  return value ? <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider> : null;
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('LanguageProvider отсутствует');
  return value;
}

function cachedLanguageSafe(): UiLanguage | null {
  try {
    const value = localStorage.getItem(CACHE_KEY);
    if (isUiLanguage(value)) return value;
  } catch { /* storage может быть выключен */ }
  return null;
}

declare global {
  interface Window {
    uiLanguage?: {
      get(): Promise<UiLanguage>;
      onChanged(cb: (language: UiLanguage) => void): () => void;
    };
  }
}

/** Для изолированных chrome-вью: язык приходит из зеркала, без доступа к боевому preload. */
export function StandaloneLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<UiLanguage>(cachedLanguageSafe() ?? 'en');
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    const api = window.uiLanguage;
    if (!api) return;
    let live = true;
    void api.get().then((value) => { if (live) setLanguage(value); });
    const unsub = api.onChanged((value) => { if (live) setLanguage(value); });
    return () => { live = false; unsub(); };
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CACHE_KEY && isUiLanguage(event.newValue)) setLanguage(event.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const value = useMemo<LanguageContextValue>(() => ({
    language,
    t: makeT(language),
    setLanguage: async () => { throw new Error('Менять язык можно только из настроек браузера'); },
  }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
