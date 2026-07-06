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
  // Заход 10: живые suggest-подсказки (автодополнение при вводе) — эндпоинт этого движка.
  // Вызывается ТОЛЬКО из main (SearchSuggestFetcher.ts) — ни один из трёх эндпоинтов не шлёт
  // Access-Control-Allow-Origin (проверено вручную), renderer-fetch получил бы CORS-блок.
  suggestUrl: (query: string) => string;
  // Разбор ответа в список фраз — формат у каждого движка свой (проверено вручную curl'ом).
  // Вход — уже распарсенный JSON (main делает res.json()), не сырая строка.
  parseSuggest: (json: unknown) => string[];
}

// Google/Yandex (firefox-client OpenSearch-подобный формат): [query, [фразы...], ...].
function parseArrayFormat(json: unknown): string[] {
  if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
  return json[1].filter((p): p is string => typeof p === 'string');
}

export const SEARCH_ENGINES: readonly SearchEngineDef[] = [
  {
    id: 'duckduckgo', name: 'DuckDuckGo',
    buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    isResultUrl: (u) => u.hostname.replace(/^www\./, '') === 'duckduckgo.com' && u.searchParams.has('q'),
    suggestUrl: (q) => `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}`,
    // DDG: [{"phrase":"..."}, ...] — свой формат, не [query, [...]] как у Google/Yandex.
    parseSuggest: (json) => Array.isArray(json)
      ? json.map((it) => (it as { phrase?: unknown })?.phrase).filter((p): p is string => typeof p === 'string')
      : [],
  },
  {
    id: 'google', name: 'Google',
    buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    isResultUrl: (u) => /(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname === '/search' && u.searchParams.has('q'),
    suggestUrl: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`,
    parseSuggest: parseArrayFormat,
  },
  {
    id: 'yandex', name: 'Яндекс',
    buildUrl: (q) => `https://yandex.ru/search/?text=${encodeURIComponent(q)}`,
    isResultUrl: (u) => /(^|\.)yandex\.[a-z.]+$/i.test(u.hostname) && u.pathname.startsWith('/search') && u.searchParams.has('text'),
    suggestUrl: (q) => `https://suggest.yandex.ru/suggest-ff.cgi?part=${encodeURIComponent(q)}`,
    parseSuggest: parseArrayFormat,
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
