// Разбор ответа Travelpayouts Data API (часы на билеты).
//
// ⚠️ Живёт ОТДЕЛЬНО и БЕЗ импортов — под прогон обычным node (npm run travelpayouts-check).
// Это слой, который решает, какую цену запишем в график. Ошибка здесь — ложное «подешевело».
// Сети здесь нет: запрос живёт в electron/TravelpayoutsClient.ts через сессию профиля.

export interface FlightOffer {
  origin: string;
  destination: string;
  originAirport: string;
  destinationAirport: string;
  price: number;
  currency: string;
  airline: string;
  flightNumber: string;
  departureAt: string;
  returnAt: string;
  transfers: number;
  link: string;
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function flightNumberOf(v: unknown): string {
  const s = str(v);
  return s.replace(/^0+(?=\d)/, '');
}

function fromRow(row: Record<string, unknown>, currency: string): FlightOffer | null {
  const price = num(row.price);
  const airline = str(row.airline).toUpperCase();
  const flightNumber = flightNumberOf(row.flight_number);
  if (!price || !airline || !flightNumber) return null;
  return {
    origin: str(row.origin).toUpperCase(),
    destination: str(row.destination).toUpperCase(),
    originAirport: str(row.origin_airport).toUpperCase(),
    destinationAirport: str(row.destination_airport).toUpperCase(),
    price,
    currency: (str(row.currency) || currency || 'RUB').toUpperCase(),
    airline,
    flightNumber,
    departureAt: str(row.departure_at),
    returnAt: str(row.return_at),
    transfers: Math.max(0, Math.floor(num(row.transfers) || 0)),
    link: str(row.link),
  };
}

/**
 * Офферы из JSON ответа /aviasales/v3/prices_for_dates.
 *
 * Пустой массив — нормальный исход: кэш за 48 часов мог не содержать этот маршрут.
 * null — ответ вообще не про цены (ошибка API, чужой JSON).
 */
export function parsePricesForDates(json: unknown): FlightOffer[] | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  if (root.success === false) return null;
  const currency = str(root.currency).toUpperCase() || 'RUB';
  const raw = root.data;
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.values(raw as Record<string, unknown>)
      : [];
  const out: FlightOffer[] = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const offer = fromRow(item as Record<string, unknown>, currency);
    if (offer) out.push(offer);
  }
  return out;
}

export function cheapestOffer(offers: FlightOffer[]): FlightOffer | null {
  let best: FlightOffer | null = null;
  for (const o of offers) {
    if (!best || o.price < best.price) best = o;
  }
  return best;
}

export function sameFlight(a: { airline: string; flightNumber: string }, airline: string, flightNumber: string): boolean {
  return a.airline.toUpperCase() === airline.toUpperCase()
    && flightNumberOf(a.flightNumber) === flightNumberOf(flightNumber);
}

export function findOffer(offers: FlightOffer[], airline: string, flightNumber: string): FlightOffer | null {
  return offers.find((o) => sameFlight(o, airline, flightNumber)) ?? null;
}

/** Уникальные рейсы, дешёвые сверху — для меню выбора. */
export function offersForMenu(offers: FlightOffer[], limit = 15): FlightOffer[] {
  const seen = new Set<string>();
  const out: FlightOffer[] = [];
  const sorted = [...offers].sort((a, b) => a.price - b.price);
  for (const o of sorted) {
    const key = `${o.airline}|${o.flightNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
    if (out.length >= limit) break;
  }
  return out;
}
