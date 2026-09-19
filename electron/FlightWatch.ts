// Часы на билеты Aviasales: разбор вкладки и нативное меню в «⋯».
//
// ⚠️ Вынесено из main.ts по тому же правилу, что BookmarkMenu.ts: композитор не место для логики,
// а сторож структуры не пустит «ещё один блок» в файл, который уже на своей записи в базе.
//
// Страницу не читаем. Есть ли что следить — решает URL (`shared/aviasalesUrl.ts`); цена — JSON
// Travelpayouts, не карточка выдачи. См. PRICE-TRACKING.md.
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { IPC } from '../shared/ipc';
import { parseAviasalesUrl, formatAviasalesTitle, type AviasalesSearch } from '../shared/aviasalesUrl';
import { cheapestOffer, offersForMenu, type FlightOffer } from '../shared/travelpayouts';
import { fetchPricesForDates } from './TravelpayoutsClient';
import * as travelpayoutsKeyStore from './TravelpayoutsKeyStore';
import { activeTracking } from './ProfileData';
import { allContexts, broadcastToChrome, contextForWindow } from './WindowRegistry';
import { t, tf } from './uiText';

const tracking = () => activeTracking();

const flightByTab = new Map<string, {
  url: string;
  search: AviasalesSearch;
  offers: FlightOffer[];
  noToken: boolean;
}>();

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
  const offers = await fetchPricesForDates(search);
  if (wc.isDestroyed() || wc.getURL() !== url) return;
  flightByTab.set(tabId, { url, search, offers: offers ?? [], noToken: false });
}

function moneyLabel(price: number, currency: string): string {
  const cur = currency === 'RUB' || !currency ? '₽' : currency;
  return `${price.toLocaleString('ru-RU')} ${cur}`;
}

function trackFlightFromMenu(
  win: BrowserWindow,
  search: AviasalesSearch,
  offer: FlightOffer | null,
): void {
  const airline = offer?.airline ?? '';
  const flightNumber = offer?.flightNumber ?? '';
  const price = offer?.price ?? cheapestOffer(flightByTab.get(
    contextForWindow(win)?.tabs.snapshot().find((t) => t.isActive)?.id ?? '',
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

/** Подменю «Билеты Aviasales» в «⋯». null — это не страница поиска, пунктов быть не должно. */
export async function flightMenuTemplate(win: BrowserWindow): Promise<MenuItemConstructorOptions[] | null> {
  const ctx = contextForWindow(win);
  const active = ctx?.tabs.snapshot().find((t) => t.isActive && !t.isHub);
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

  const cheap = cheapestOffer(offers);
  const cheapId = tracking().idForFlight({
    origin: search.origin, destination: search.destination, depart: search.depart,
    returnDate: search.returnDate, adults: search.adults, cabin: search.cabin,
    airline: '', flightNumber: '',
  });
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
  } else {
    items.push({ label: t('Кэш Aviasales пока без цен'), enabled: false });
  }

  const menuOffers = offersForMenu(offers, 15);
  if (menuOffers.length > 0) {
    items.push({ type: 'separator' });
    for (const offer of menuOffers) {
      const time = offer.departureAt.slice(11, 16);
      const id = tracking().idForFlight({
        origin: search.origin, destination: search.destination, depart: search.depart,
        returnDate: search.returnDate, adults: search.adults, cabin: search.cabin,
        airline: offer.airline, flightNumber: offer.flightNumber,
      });
      const label = `${offer.airline} ${offer.flightNumber}${time ? `, ${time}` : ''} — ${moneyLabel(offer.price, offer.currency)}`;
      if (id !== null) {
        items.push({
          label: tf('Не отслеживать {flight}', { flight: `${offer.airline} ${offer.flightNumber}` }),
          click: () => {
            tracking().untrackFlight(id);
            broadcastToChrome(IPC.TRACKING_CHANGED);
          },
        });
      } else {
        items.push({
          label,
          click: () => trackFlightFromMenu(win, search, offer),
        });
      }
    }
  }
  items.push({ type: 'separator' });
  items.push({ label: t('Что я отслеживаю'), click: () => { ctx?.tabs.createSpecialTab('history', 'tracking'); } });
  return items;
}
