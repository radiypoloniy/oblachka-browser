// Единый источник истины по поисковикам — id, имя для UI/лейблов, шаблон URL.
// Импортируется и main (TabManager: omnibox-навигация, ПКМ-поиск), и renderer
// (Toolbar: дропдаун-подсказка «Искать: …») — один шаблон URL на движок, не дублируется.

export type SearchEngineId = 'duckduckgo' | 'google' | 'yandex';

export interface SearchEngineDef {
  id: SearchEngineId;
  name: string; // человекочитаемое имя — для лейблов ПКМ/капсулы
  buildUrl: (query: string) => string;
}

export const SEARCH_ENGINES: readonly SearchEngineDef[] = [
  { id: 'duckduckgo', name: 'DuckDuckGo', buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  { id: 'google',     name: 'Google',     buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { id: 'yandex',     name: 'Яндекс',     buildUrl: (q) => `https://yandex.ru/search/?text=${encodeURIComponent(q)}` },
];

export const DEFAULT_SEARCH_ENGINE_ID: SearchEngineId = 'duckduckgo';

export function isSearchEngineId(v: unknown): v is SearchEngineId {
  return typeof v === 'string' && SEARCH_ENGINES.some((e) => e.id === v);
}

export function getSearchEngine(id: SearchEngineId): SearchEngineDef {
  return SEARCH_ENGINES.find((e) => e.id === id) ?? SEARCH_ENGINES[0]!;
}
