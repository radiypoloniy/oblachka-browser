import type { ContentBounds } from './core';

// ── Автозаполнение форм (electron/AutofillManager.ts) ──────────────────────────
// Адрес — все поля PII, шифруются одним блобом at rest (наружу отдаём в полном виде: renderer —
// доверенный chrome-UI). Набор полей — прагматичный, покрывает типовые формы доставки/контактов.
export interface AddressProfile {
  id: number;
  fullName: string;
  organization: string;
  email: string;
  phone: string;
  street: string;      // улица + дом, одной строкой
  city: string;
  region: string;      // область/штат/край
  postalCode: string;
  country: string;
  createdAt: number;
  updatedAt: number;
}
export type AddressInput = Omit<AddressProfile, 'id' | 'createdAt' | 'updatedAt'>;
export interface AddressUpdate extends AddressInput { id: number; }

// Карта: CVC НЕ хранится (PCI, как во всех браузерах). Полный номер шифруется и наружу массово не
// уходит — только маска last4 + бренд; полный номер — через revealCardNumber (под Windows Hello).
export interface CardMeta {
  id: number;
  cardholder: string;
  brand: string;       // 'Visa' | 'Mastercard' | 'Amex' | 'Mir' | … | '' — вычисляется по номеру
  last4: string;
  expMonth: number;    // 1..12
  expYear: number;     // полный год, напр. 2029
  createdAt: number;
  updatedAt: number;
}
export interface CardInput {
  cardholder: string;
  number: string;      // полный номер (цифры/пробелы) — только на вход, наружу не возвращается
  expMonth: number;
  expYear: number;
}
export interface CardUpdate {
  id: number;
  cardholder?: string;
  number?: string;     // undefined — номер не менять
  expMonth?: number;
  expYear?: number;
}

// Категории полей формы для автозаполнения — общий словарь между детектором (preload-content) и
// значениями, которые main шлёт на подстановку. Адресные + карточные (карты — заход 3).
export type AutofillFieldKey =
  | 'fullName' | 'givenName' | 'familyName' | 'email' | 'phone'
  | 'street' | 'addressLine2' | 'city' | 'region' | 'postalCode' | 'country' | 'organization'
  | 'ccName' | 'ccNumber' | 'ccExpMonth' | 'ccExpYear' | 'ccExp';

// Плоская карта «категория поля → значение» для подстановки (AUTOFILL_FILL_FIELDS). preload-content
// заполняет те поля, для которых нашёл категорию на странице; лишние ключи игнорируются.
export type AutofillFillFields = Partial<Record<AutofillFieldKey, string>>;

// Погода для виджета новой вкладки (electron/WeatherService.ts, Open-Meteo). tempC — цельсии,
// weatherCode — WMO. Конвертация в °F и иконка/подпись — на стороне рендера.
export interface NextHolidayInfo {
  ok: boolean;
  name?: string;
  date?: string;
  daysUntil?: number;
  error?: string;
}

export interface WeatherInfo {
  /** Ощущается как — Apple показывает её первой строкой под температурой. */
  feelsC?: number
  /** День или ночь по данным станции: от этого зависит цвет плитки виджета. */
  isDay?: boolean
  maxC?: number
  minC?: number
  /** Ближайшие часы, начиная с текущего. */
  hours?: { hour: number; tempC: number; code: number }[]
  ok: boolean;
  city?: string;
  tempC?: number;
  weatherCode?: number;
  windKmh?: number;
  /** Восход и закат «ЧЧ:ММ» — приходят тем же запросом прогноза, отдельного вызова не требуют. */
  sunrise?: string;
  sunset?: string;
  /** Европейский индекс качества воздуха. Тот же Open-Meteo — нового получателя данных нет. */
  aqi?: number;
  error?: string;
}

// Курсы валют для виджета новой вкладки (electron/CurrencyRates.ts, суточные курсы ЦБ РФ).
// rates — «сколько рублей стоит ОДНА единица валюты» (RUB=1, номинал уже приведён к единице).
// Тот же тип, что отдаёт конвертер AI-панели, но здесь он в общем контракте: виджет вкладки
// живёт в боевом рендерере и ходит типизированным каналом, а не ad-hoc `ai-panel:*`.
export interface CurrencyRatesInfo {
  /** Курс предыдущего рабочего дня — для стрелки «вырос/упал» в виджете. */
  prev?: Record<string, number>;
  ok: boolean;
  date?: string;
  rates?: Record<string, number>;
  error?: string;
}

export interface CryptoRatesInfo {
  ok: boolean;
  /** «Сколько RUB стоит единица актива», ключ — тикер (BTC, ETH…). */
  rates?: Record<string, number>;
  /** Изменение за 24 часа в процентах — для стрелки в виджете. */
  change24h?: Record<string, number>;
  error?: string;
}

// ── Тема оформления ─────────────────────────────────────────────────────────
// 'system' — следовать ОС. Считает это main через nativeTheme.shouldUseDarkColors и присылает
// готовый systemDark: рендерер мог бы спросить matchMedia сам, но тогда у каждого окна и каждого
// поповера была бы своя точка правды, а расходиться им нельзя.
export type ThemeMode = 'light' | 'dark' | 'system';

