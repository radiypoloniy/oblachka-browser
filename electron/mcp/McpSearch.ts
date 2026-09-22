// MCP: веб-поиск через уже настроенный SearXNG браузера.
//
// ⚠️ Не второй SearXNG в чужом процессе. Журналист и агенты ходят сюда же, куда чат Oblako —
// тот же endpoint, VPN-профиль и ключ. Иначе «унификация» разваливается на два инстанса.

import { searxngSearch } from '../SearxngSearch';

export async function webSearch(args: Record<string, unknown>): Promise<{
  query: string;
  results: Array<{ title: string; url: string; content: string }>;
  count: number;
}> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) throw new Error('Argument "query" is required.');

  const outcome = await searxngSearch(query);
  if (!outcome.ok) throw new Error(outcome.error);

  let results = outcome.results;
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
    ? Math.max(1, Math.min(10, Math.floor(args.limit)))
    : results.length;
  results = results.slice(0, limit);

  return { query, results, count: results.length };
}
