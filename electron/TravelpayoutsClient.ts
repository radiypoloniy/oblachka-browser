// Запрос цен Aviasales через Travelpayouts Data API.
//
// ⚠️ Это кэш чужих поисков за ~48 часов, не живая выдача со вкладки. График чуть запаздывает,
// зато источник — JSON, а не селекторы карточки (см. PRICE-TRACKING.md: адаптеры под сайт
// не делаем).
//
// В сеть — только через сессию профиля: иначе запрос уйдёт мимо VPN и kill switch.
import type { AviasalesSearch } from '../shared/aviasalesUrl';
import { parsePricesForDates, type FlightOffer } from '../shared/travelpayouts';
import { fetchInProfile } from './ProfileSession';
import { getToken } from './TravelpayoutsKeyStore';

const API = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

export async function fetchPricesForDates(search: AviasalesSearch): Promise<FlightOffer[] | null> {
  const token = getToken();
  if (!token) return null;
  const url = new URL(API);
  url.searchParams.set('origin', search.origin);
  url.searchParams.set('destination', search.destination);
  url.searchParams.set('departure_at', search.depart);
  if (search.returnDate) {
    url.searchParams.set('return_at', search.returnDate);
    url.searchParams.set('one_way', 'false');
  } else {
    url.searchParams.set('one_way', 'true');
  }
  url.searchParams.set('sorting', 'price');
  url.searchParams.set('limit', '30');
  // ⚠️ unique=true — по одному самому дешёвому на авиакомпанию. Без него на конкретные даты
  // кэш часто отдаёт ОДИН оффер, и меню дублирует его как «самый дешёвый» и «конкретный рейс».
  url.searchParams.set('unique', 'true');
  url.searchParams.set('currency', 'RUB');
  url.searchParams.set('token', token);
  try {
    const res = await fetchInProfile(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' },
    });
    if (!res.ok) return null;
    return parsePricesForDates(await res.json());
  } catch {
    return null;
  }
}