// Нейтральные палитры — это ЗЕМЛЯ интерфейса (фон, поверхности, разделители, текст), а не
// перекраска акцента: цветовой закон не меняется, акцент по-прежнему один, зелёный по-прежнему
// значит «локально/VPN жив». У каждой палитры есть и светлый, и тёмный вариант — палитра
// отвечает на вопрос «какой оттенок нейтрали», тема на вопрос «светло или темно».
export const THEME_PALETTE_IDS = ['charcoal', 'graphite', 'slate', 'paper', 'mint', 'sky'] as const;
export type ThemePaletteId = typeof THEME_PALETTE_IDS[number];

export interface ThemePrefs {
  mode: ThemeMode;
  palette: ThemePaletteId;
  /** Что сейчас говорит ОС. Осмысленно только при mode==='system', но приходит всегда. */
  systemDark: boolean;
}

/** Темно ли сейчас на самом деле. Общая для main, чрома и настроек — три копии одного тернарника
 *  разошлись бы ровно в тот день, когда к режимам добавится четвёртый. */
export function isDarkTheme(p: ThemePrefs): boolean {
  return p.mode === 'system' ? p.systemDark : p.mode === 'dark';
}

// Тип API, который preload пробрасывает в window.oblako
// Роль окна. Полное окно ровно одно: оно владеет сессией (деревом вкладок в session.json) и теми
// службами, что существуют в приложении в одном экземпляре. Лёгкие окна — вкладки, омнибокс,
// поиск по странице, пароли/автозаполнение.
export type WindowRole = 'main' | 'light';

// Чем закончилась просьба «сделай нас браузером по умолчанию»: 'already' — уже мы,
// 'settings-opened' — открыт системный выбор и слово за человеком, 'unsupported' — просить
// негде (не Windows или неупакованная сборка). См. electron/DefaultBrowser.ts.
export type DefaultBrowserRequest = 'already' | 'settings-opened' | 'unsupported';

// Куда попадёт вкладка, если отпустить её сейчас: край страницы — разделить экран, середина —
// новое окно, 'adopt' — курсор над ДРУГИМ окном Oblako, вкладка переедет туда, null — обычное
// переупорядочивание в сайдбаре. Считает MAIN (см. electron/DropZoneManager.ts): чром теряет
// указатель, как только тот уходит на страницу.
// 'replace' появляется только когда сплит уже на экране: делить пополам поделённое нечего, и
// единственный осмысленный исход над панелью — занять её место (выселенная возвращается в список).
export type TabDropZone = 'split' | 'window' | 'adopt' | 'replace';

// Имя и значок того, что несут в руке. Одна форма на оба жеста (вкладка из сайдбара и половина
// сплита за шапку) — карточку они рисуют одну и ту же, src/components/SplitDragCard.tsx.
export interface DragCard {
  title: string;
  favicon: string | null;
}

// Результат отпускания. windowId нужен только для 'adopt' — какое именно окно принимает вкладку;
// одной зоны мало, окон может быть сколько угодно.
export interface TabDropResult {
  zone: TabDropZone | null;
  windowId?: number;
  // Только для 'split': за какой край тянули, ту половину вкладка и займёт. Без этого сплит
  // всегда открывался справа, куда бы человек ни вёл, — жест обещал одно, а делал другое.
  side?: 'left' | 'right';
  // Только для 'replace': какую панель занять. Резолвит main, пока пара под курсором ещё та
  // же самая — сайдбару к моменту разбора она могла бы уже не принадлежать.
  replaceId?: string;
}

// Подсветка панели-ЦЕЛИ, пока половину сплита тащат за её шапку (жест живёт в рабочей области,
// см. src/App.tsx). Рисует её вью-оверлей поверх страницы (electron/DropZoneManager.ts): чром над
// областью контента не виден в принципе — нативная вью страницы лежит поверх React-слоя.
//
// ⚠️ Зону тут, в отличие от TabDropZone, считает RENDERER, а не main. Разница не в прихоти:
// перетаскивание за шапку держит указатель через setPointerCapture, и pointermove приходит в чром
// даже над нативными вьюхами (см. разделитель сплита в App.tsx) — опрашивать курсор в main незачем.
// Наружу, в main, уходит только то, что чром нарисовать физически не может: подсветка.
// Все прямоугольники и координаты этого жеста — в координатах ОКНА: на время перетаскивания
// оверлей растянут на всё окно (см. DropZoneManager.showOverlayIn), потому что карточку в руке
// носят и над сайдбаром, и над тулбаром. Пересчитывать поэтому нечего ни на той стороне, ни на этой.
export interface SplitSwapHint {
  // Вкладка, которую несут. Нужна не только оверлею: по ней main выводит несомую панель из
  // раскладки и показывает исход второй панелью — см. TabManager.applyPanelDragLayout.
  tabId: string;
  target: ContentBounds;  // панель-цель: мягкая заливка акцентом и волосяной кант
  // Имя и значок несомой страницы — бланк карточки, поверх которого потом проявляется снимок
  // (он приходит позже, см. SPLIT_CAPTURE_PANE).
  title: string;
  favicon: string | null;
  // Что случится, если отпустить сейчас: 'swap' — половины поменяются местами, 'sidebar' — сплит
  // разорвётся, null — ничего. Оверлей по нему и подсвечивает цель, и подписывает карточку.
  zone: 'swap' | 'sidebar' | null;
}
