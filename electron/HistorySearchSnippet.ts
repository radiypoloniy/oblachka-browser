import type { CandidateChunk } from './HistoryReadQueries';
import { isNoisyForEmbedding } from './HistoryNoiseFilter';
import { historyFtsTerms, historyNumericPattern, isHistoryNumericPhrase, stemQuery } from './textStemming';

export const HISTORY_FTS_PAGE_LIMIT = 12;
const MODEL_SNIPPET_MAX = 240;

function prefixSnippet(text: string): string {
  return text.length <= 360 ? text : `${text.slice(0, 360).trim()}...`;
}

// Используем те же основы слов, что FTS, но сохраняем исходные слова и позиции.
// Выбор окна не вызывает модель и ограничен текстом уже найденных чанков.
export function createHistorySnippet(query: string): (text: string) => string {
  const queryTerms = historyFtsTerms(query);
  const phrases = queryTerms.filter(isHistoryNumericPhrase).map(term => ({ term, pattern: historyNumericPattern(term, 'gu') }));
  const terms = new Set(queryTerms.filter(term => !isHistoryNumericPhrase(term)).flatMap(term => term.match(/[\p{L}\p{N}]+/gu) ?? []));
  const prefixes = new Set([...terms].map(term => term.slice(0, 2)));
  return text => {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= MODEL_SNIPPET_MAX) return compact;
    const matches: { start: number; end: number; term: string }[] = [];
    // Отдельные цифры раньше фразы не должны увести контекст от нужного номера.
    for (const { term, pattern } of phrases) {
      for (const match of compact.matchAll(pattern)) matches.push({ start: match.index!, end: match.index! + match[0].length, term });
    }
    for (const word of compact.matchAll(/[\p{L}\p{N}]+/gu)) {
      const lower = word[0].toLowerCase();
      // Наш Snowball удаляет окончания, не меняя начало слова. Замер 12 чанков
      // показал лишнюю работу стеммера на словах, заведомо чужих запросу.
      if (!prefixes.has(lower.slice(0, 2))) continue;
      const term = terms.has(lower) ? lower : stemQuery(lower);
      if (terms.has(term)) matches.push({ start: word.index!, end: word.index! + word[0].length, term });
    }
    if (matches.length === 0) return prefixSnippet(compact);
    if (phrases.length) matches.sort((a, b) => a.start - b.start);

    // Предпочитаем окно с несколькими РАЗНЫМИ словами запроса: повтор одного общего
    // слова в начале не должен скрыть более содержательное совпадение дальше.
    const counts = new Map<string, number>();
    let left = 0, bestCount = 0, bestNumbers = 0, bestStart = 0;
    for (let right = 0; right < matches.length; right++) {
      const match = matches[right];
      counts.set(match.term, (counts.get(match.term) ?? 0) + 1);
      while (left <= right && match.end - matches[left].start > MODEL_SNIPPET_MAX - 64) {
        const term = matches[left++].term, n = counts.get(term)! - 1;
        if (n) counts.set(term, n); else counts.delete(term);
      }
      // Обязательный номер важнее общего слова отдельно от него (в том числе из заголовка).
      const numbers = phrases.length ? [...counts.keys()].filter(isHistoryNumericPhrase).length : 0;
      if (numbers > bestNumbers || (numbers === bestNumbers && counts.size > bestCount)) {
        bestNumbers = numbers; bestCount = counts.size; bestStart = matches[left].start;
      }
    }
    if (!bestCount) return prefixSnippet(compact);
    let start = Math.max(0, bestStart - 32);
    // Сдвигаем начало к границе слова; запас окна оставляет место для контекста и многоточий.
    const boundary = compact.lastIndexOf(' ', start);
    if (boundary >= Math.max(0, start - 16)) start = boundary + 1;
    const lead = start ? '… ' : '';
    const end = Math.min(compact.length, start + MODEL_SNIPPET_MAX - lead.length - 2);
    return `${lead}${compact.slice(start, end).trim()}${end < compact.length ? ' …' : ''}`;
  };
}

export function prepareHistoryCandidateChunks(chunks: CandidateChunk[], query: string): CandidateChunk[] {
  const seen = new Set<number>(), result: CandidateChunk[] = [];
  let snippetFor: ReturnType<typeof createHistorySnippet> | undefined;
  for (const chunk of chunks) {
    if (isNoisyForEmbedding(chunk.url, chunk.title) || seen.has(chunk.historyId)) continue;
    seen.add(chunk.historyId);
    // В production готовим здесь в читающем воркере; повторный проход в main только
    // принимает готовый фрагмент. Синхронный путь нужен изолированным проверкам.
    const snippet = chunk.snippet ?? (snippetFor ??= createHistorySnippet(query))(chunk.text);
    result.push({ ...chunk, snippet });
    if (result.length === HISTORY_FTS_PAGE_LIMIT) break;
  }
  return result;
}
