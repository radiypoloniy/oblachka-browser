// Когда два предложения — один и тот же товар (отслеживание товаров, срез 4).
//
// ⚠️ Живёт ОТДЕЛЬНО и БЕЗ импортов — под прогон обычным node (npm run product-match-check).
//
// ⚠️ Слоя ДВА, и это несущее разделение:
//  1. КОД по опознавательным знакам — склеивает САМ, без спроса. Совпал штрихкод — это один товар,
//     тут нечего решать и нечего спрашивать.
//  2. Модель — только ПРЕДЛАГАЕТ, склеивает человек. Она включается там, где знаков нет, и её
//     ошибка означала бы слипшиеся в одну карточку разные товары с разными ценами, то есть
//     враньё в самой сути фичи.
// Здесь живут правила первого слоя и грубый отсев кандидатов для второго — модель не должна
// получать на сравнение заведомо чужие пары.

export interface MatchCodes {
  gtin: string;
  mpn: string;
  brand: string;
  title: string;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Один ли это товар ПО КОДАМ. true — склеиваем сами, без вопросов.
 *
 * ⚠️ `sku` тут не участвует НАМЕРЕННО: в schema.org это артикул САМОГО МАГАЗИНА, у каждого свой,
 * и совпадение «WS-K07D» в двух магазинах — совпадение случайное ровно настолько же, насколько
 * осмысленное. Штрихкод (gtin) глобален, артикул производителя (mpn) — тоже, но его подтверждаем
 * ещё и брендом: «100» в качестве mpn встречается у кого угодно.
 */
export function sameProductByCodes(a: MatchCodes, b: MatchCodes): boolean {
  const gtinA = norm(a.gtin);
  const gtinB = norm(b.gtin);
  // Слишком короткий «штрихкод» — это не штрихкод, а чей-то внутренний номер.
  if (gtinA && gtinA.length >= 8 && gtinA === gtinB) return true;

  const mpnA = norm(a.mpn);
  const mpnB = norm(b.mpn);
  const brandA = norm(a.brand);
  const brandB = norm(b.brand);
  if (mpnA && mpnA.length >= 3 && mpnA === mpnB && brandA && brandA === brandB) return true;

  return false;
}

// Слова, которые есть в названии любого товара и о совпадении не говорят ничего.
const STOP = new Set(['для', 'and', 'the', 'шт', 'мм', 'см', 'гб', 'тб']);

function words(title: string): string[] {
  return norm(title)
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * Стоит ли ВООБЩЕ спрашивать модель про эту пару.
 *
 * ⚠️ Грубый отсев, а не решение: он экономит прогоны модели и, что важнее, не даёт ей шанса
 * «увидеть» сходство там, где названия не пересекаются вовсе. Решение всё равно за человеком.
 */
export function worthAsking(titleA: string, titleB: string): boolean {
  const a = new Set(words(titleA));
  const b = new Set(words(titleB));
  if (a.size < 2 || b.size < 2) return false;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  if (common < 2) return false;
  // Доля общих слов от меньшего из названий: у одного товара в двух магазинах названия разной
  // длины («Ноутбук CHUWI Corebook Air 14" …» против «CHUWI Corebook Air»), и делить на объединение
  // тут неверно — длинное название штрафовало бы совпадение, которое на самом деле полное.
  return common / Math.min(a.size, b.size) >= 0.5;
}
