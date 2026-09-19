import { stemText, stemQuery } from './textStemming';

// Показываем совпавший участок чанка модели и человеку, а не всегда начало страницы.
export function makeSearchSnippet(text: string, query: string, maxChars = 360): string {
  const stems = new Set((stemQuery(query).toLowerCase().match(/\p{L}+/gu) ?? []).filter((word) => word.length >= 2));
  let center = 0;
  for (const match of text.matchAll(/\p{L}+/gu)) {
    if (stems.has(stemText(match[0])) && match.index !== undefined) {
      center = match.index;
      break;
    }
  }
  const start = Math.max(0, center - Math.floor(maxChars / 3));
  return text.slice(start, start + maxChars).replace(/\s+/g, ' ').trim();
}
