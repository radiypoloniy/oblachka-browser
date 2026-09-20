// Часы на билеты Aviasales: разбор вкладки и нативное меню в «⋯».
//
// ⚠️ Вынесено из main.ts по тому же правилу, что BookmarkMenu.ts: композитор не место для логики,
// а сторож структуры не пустит «ещё один блок» в файл, который уже на своей записи в базе.
//
// Страницу не читаем. Есть ли что следить — решает URL (`shared/aviasalesUrl.ts`); цена — JSON
// Travelpayouts, не карточка выдачи. Конкретный открытый билет — параметр `t=` той же подписи.
// См. PRICE-TRACKING.md.
//
// ⚠️ Живая проверка 20.09.2026: проблему не сняло. Открытый конкретный билет по-прежнему не
// предлагается отслеживать — `t=` в адресе и unique=true кэша не совпали с тем, что человек
// видит на карточке. Селекторы карточки не читаем. Вернуться отдельно.
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { IPC } from '../shared/ipc';
import {
  parseAviasalesUrl, parseAviasalesTicket, parseAviasalesExpectedPrice, formatAviasalesTitle,
  flightWatchKey, type AviasalesSearch,
} from '../shared/aviasalesUrl';
import { cheapestOffer, findOffer, offersForMenu, sameFlight, type FlightOffer } from '../shared/travelpayouts';
import { fetchPricesForDates } from './TravelpayoutsClient';
import * as travelpayoutsKeyStore from './TravelpayoutsKeyStore';
import { activeTracking } from './ProfileData';
import { allContexts, broadcastToChrome, contextForWindow } from './WindowRegistry';
import { t, tf } from './uiText';

const tracking = () => activeTracking();

type MenuOffer = Pick<FlightOffer, 'airline' | 'flightNumber' | 'price' | 'currency'>;

const flightByTab = new Map<string, {
  url: string;
  search: AviasalesSearch;
  offers: FlightOffer[];
  noToken: boolean;
}>();

function searchKey(s: AviasalesSearch): string {
  return flightWatchKey(s, '', '');
}

/** Разобрать адрес вкладки и подтянуть офферы кэша — без скрипта в страницу. */
export async function refreshFlightForWebContents(wc: Electron.WebContents): Promise<void> {
  if (wc.isDestroyed()) return;
  const ctx = allContexts().find((c) => c.tabs.ownsWebContents(wc.id));
  if (!ctx) return;
  const tabId = ctx.tabs.tabIdForWebContents(wc.id);
  if (!tabId) return;
  const url = wc.getURL();
  const search = parseAviasalesUrl(url);
  if (!search) {
    flightByTab.delete(tabId);
    return;
  }
  if (!travelpayoutsKeyStore.getStatus()) {
    flightByTab.set(tabId, { url, search, offers: [], noToken: true });
    return;
  }
  const prev = flightByTab.get(tabId);
  // Сменился только открытый билет (`t=` / цена в query) — поиск тот же, кэш не дёргаем.
  if (prev && !prev.noToken && searchKey(prev.search) === searchKey(search)) {
    flightByTab.set(tabId, { ...prev, url, search });
    return;
  }
  const offers = await fetchPricesForDates(search);
  if (wc.isDestroyed()) return;
  const nowUrl = wc.getURL();
  const nowSearch = parseAviasalesUrl(nowUrl);
  if (!nowSearch || searchKey(nowSearch) !== searchKey(search)) return;
  flightByTab.set(tabId, { url: nowUrl, search: nowSearch, offers: offers ?? [], noToken: false });
}

function moneyLabel(price: number, currency: string): string {
  const cur = currency === 'RUB' || !currency ? '₽' : currency;
  return `${price.toLocaleString('ru-RU')} ${cur}`;
}

function trackFlightFromMenu(
  win: BrowserWindow,
  search: AviasalesSearch,
  offer: MenuOffer | null,
): void {
  const airline = offer?.airline ?? '';
  const flightNumber = offer?.flightNumber ?? '';
  const price = offer?.price ?? cheapestOffer(flightByTab.get(
    contextForWindow(win)?.tabs.snapshot().find((tab) => tab.isActive)?.id ?? '',
  )?.offers ?? [])?.price ?? 0;
  if (!(price > 0)) return;
  tracking().trackFlight({
    origin: search.origin,
    destination: search.destination,
    depart: search.depart,
    returnDate: search.returnDate,
    adults: search.adults,
    children: search.children,
    infants: search.infants,
    cabin: search.cabin,
    airline,
    flightNumber,
    title: formatAviasalesTitle(search, airline, flightNumber),
    openUrl: search.openUrl,
    currency: offer?.currency || 'RUB',
    price,
  });
  broadcastToChrome(IPC.TRACKING_CHANGED);
}

