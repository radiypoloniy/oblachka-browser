// Единый источник истины по поисковикам — id, имя для UI/лейблов, шаблон URL.
// Импортируется и main (TabManager: omnibox-навигация, ПКМ-поиск), и renderer
// (Toolbar: дропдаун-подсказка «Искать: …») — один шаблон URL на движок, не дублируется.

export type SearchEngineId = 'duckduckgo' | 'google' | 'yandex';

export interface SearchEngineDef {
  id: SearchEngineId;
  name: string; // человекочитаемое имя — для лейблов ПКМ/капсулы
  buildUrl: (query: string) => string;
  // Result-страница ИМЕННО этого движка (не его домен/главная — та валидная история).
  // Используется isSearchResultUrl() ниже — фильтр записи в историю (HistoryManager.ts).
  isResultUrl: (u: URL) => boolean;
}

export const SEARCH_ENGINES: readonly SearchEngineDef[] = [
  {
    id: 'duckduckgo', name: 'DuckDuckGo',
    buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    isResultUrl: (u) => u.hostname.replace(/^www\./, '') === 'duckduckgo.com' && u.searchParams.has('q'),
  },
  {
    id: 'google', name: 'Google',
    buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    isResultUrl: (u) => /(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname === '/search' && u.searchParams.has('q'),
  },
  {
    id: 'yandex', name: 'Яндекс',
    buildUrl: (q) => `https://yandex.ru/search/?text=${encodeURIComponent(q)}`,
    isResultUrl: (u) => /(^|\.)yandex\.[a-z.]+$/i.test(u.hostname) && u.pathname.startsWith('/search') && u.searchParams.has('text'),
  },
];

// Result-страница ЛЮБОГО известного поисковика (не домен/главная сама по себе — google.com,
// yandex.ru как есть остаются валидной историей). Используется ТОЛЬКО фильтром записи в
// историю (HistoryManager.ts::#shouldRecord) — omnibox-навигацию/подсказки не трогает.
export function isSearchResultUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return SEARCH_ENGINES.some((e) => e.isResultUrl(u));
  } catch {
    return false;
  }
}

export const DEFAULT_SEARCH_ENGINE_ID: SearchEngineId = 'duckduckgo';

export function isSearchEngineId(v: unknown): v is SearchEngineId {
  return typeof v === 'string' && SEARCH_ENGINES.some((e) => e.id === v);
}

export function getSearchEngine(id: SearchEngineId): SearchEngineDef {
  return SEARCH_ENGINES.find((e) => e.id === id) ?? SEARCH_ENGINES[0]!;
}
