// Разбор адреса поиска Aviasales (часы на билеты).
//
// ⚠️ Живёт ОТДЕЛЬНО и БЕЗ импортов — под прогон обычным node (npm run aviasales-url-check).
// Это слой, который решает, ЧТО мы поставим на слежение: ошибка здесь — часы на чужие даты
// или индикатор на странице, где искать нечего.
//
// Формат пути известный и меняется редко: /search/MOW0110LED15101 → Москва 1 окт → Петербург
// 15 окт, 1 взрослый. Это не CSS-селектор карточки. Страницу не читаем.

export type FlightCabin = 'Y' | 'C' | 'W' | 'F';

export interface AviasalesSearch {
  origin: string;
  destination: string;
  /** Вылет, YYYY-MM-DD. */
  depart: string;
  /** Обратно; пустая строка — в одну сторону. */
  returnDate: string;
  adults: number;
  children: number;
  infants: number;
  cabin: FlightCabin;
  /** Адрес, который откроем по клику на карточке. */
  openUrl: string;
}

const HOSTS = new Set(['aviasales.ru', 'aviasales.com']);
const CABINS = new Set<string>(['Y', 'C', 'W', 'F']);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function validDayMonth(day: number, month: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(2024, month - 1, day));
  return dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function isoToday(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Ближайшая дата этого дня и месяца, не раньше `minIso` (обычно сегодня или дата вылета). */
export function resolveYmd(day: number, month: number, minIso: string): string {
  const minYear = Number(minIso.slice(0, 4));
  let year = Number.isFinite(minYear) ? minYear : new Date().getFullYear();
  let iso = `${year}-${pad2(month)}-${pad2(day)}`;
  if (iso < minIso) {
    year += 1;
    iso = `${year}-${pad2(month)}-${pad2(day)}`;
  }
  return iso;
}

function parsePax(digits: string): { adults: number; children: number; infants: number } | null {
  if (digits.length === 0) return { adults: 1, children: 0, infants: 0 };
  if (digits.length > 3 || !/^\d+$/.test(digits)) return null;
  const adults = Number(digits[0]);
  const children = digits.length >= 2 ? Number(digits[1]) : 0;
  const infants = digits.length >= 3 ? Number(digits[2]) : 0;
  if (adults < 1 || adults > 9) return null;
  return { adults, children, infants };
}

/**
 * Хвост после destination: [DDMM возврата] + пассажиры + [класс].
 *
 * Один конец: 1–3 цифры (взрослые / дети / младенцы). Туда-обратно: минимум 4 цифры даты
 * возврата; взрослый в сигнатуре почти всегда есть, и тогда хвост ≥ 5. Ровно 4 — дата
 * возврата без явных пассажиров, взрослых считаем одного.
 */
function parseTail(raw: string): {
  returnDay: number;
  returnMonth: number;
  adults: number;
  children: number;
  infants: number;
  cabin: FlightCabin;
} | null {
  let s = raw.toUpperCase();
  let cabin: FlightCabin = 'Y';
  const last = s.slice(-1);
  if (CABINS.has(last) && s.length > 0) {
    cabin = last as FlightCabin;
    s = s.slice(0, -1);
  }
  if (!/^\d*$/.test(s)) return null;

  if (s.length >= 4) {
    const returnDay = Number(s.slice(0, 2));
    const returnMonth = Number(s.slice(2, 4));
    if (!validDayMonth(returnDay, returnMonth)) return null;
    const pax = parsePax(s.slice(4));
    if (!pax) return null;
    return { returnDay, returnMonth, ...pax, cabin };
  }
  const pax = parsePax(s);
  if (!pax) return null;
  return { returnDay: 0, returnMonth: 0, ...pax, cabin };
}

/** Собрать сигнатуру пути — для тестов круга и для канонического openUrl. */
export function buildAviasalesSignature(s: AviasalesSearch): string {
  const d = s.depart.slice(8, 10) + s.depart.slice(5, 7);
  let out = `${s.origin}${d}${s.destination}`;
  if (s.returnDate) {
    out += s.returnDate.slice(8, 10) + s.returnDate.slice(5, 7);
  }
  out += String(s.adults);
  if (s.children > 0 || s.infants > 0) out += String(s.children);
  if (s.infants > 0) out += String(s.infants);
  if (s.cabin !== 'Y') out += s.cabin;
  return out;
}

function parseSignature(sig: string, now: Date, pageUrl: string): AviasalesSearch | null {
  const m = /^([A-Z]{3})(\d{2})(\d{2})([A-Z]{3})(.*)$/.exec(sig.toUpperCase());
  if (!m) return null;
  const origin = m[1]!;
  const departDay = Number(m[2]);
  const departMonth = Number(m[3]);
  const destination = m[4]!;
  if (!validDayMonth(departDay, departMonth)) return null;
  const tail = parseTail(m[5] ?? '');
  if (!tail) return null;

  const today = isoToday(now);
  const depart = resolveYmd(departDay, departMonth, today);
  const returnDate = tail.returnDay
    ? resolveYmd(tail.returnDay, tail.returnMonth, depart)
    : '';

  const search: AviasalesSearch = {
    origin,
    destination,
    depart,
    returnDate,
    adults: tail.adults,
    children: tail.children,
    infants: tail.infants,
    cabin: tail.cabin,
    openUrl: '',
  };
  try {
    const u = new URL(pageUrl);
    u.hash = '';
    u.search = '';
    u.pathname = `/search/${buildAviasalesSignature(search)}`;
    search.openUrl = u.toString();
  } catch {
    search.openUrl = `https://www.aviasales.ru/search/${buildAviasalesSignature(search)}`;
  }
  return search;
}

/**
 * Поиск из адреса вкладки. null — это не страница поиска Aviasales, и индикатор зажигать
 * не за что. Ложное «нашёлся» дороже пропуска: меню предложит следить там, где нечего.
 *
 * `now` — для прогона: год в сигнатуре не кодируется, берём ближайшую дату не раньше сегодня.
 */
export function parseAviasalesUrl(url: string, now: Date = new Date()): AviasalesSearch | null {
  if (!url || !HOSTS.has(hostOf(url))) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }

  const hashQ = queryFromHash(parsed.hash);
  const paramsSig = parsed.searchParams.get('params') || hashQ.get('params');
  const pathMatch = /^\/search\/([A-Za-z0-9]+)/.exec(parsed.pathname);
  const sig = pathMatch?.[1] || paramsSig || hashSearchSignature(parsed.hash) || '';
  if (sig) {
    const fromSig = parseSignature(sig, now, url);
    if (fromSig) return fromSig;
  }

  const origin = (parsed.searchParams.get('origin_iata') || hashQ.get('origin_iata') || '').toUpperCase();
  const destination = (parsed.searchParams.get('destination_iata') || hashQ.get('destination_iata') || '').toUpperCase();
  const depart = parsed.searchParams.get('depart_date') || hashQ.get('depart_date') || '';
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(depart)) return null;
  const returnRaw = parsed.searchParams.get('return_date') || hashQ.get('return_date') || '';
  const returnDate = /^\d{4}-\d{2}-\d{2}$/.test(returnRaw) ? returnRaw : '';
  const adults = Math.max(1, Math.min(9, Number(parsed.searchParams.get('adults') || hashQ.get('adults') || '1') || 1));
  const children = Math.max(0, Math.min(9, Number(parsed.searchParams.get('children') || hashQ.get('children') || '0') || 0));
  const infants = Math.max(0, Math.min(9, Number(parsed.searchParams.get('infants') || hashQ.get('infants') || '0') || 0));
  const cabinRaw = (parsed.searchParams.get('trip_class') || hashQ.get('trip_class') || 'Y').toUpperCase();
  const cabin: FlightCabin = CABINS.has(cabinRaw) ? cabinRaw as FlightCabin : 'Y';
  const search: AviasalesSearch = {
    origin, destination, depart, returnDate, adults, children, infants, cabin, openUrl: '',
  };
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    u.pathname = `/search/${buildAviasalesSignature(search)}`;
    search.openUrl = u.toString();
  } catch {
    search.openUrl = `https://www.aviasales.ru/search/${buildAviasalesSignature(search)}`;
  }
  return search;
}

