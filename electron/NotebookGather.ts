import { runTabOrganizePrompt } from './TranslationService';
import { searxngSearch, type SearxngResult } from './SearxngSearch';

// «Собрать материал»: модель предлагает поисковые запросы, человек их правит, поиск идёт через
// его же SearXNG, а найденное становится обычным источником блокнота.
//
// ⚠️ ШАГ ПОДТВЕРЖДЕНИЯ ОБЯЗАТЕЛЕН, и убирать его нельзя. Запрос уходит на ВНЕШНИЙ сервер, и
// молча отправлять туда придуманное моделью — ровно то, от чего проект отказывается by design
// (см. «предлагать, а не делать» в CLAUDE.md). Поэтому функций здесь две, а не одна: сначала
// suggestQueries, потом — по явной команде — runSearch.
//
// ⚠️ Цикла «модель ищет → читает → решает искать ещё» здесь НЕТ и не будет. Локальная 4B не
// планирует на длинном горизонте — это записано в дорожной карте как причина, по которой план
// на холсте графа рисует человек, а не модель. Один шаг, подтверждение, ещё шаг.

// Форма ответа модели. ⚠️ Под грамматикой (createGrammarForJsonSchema): ограничение действует на
// КАЖДОМ токене, поэтому «модель вернула не список» здесь недостижимо, а не редко.
const QUERIES_SCHEMA = {
  type: 'object',
  properties: {
    queries: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
  },
} as const;

// Запас x3 над типичным ответом: четыре коротких запроса — это десятки токенов.
const QUERIES_MAX_TOKENS = 220;

// Сколько результатов оставляем человеку на выбор. Больше — это уже страница выдачи, а не
// «отметь нужное»: смысл шага в том, чтобы решение занимало секунды.
const MAX_RESULTS = 12;

function buildPrompt(topic: string, context: string): string {
  const head = 'Придумай 2–4 коротких поисковых запроса, чтобы собрать материал по теме. '
    + 'Запрос — 3–7 слов, без кавычек и без вопросительных знаков, как их набирают в поиске. '
    + 'Запросы должны дополнять друг друга, а не повторять. Пиши на языке темы. '
    + 'Ответь СТРОГО валидным JSON: {"queries":["…","…"]}';
  const body = context.trim()
    // Уже собранный материал — это контекст темы, а не цель: просим искать ВОКРУГ него, иначе
    // модель предлагает запросы, которые вернут ровно то, что уже добавлено.
    ? `\n\nТема: ${topic}\n\nЧто уже собрано (ищи то, чего здесь НЕТ):\n${context.slice(0, 4000)}`
    : `\n\nТема: ${topic}`;
  return head + body;
}

export type SuggestOutcome =
  | { ok: true; queries: string[] }
  | { ok: false; error: string };

export async function suggestQueries(topic: string, context: string): Promise<SuggestOutcome> {
  const t = topic.trim();
  if (!t) return { ok: false, error: 'Напишите тему — по ней и подберу запросы' };
  const res = await runTabOrganizePrompt(buildPrompt(t, context), {
    maxTokens: QUERIES_MAX_TOKENS,
    schema: QUERIES_SCHEMA,
  });
  if (!res.ok) return { ok: false, error: res.error };
  try {
    const parsed = JSON.parse(res.out) as { queries?: unknown };
    const list = Array.isArray(parsed.queries) ? parsed.queries : [];
    const queries = list
      .filter((q): q is string => typeof q === 'string')
      .map((q) => q.trim())
      .filter((q) => q.length > 0)
      .slice(0, 4);
    // Пустой список — не ошибка модели, а отсутствие идей: сказать об этом честнее, чем
    // показать пустую форму.
    if (queries.length === 0) return { ok: false, error: 'Не получилось придумать запросы — уточните тему' };
    return { ok: true, queries };
  } catch {
    return { ok: false, error: 'Модель вернула неразборчивый ответ' };
  }
}

export interface GatherHit { title: string; url: string; snippet: string }

export type SearchOutcome =
  | { ok: true; hits: GatherHit[] }
  | { ok: false; error: string };

/**
 * Прогон подтверждённых запросов. ⚠️ Последовательно, а не параллельно: SearXNG у человека
 * обычно свой и маленький, и три одновременных запроса — самый быстрый способ получить от него
 * отказ. Дубликаты по адресу схлопываются: два запроса на смежные темы почти всегда пересекаются.
 */
export async function runSearch(queries: string[]): Promise<SearchOutcome> {
  const list = queries.map((q) => q.trim()).filter((q) => q.length > 0).slice(0, 4);
  if (list.length === 0) return { ok: false, error: 'Не из чего искать' };

  const seen = new Set<string>();
  const hits: GatherHit[] = [];
  let lastError: string | null = null;

  for (const q of list) {
    const res = await searxngSearch(q);
    if (!res.ok) { lastError = res.error; continue; }
    for (const r of res.results as SearxngResult[]) {
      const url = (r.url ?? '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      hits.push({ title: r.title || url, url, snippet: r.content ?? '' });
      if (hits.length >= MAX_RESULTS) break;
    }
    if (hits.length >= MAX_RESULTS) break;
  }

  // Ничего не нашли И была ошибка — показываем ошибку: «пусто» и «сервер не ответил» человек
  // обязан различать, потому что чинятся они по-разному.
  if (hits.length === 0 && lastError) return { ok: false, error: lastError };
  return { ok: true, hits };
}
