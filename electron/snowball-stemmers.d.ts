// snowball-stemmers не публикует типы — минимальная декларация под наши нужды (см. textStemming.ts).
declare module 'snowball-stemmers' {
  interface Stemmer {
    stem(word: string): string;
  }
  export function newStemmer(language: string): Stemmer;
  export function algorithms(): string[];
}