/**
 * Открытый в адресе конкретный билет. Aviasales кладёт его в `t=` — это не селектор карточки,
 * а та же подпись, что Travelpayouts отдаёт в поле `link`. Без неё меню видело только поиск
 * целиком и предлагало кэш самых дешёвых, а выбранный рейс молчал.
 */
export interface AviasalesTicket {
  airline: string;
  flightNumber: string;
}

/** Сегмент подписи: unix вылета (10) + прилёта (10) + номер рейса (6) + аэропорты (6). */
const TICKET_SEGMENT = 32;

function queryFromHash(hash: string): URLSearchParams {
  const h = hash.replace(/^#/, '');
  if (!h) return new URLSearchParams();
  const q = h.includes('?') ? h.slice(h.indexOf('?') + 1) : h;
  return new URLSearchParams(q);
}

function hashSearchSignature(hash: string): string {
  const m = /(?:^|\/)search\/([A-Za-z0-9]+)/i.exec(hash.replace(/^#/, ''));
  return m?.[1] || '';
}

function ticketTokenOf(parsed: URL): string {
  return parsed.searchParams.get('t') || queryFromHash(parsed.hash).get('t') || '';
}

export function parseAviasalesTicket(url: string): AviasalesTicket | null {
  if (!url || !HOSTS.has(hostOf(url))) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const raw = ticketTokenOf(parsed);
  if (!raw) return null;
  const body = raw.split('_')[0]!.toUpperCase();
  const m = /^([A-Z]{2})(.*)$/.exec(body);
  if (!m) return null;
  const rest = m[2]!;
  if (rest.length < TICKET_SEGMENT || rest.length % TICKET_SEGMENT !== 0) return null;
  const flightRaw = rest.slice(20, 26);
  if (!/^\d{6}$/.test(flightRaw)) return null;
  const n = Number(flightRaw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { airline: m[1]!, flightNumber: String(n) };
}

/** Цена из шаринга/открытого билета (`expected_price_value`). 0 в адресе не считаем ценой. */
export function parseAviasalesExpectedPrice(url: string): { price: number; currency: string } | null {
  if (!url || !HOSTS.has(hostOf(url))) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const hashQ = queryFromHash(parsed.hash);
  const raw = parsed.searchParams.get('expected_price_value') || hashQ.get('expected_price_value') || '';
  const price = Number.parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(price) || price <= 0) return null;
  const currency = (parsed.searchParams.get('expected_price_currency')
    || hashQ.get('expected_price_currency') || 'RUB').toUpperCase();
  return { price, currency: currency || 'RUB' };
}

function shortDate(iso: string): string {
  if (!iso) return '';
  const d = Number(iso.slice(8, 10));
  const m = Number(iso.slice(5, 7));
  const y = iso.slice(0, 4);
  return `${d}.${m}.${y}`;
}

/** Подпись маршрута для меню и карточки. Коды IATA — честнее выдуманного города. */
export function formatAviasalesTitle(s: AviasalesSearch, airline = '', flightNumber = ''): string {
  const dates = s.returnDate
    ? `${shortDate(s.depart).replace(/\.\d{4}$/, '')}–${shortDate(s.returnDate)}`
    : shortDate(s.depart);
  const route = `${s.origin} → ${s.destination}`;
  const flight = airline && flightNumber ? `, ${airline} ${flightNumber}` : '';
  return `${route}${flight} · ${dates}`;
}

/** Ключ часов: один поиск + опционально конкретный рейс. */
export function flightWatchKey(s: AviasalesSearch, airline = '', flightNumber = ''): string {
  return [
    s.origin, s.destination, s.depart, s.returnDate || '-',
    String(s.adults), s.cabin,
    airline.toUpperCase() || '-', String(flightNumber) || '-',
  ].join('|');
}
