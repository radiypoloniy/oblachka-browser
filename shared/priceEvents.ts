// Что считать СОБЫТИЕМ в отслеживании товара (срез 3).
//
// ⚠️ Живёт ОТДЕЛЬНО и БЕЗ импортов — под прогон обычным node (npm run price-events-check).
// Это слой, решающий, когда человека ДЁРНУТЬ уведомлением. Ошибка здесь дороже обычной: тост,
// пришедший зря, обучает закрывать тосты не читая, и в нужный раз его тоже закроют. Проверять
// такое надо прогоном, а не чтением.
//
// ⚠️ Модели тут нет и не будет: «подешевело на 1470 ₽» — это арифметика по нашим же наблюдениям,
// и обычный код делает её точно. См. отсеивающий вопрос в CLAUDE.md.

export type PriceEventKind = 'drop' | 'rise' | 'gone' | 'back' | 'ending';

export interface PriceObservation {
  price: number;
  availability: string;
}

export interface PriceEvent {
  kind: PriceEventKind;
  prevPrice: number;
  price: number;
  /** Насколько изменилась цена, в процентах со знаком. 0 для событий про наличие. */
  percent: number;
}

// ⚠️ Порог ДВОЙНОЙ, и оба условия обязательны. Только проценты — и на копеечном товаре тост
// прилетал бы от округления в 7 ₽; только рубли — и на дорогом ноутбуке изменение в 60 ₽ (0.1%)
// считалось бы новостью. Событие должно быть заметно И относительно, И по деньгам.
const MIN_PERCENT = 3;
const MIN_ABS = 50;

/** Наличие, при котором товар можно купить. Пустая строка — магазин не сказал, считаем что есть. */
function inStock(a: string): boolean {
  return a === '' || a === 'InStock' || a === 'LimitedAvailability' || a === 'PreOrder';
}

/**
 * Событие между двумя наблюдениями. null — «ничего, о чём стоит говорить», и это самый частый и
 * совершенно нормальный ответ.
 *
 * ⚠️ Первое наблюдение событием НЕ является: человек только что сам поставил товар на слежение и
 * видел цену своими глазами.
 */
export function detectEvent(prev: PriceObservation | null, next: PriceObservation): PriceEvent | null {
  if (!prev) return null;
  const base = { prevPrice: prev.price, price: next.price, percent: 0 };

  // Наличие важнее цены: «кончилось» человек хочет узнать, даже если цена при этом не менялась.
  if (inStock(prev.availability) && next.availability === 'OutOfStock') return { ...base, kind: 'gone' };
  if (!inStock(prev.availability) && inStock(next.availability)) return { ...base, kind: 'back' };
  if (prev.availability !== 'LimitedAvailability' && next.availability === 'LimitedAvailability') {
    return { ...base, kind: 'ending' };
  }

  if (!(prev.price > 0) || !(next.price > 0)) return null;
  const diff = next.price - prev.price;
  if (diff === 0) return null;
  const percent = (diff / prev.price) * 100;
  if (Math.abs(percent) < MIN_PERCENT || Math.abs(diff) < MIN_ABS) return null;
  return { ...base, kind: diff < 0 ? 'drop' : 'rise', percent: Math.round(percent) };
}

function money(v: number, currency: string): string {
  const n = Math.round(v).toLocaleString('ru-RU');
  return `${n} ${currency === 'RUB' || !currency ? '₽' : currency}`;
}

/**
 * Одна строка о событии — ОДНА на всех: и в тосте, и в списке на экране. Два разных текста об
 * одном и том же событии разошлись бы при первой же правке.
 */
export function describeEvent(e: PriceEvent, currency: string): string {
  switch (e.kind) {
    case 'drop': return `Подешевело на ${money(e.prevPrice - e.price, currency)} (${e.percent}%), сейчас ${money(e.price, currency)}`;
    case 'rise': return `Подорожало на ${money(e.price - e.prevPrice, currency)} (+${e.percent}%), сейчас ${money(e.price, currency)}`;
    case 'gone': return 'Больше нет в наличии';
    case 'back': return `Снова в наличии — ${money(e.price, currency)}`;
    case 'ending': return 'Осталось мало';
  }
}