function flightId(search: AviasalesSearch, airline: string, flightNumber: string): number | null {
  return tracking().idForFlight({
    origin: search.origin, destination: search.destination, depart: search.depart,
    returnDate: search.returnDate, adults: search.adults, cabin: search.cabin,
    airline, flightNumber,
  });
}

function trackOrUntrackItem(
  search: AviasalesSearch,
  win: BrowserWindow,
  offer: MenuOffer,
  label: string,
  untrackLabel: string,
): MenuItemConstructorOptions {
  const id = flightId(search, offer.airline, offer.flightNumber);
  if (id !== null) {
    return {
      label: untrackLabel,
      click: () => {
        tracking().untrackFlight(id);
        broadcastToChrome(IPC.TRACKING_CHANGED);
      },
    };
  }
  return {
    label,
    click: () => trackFlightFromMenu(win, search, offer),
  };
}

/** Подменю «Билеты Aviasales» в «⋯». null — это не страница поиска, пунктов быть не должно. */
export async function flightMenuTemplate(win: BrowserWindow): Promise<MenuItemConstructorOptions[] | null> {
  const ctx = contextForWindow(win);
  const active = ctx?.tabs.snapshot().find((tab) => tab.isActive && !tab.isHub);
  if (!active) return null;
  let found = flightByTab.get(active.id);
  if (!found || found.url !== active.url) {
    const wc = ctx?.tabs.getActiveWebContents();
    if (wc && !wc.isDestroyed()) await refreshFlightForWebContents(wc);
    found = flightByTab.get(active.id);
  }
  if (!found || found.url !== active.url) return null;
  const { search, offers, noToken } = found;
  const title = formatAviasalesTitle(search);
  const items: MenuItemConstructorOptions[] = [
    { label: title.slice(0, 70), enabled: false },
    { type: 'separator' },
  ];
  if (noToken) {
    items.push({
      label: t('Нужен токен Travelpayouts'),
      click: () => { ctx?.tabs.createSpecialTab('settings', 'general'); },
    });
    items.push({ type: 'separator' });
    items.push({ label: t('Что я отслеживаю'), click: () => { ctx?.tabs.createSpecialTab('history', 'tracking'); } });
    return items;
  }

  const ticket = parseAviasalesTicket(found.url);
  const expected = parseAviasalesExpectedPrice(found.url);
  if (ticket) {
    const cached = findOffer(offers, ticket.airline, ticket.flightNumber);
    const price = expected?.price || cached?.price || 0;
    const currency = expected?.currency || cached?.currency || 'RUB';
    const flight = `${ticket.airline} ${ticket.flightNumber}`;
    if (price > 0) {
      items.push(trackOrUntrackItem(
        search, win,
        { airline: ticket.airline, flightNumber: ticket.flightNumber, price, currency },
        tf('Этот рейс — {flight}, {price}', { flight, price: moneyLabel(price, currency) }),
        tf('Не отслеживать {flight}', { flight }),
      ));
    } else {
      items.push({ label: t('Не нашли этот рейс в кэше Aviasales'), enabled: false });
    }
    items.push({ type: 'separator' });
  }

  const cheap = cheapestOffer(offers);
  const cheapId = flightId(search, '', '');
  if (cheapId !== null) {
    items.push({
      label: t('Не отслеживать самый дешёвый'),
      click: () => {
        tracking().untrackFlight(cheapId);
        broadcastToChrome(IPC.TRACKING_CHANGED);
      },
    });
  } else if (cheap) {
    items.push({
      label: tf('Самый дешёвый на эти даты — {price}', { price: moneyLabel(cheap.price, cheap.currency) }),
      click: () => trackFlightFromMenu(win, search, null),
    });
  } else if (!ticket) {
    items.push({ label: t('Кэш Aviasales пока без цен'), enabled: false });
  }

  const menuOffers = offersForMenu(offers, 15).filter((o) =>
    !ticket || !sameFlight(o, ticket.airline, ticket.flightNumber));
  if (menuOffers.length > 0) {
    items.push({ type: 'separator' });
    for (const offer of menuOffers) {
      const time = offer.departureAt.slice(11, 16);
      const flight = `${offer.airline} ${offer.flightNumber}`;
      const label = `${flight}${time ? `, ${time}` : ''} — ${moneyLabel(offer.price, offer.currency)}`;
      items.push(trackOrUntrackItem(
        search, win, offer, label, tf('Не отслеживать {flight}', { flight }),
      ));
    }
  }
  items.push({ type: 'separator' });
  items.push({ label: t('Что я отслеживаю'), click: () => { ctx?.tabs.createSpecialTab('history', 'tracking'); } });
  return items;
}
