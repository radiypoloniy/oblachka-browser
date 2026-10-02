// Единственная точка стемминга для FTS-индекса истории (history_content_chunks_fts,
// см. HistoryManager.ts). Стеммим ТОЛЬКО то, что уходит в FTS-колонки — исходный текст в
// history_content_chunks.text не трогаем нигде (сниппеты и промпт Qwen читают его напрямую).
//
// ⚠️ stemText (запись) и stemQuery (построение MATCH) — тонкие обёртки над ОДНОЙ и той же
// #stemWords(). Расхождение токенизации/стемминга между записью и запросом даёт ТИХИЙ пустой
// результат (MATCH просто ничего не находит, без единой ошибки в логе) — если меняешь правила
// разбиения на слова или сам стеммер, здесь единственное место, где это нужно сделать.
import { newStemmer } from 'snowball-stemmers';

// Версия схемы стемминга FTS — HistoryManager.ts::#rebuildFtsWithStemming() сверяет её со
// значением, сохранённым в history_meta, и пересобирает history_content_chunks_fts заново, если
// не совпадает. Инкрементировать при любой правке #stemWords/WORD_RE ниже — иначе старые
// (стеммленные по прошлым правилам) строки индекса тихо разойдутся с новым stemQuery().
export const STEM_VERSION = 'ru-snowball-v1';

const russian = newStemmer('russian');

// Границы «слова» — максимальный прогон Unicode-букв (\p{L}), цифры и пунктуация — уже
// разделители, копируются как есть без похода в стеммер.
const WORD_RE = /\p{L}+/gu;

// lowerCase ОБЯЗАТЕЛЕН до stem(): алгоритм Snowball Russian регистрозависим — проверено эмпирически,
// "АВТОМОБИЛЬ" (весь капс) стеммер не трогает вообще, реагирует только на строчные буквы. Приводить
// к нижнему регистру безопасно и для латиницы: FTS5 unicode61 и так фолдит регистр при матче, а
// сам сниппет/текст для Qwen эта функция вообще не видит (стеммится только копия для FTS).
//
// Латиница проходит через тот же stem() без порчи — алгоритм классической Snowball Russian
// оперирует только кириллическими гласными/суффиксными классами; на словах без кириллицы ни одно
// правило не срабатывает, и слово возвращается как есть (кроме регистра) — проверено эмпирически
// на 'apple'/'wikipedia'/'iPhone'/цифрах: без изменений по содержанию.
//
// ⚠️ Известное ограничение (не фикс здесь): (1) буква «ё» алгоритмом не распознаётся как гласная —
// "ёлка"/"Ёлка" стеммер не трогает вообще; (2) для отдельных словоформ классический алгоритм
// расходится с ожидаемой леммой — напр. "автомобили" (им./вин. мн.ч.) стеммится в "автомоб", тогда
// как "автомобиль"/"автомобиля"/"автомобилей"/... сходятся в "автомобил" — известное свойство
// суффиксного (не словарного) стеммера на нестандартных окончаниях, не баг конкретного JS-порта.
function stemWords(input: string): string {
  return input.replace(WORD_RE, (word) => russian.stem(word.toLowerCase()));
}

export function stemText(text: string): string {
  return stemWords(text);
}

export function stemQuery(query: string): string {
  return stemWords(query);
}

// Токены MATCH и выбора фрагмента должны совпадать; правила самого стеммера не меняются.
export function historyFtsTerms(query: string): string[] {
  const stemmed = stemQuery(query).toLowerCase();
  const split = (text: string) => text.split(/[\s\-_/|·•,.:;!?()[\]{}'"«»—–]+/).filter(x => x.length >= 2);
  if (!/\d+[-./]\d+/.test(stemmed)) return split(stemmed).slice(0, 8);
  const result: string[] = [];
  let remaining = 8;
  for (const raw of stemmed.split(/[\s_|·•,:;!?()[\]{}'"«»—–]+/)) {
    const group = raw.replace(/^[-./]+|[-./]+$/g, '');
    if (/^\d+(?:[-./]\d+)+$/.test(group)) {
      const parts = group.split(/[-./]/);
      // Цифры уже есть в индексе: сохраняем последовательность как одну FTS-фразу.
      // Лимит считаем по её токенам; обрезанная версия/правило даст чужое совпадение.
      if (parts.length > remaining) break;
      result.push(parts.join(' ')); remaining -= parts.length;
    } else {
      const terms = split(group).slice(0, remaining);
      result.push(...terms); remaining -= terms.length;
    }
    if (!remaining) break;
  }
  return result;
}

export function isHistoryNumericPhrase(term: string): boolean { return /^\d+(?: \d+)+$/.test(term); }

// FTS видит соседние цифры, но не границы составного номера: 1.2.3 ≠ 1.2.3.4.
// Применяем к уже ограниченным строкам чтения, индекс и токенизацию записи не меняем.
export function historyNumericPattern(term: string, flags = 'u'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?<!\\d[-./])${term.split(' ').join('[-./\\s]+')}(?![\\p{L}\\p{N}]|[-./]\\d)`, flags);
}
