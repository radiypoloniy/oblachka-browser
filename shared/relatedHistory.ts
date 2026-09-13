// Запрос «вы это уже читали»: тема страницы, не уникальный headline.
//
// ⚠️ Значимых импортов нет: прогон scripts/related-history-check.mjs идёт голым node.
// Живой промах: на kod.ru/dtf/Афише карточек не было, а после клика на YouTube — были.
// Причина: в FTS уходят первые 8 слов заголовка, и «Diablo» с хвоста DTF не попадало;
// реранк при этом искал «ту же статью», а не соседние материалы по событию.

export const RELATED_QUERY_MAX_TERMS = 8;
export const RELATED_QUERY_MIN_CHARS = 4;

const SITE_TAIL = /\s+[—–\-|·]\s+[^—–\-|·]{2,40}$/;
const SPLIT_RE = /[\s\-_/|·•,.:;!?()[\]{}'"«»—–]+/;

const STOP = new Set([
  'что', 'как', 'это', 'для', 'или', 'при', 'без', 'над', 'под', 'про',
  'все', 'всё', 'еще', 'ещё', 'уже', 'чем', 'так', 'том', 'его', 'её', 'ее',
  'они', 'нам', 'вам', 'нас', 'вас', 'эта', 'этот', 'эти', 'той', 'тем',
  'нет', 'вот', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'you',
  'was', 'are', 'not', 'but', 'his', 'her', 'its', 'our', 'who',
]);

/** Хвост « — сайт» и префикс «(3)» почты. Если после хвоста почти ничего — заголовок и был именем сайта. */
export function stripSiteTail(title: string): string {
  let t = (title || '').trim().replace(/^\(\d+\)\s*/, '');
  const stripped = t.replace(SITE_TAIL, '').trim();
  // Хвост короче 12 символов всё равно имя сайта («YouTube», «DTF»). Старый порог 12 оставлял
  // «YouTube» в запросе и «связанное» схлопывалось в другие ролики того же хоста.
  if (stripped.length >= RELATED_QUERY_MIN_CHARS) t = stripped;
  return t;
}

function termScore(raw: string): number {
  let score = 0;
  if (/[a-z]/i.test(raw)) score += 10;
  if (raw.length >= 6) score += 3;
  const lower = raw.toLowerCase();
  if (raw !== lower && /\p{Lu}/u.test(raw[0] ?? '')) score += 2;
  return score;
}

/**
 * Слова темы для FTS. Латиница и имена собственные раньше длинного русского ряда:
 * иначе «Караван, процедурная генерация… Diablo V» теряет Diablo за лимитом в 8.
 */
export function relatedQueryFromTitle(title: string): string {
  const tokens = stripSiteTail(title)
    .split(SPLIT_RE)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t.toLowerCase()));
  const ranked = tokens
    .map((raw, index) => ({ raw, index, score: termScore(raw) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, RELATED_QUERY_MAX_TERMS)
    .sort((a, b) => a.index - b.index);
  const q = ranked.map((t) => t.raw.toLowerCase()).join(' ');
  return q.length >= RELATED_QUERY_MIN_CHARS ? q : '';
}

/** Промпт реранка для «уже читали»: другая статья на ту же новость — попадание, не промах. */
export function buildRelatedRerankPrompt(query: string, numberedList: string): string {
  return (
    `Человек сейчас читает страницу по теме: "${query}"\n\n` +
    `Ниже страницы из его истории. Верни номера тех, которые про то же событие, игру, ` +
    `произведение или разбор — другая статья, ролик или анонс на ту же новость подходит. ` +
    `Совпадение заголовка не требуется. Случайное общее слово («игра», «новости», имя сайта) ` +
    `— не повод включать. Нет подходящих — пустая строка, это нормально. Номера через запятую, ` +
    `в порядке убывания близости (например: 2,0,5). Только номера или пустая строка.\n\n` +
    numberedList
  );
}
