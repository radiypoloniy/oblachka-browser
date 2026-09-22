// Снимок текста ОТКРЫТОЙ вкладки, пока история ещё не успела положить чанки.
// Закрыли вкладку — запись пропадает. Историю и её FTS не трогает.
import { normalizeForOmnibox } from '../shared/frecency';
import { makeSearchSnippet } from './SearchSnippet';
import { stemQuery, stemText } from './textStemming';

type Rec = { url: string; title: string; text: string };

const byWc = new Map<number, Rec>();

function termsOf(query: string): string[] {
  return stemQuery(query).toLowerCase()
    .split(/[\s\-_/|·•,.:;!?()[\]{}'"«»—–]+/)
    .filter((term) => term.length >= 2)
    .slice(0, 8);
}

export function rememberOpenTabContent(wcId: number, url: string, title: string, text: string): void {
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 12_000);
  if (!trimmed) {
    byWc.delete(wcId);
    return;
  }
  byWc.set(wcId, { url, title, text: trimmed });
}

export function forgetOpenTabContent(wcId: number): void {
  byWc.delete(wcId);
}

export function searchOpenTabMemory(
  query: string,
  openUrls: string[],
): Array<{ url: string; title: string; snippet: string }> {
  const want = termsOf(query);
  if (want.length === 0) return [];
  const allowed = new Set(openUrls.map((url) => normalizeForOmnibox(url)));
  const hits: Array<{ url: string; title: string; snippet: string; wcId: number }> = [];
  for (const [wcId, rec] of byWc) {
    if (!allowed.has(normalizeForOmnibox(rec.url))) continue;
    const stemmed = stemText(rec.text).toLowerCase();
    if (!want.every((term) => stemmed.includes(term))) continue;
    hits.push({
      url: rec.url,
      title: rec.title,
      snippet: makeSearchSnippet(rec.text, query, 180),
      wcId,
    });
  }
  return hits;
}
