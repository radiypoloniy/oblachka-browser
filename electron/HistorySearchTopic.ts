import { historyFtsTerms, stemQuery } from './textStemming';

const REQUEST_STARTS = new Set(['найди', 'найдите', 'покажи', 'покажите', 'отыщи', 'ищу', 'где', 'find', 'show', 'where']);
const TOPIC_MARKERS = new Set(['про', 'о', 'об', 'about']);
const MEMORY_WORDS = new Set(['статья', 'страница', 'материал', 'пост', 'заметка', 'документ',
  'читал', 'читала', 'читали', 'смотрел', 'смотрела', 'видел', 'видела', 'открывал', 'открывала',
  'article', 'page', 'post', 'document', 'read', 'viewed', 'visited'].map(stemQuery));
const PREFIX_MAX_CHARS = 160;

// Отделяем только явную просьбу найти прочитанное от темы. Синонимы не придумываем,
// тему и её ограничения сохраняем дословно; полный вопрос остаётся для реранкера.
export function historySearchTopic(query: string): string {
  const q = query.trim();
  const words = [...q.slice(0, PREFIX_MAX_CHARS).matchAll(/[\p{L}\p{N}]+/gu)];
  if (!words.length || words[0].index !== 0) return q;
  const first = words[0][0].toLowerCase(), second = words[1]?.[0].toLowerCase();
  if (!REQUEST_STARTS.has(first) && !(first === 'как' && second === 'найти')) return q;
  for (const word of words) {
    if (!TOPIC_MARKERS.has(word[0].toLowerCase())) continue;
    const start = word.index!, end = start + word[0].length;
    // Предлог внутри URL/имени файла не является границей темы.
    if (!/\s/.test(q[start - 1] ?? '') || !/\s/.test(q[end] ?? '')) continue;
    const prefix = q.slice(0, start);
    if (/["«»]/.test(prefix)) return q;
    const prefixWords = prefix.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    if (prefixWords.some(w => w === 'не' || w === 'not' || w === 'without')) return q;
    if (!prefixWords.some(w => MEMORY_WORDS.has(stemQuery(w)))) continue;
    const topic = q.slice(end).trim();
    return historyFtsTerms(topic).length ? topic : q;
  }
  return q;
}
