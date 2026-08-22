import { meshIsLight, adaptMeshToTheme } from '../../shared/chromeGround';
import { findMesh } from './gradients';

// Настройки минималистичной новой вкладки (в духе Bonjourr). Живут в localStorage: и сама вкладка
// (Hub → NewTab), и раздел настроек «Интерфейс» — в ОДНОМ рендерере (index.html, origin
// oblako-chrome://localhost), поэтому общий localStorage без IPC. Тот же приём персистентности
// визуального состояния, что уже используется в aiApps.tsx (обои/иконки домашнего экрана).
//
// Живое применение: saveNewTabSettings шлёт window-событие, на которое подписана открытая вкладка
// (subscribeNewTabSettings) — правки в настройках видны сразу, без перезагрузки.

export type BackgroundKind = 'preset' | 'color' | 'custom' | 'photo' | 'mesh';

export interface NewTabSettings {
  background: {
    kind: BackgroundKind;
    preset: string;   // id из WALLPAPER_PRESETS (см. NewTab.tsx) — для kind==='preset'
    meshId: string;   // id сетки (готовая или своя) — для kind==='mesh'
    color: string;    // hex — для kind==='color'
    dim: number;      // 0..0.8 — затемняющий оверлей поверх фона (читаемость текста)
    blur: number;     // 0..40 px — размытие фона
  };
  // face — вид виджета часов: циферблат со стрелками или цифры. hour24 осмыслен только у цифр,
  // seconds у циферблата означает наличие секундной стрелки.
  clock: { show: boolean; seconds: boolean; hour24: boolean; date: boolean; face: 'analog' | 'digital' };
  greeting: { show: boolean; name: string };
  search: { show: boolean };
  quickLinks: {
    show: boolean;
    count: number;                 // сколько показывать при source==='top'
    source: 'top' | 'custom';      // топ-сайты из истории ИЛИ свой набор ссылок
    custom: { url: string; title: string }[]; // свои ссылки (source==='custom')
  };
  weather: { show: boolean; city: string; units: 'c' | 'f' };
  // Курсы ЦБ РФ: codes — коды валют (USD/EUR/…), показываются как «сколько рублей за единицу».
  rates: { show: boolean; codes: string[] };
  // Крипта: тикеры (BTC/ETH/…), тоже в рублях за единицу. Отдельно от rates выше, а не одним
  // списком — у виджетов разные источники, разный ритм обновления и, главное, ПРОТИВОПОЛОЖНОЕ
  // значение цвета: рост курса доллара красят красным (рубль слабеет), рост биткоина — зелёным.
  crypto: { codes: string[] };
  // Оформление САЙДБАРА, а не новой вкладки. Живёт здесь потому, что здесь уже стоит вся
  // машинерия раздела «Интерфейс»: хранилище, живое применение событием и синхронизация между
  // окнами через 'storage'. Заводить ради одного флага второй такой механизм — лишняя сущность.
  // tinted — «цветной фон»: мягкий градиент по тону палитры плюс еле заметный шум на всё окно.
  // pattern — рисунок земли: 'blobs' (три мягких пятна снизу) или 'dawn' (растяжка сверху вниз).
  // amount — насыщенность в процентах.
  // ⚠️ Ключ по-прежнему называется `sidebar`, хотя красит теперь всё окно: переименование
  // означало бы потерю уже сделанного человеком выбора (настройки живут в localStorage без
  // миграций). Имя историческое, смысл — в комментарии.
  // ⚠️ ПОПРАВКИ ДЛЯ ТЁМНОЙ ТЕМЫ здесь НЕТ и быть не должно. Она не предпочтение, а ограничение:
  // тон палитры бывает ярче тёмной земли (у «Сепии» — в одиннадцать раз даже после притемнения
  // на 45%), и подмешивание такого тона делает землю СВЕТЛЕЕ островов, то есть выворачивает
  // иерархию. Поэтому притемнение считается по светимости, см. groundTint в styles/island.ts.
  // source: 'palette' — прежняя земля из тона палитры; 'mesh' — сетка из общего каталога.
  // ⚠️ Поля добавлены с дефолтом в merge: старый JSON без них продолжает работать.
  sidebar: { tinted: boolean; amount: number; source: 'palette' | 'mesh'; meshId: string };
}

export const DEFAULT_NEWTAB_SETTINGS: NewTabSettings = {
  // ⚠️ По умолчанию — чистый белый, а не градиент. Пёстрый фон при первом запуске спорит и с
  // приветственным экраном, и с самим содержимым вкладки; выбрать себе градиент человек может
  // в «Интерфейсе» одним кликом, а вот убрать навязанный — заметно дороже.
  background: { kind: 'color', preset: 'aurora', meshId: '', color: '#FFFFFF', dim: 0, blur: 0 },
  clock: { show: true, seconds: false, hour24: true, date: true, face: 'analog' },
  greeting: { show: true, name: '' },
  search: { show: true },
  quickLinks: { show: true, count: 8, source: 'top', custom: [] },
  weather: { show: false, city: '', units: 'c' },
  rates: { show: false, codes: ['USD', 'EUR'] },
  crypto: { codes: ['BTC', 'ETH'] },
  // ⚠️ По умолчанию выключено — по той же причине, что и белый фон новой вкладки выше:
  // навязанное оформление убирать дороже, чем включить желаемое.
  sidebar: { tinted: false, amount: 30, source: 'palette', meshId: '' },
};

// Пределы насыщенности цветного фона. ⚠️ Верхний — НЕ «сколько влезет»: выше него земля догоняет
// острова по светлоте, и адресная строка с кнопками перестают читаться (проверено замером на
// подборке вариантов). Нижний — там, где цвет ещё видно; ниже тумблер просто не имеет смысла.
export const TINT_AMOUNT_MIN = 6;
export const TINT_AMOUNT_MAX = 30;

// Валюты, предлагаемые в настройках. Не весь список ЦБ (там ~40 позиций) — те, что осмысленно
// держать перед глазами; коды совпадают с ключами rates из CurrencyRates.ts.
export const RATE_CHOICES: { code: string; label: string; symbol: string }[] = [
  { code: 'USD', label: 'Доллар',  symbol: '$' },
  { code: 'EUR', label: 'Евро',    symbol: '€' },
  { code: 'CNY', label: 'Юань',    symbol: '¥' },
  { code: 'GBP', label: 'Фунт',    symbol: '£' },
  { code: 'JPY', label: 'Иена',    symbol: '¥' },
  { code: 'KZT', label: 'Тенге',   symbol: '₸' },
  { code: 'TRY', label: 'Лира',    symbol: '₺' },
  { code: 'BYN', label: 'Бел. рубль', symbol: 'Br' },
  { code: 'AMD', label: 'Драм',    symbol: '֏' },
  { code: 'GEL', label: 'Лари',    symbol: '₾' },
];
export function rateSymbol(code: string): string {
  return RATE_CHOICES.find((c) => c.code === code)?.symbol ?? code;
}

// Криптоактивы, предлагаемые в настройках. Тикеры совпадают с ключами COIN_IDS в
// electron/CryptoRates.ts — id самого CoinGecko сюда не протекают, это деталь чужого API.
//
// ⚠️ В отличие от валют выше, поля symbol здесь НЕТ: у монеты либо нет своего знака в Unicode
// вовсе (SOL, XRP, TON), либо шрифт рисует его неузнаваемо («Ξ», «Ð»). Значок берётся
// картинкой — см. src/components/CryptoIcon.tsx и scripts/download-crypto-icons.mjs, тот же
// приём, что с флагами стран. Список кодов читает и сам скрипт загрузки значков.
export const CRYPTO_CHOICES: { code: string; label: string }[] = [
  { code: 'BTC',  label: 'Bitcoin'  },
  { code: 'ETH',  label: 'Ethereum' },
  { code: 'TON',  label: 'Toncoin'  },
  { code: 'SOL',  label: 'Solana'   },
  { code: 'XRP',  label: 'XRP'      },
  { code: 'DOGE', label: 'Dogecoin' },
  { code: 'USDT', label: 'Tether'   },
  { code: 'BNB',  label: 'BNB'      },
];

// Пресеты фона — те же градиент-токены, что у обоев домашнего экрана (tokens/apps.css). Общий
// список для вкладки (рендер) и раздела «Интерфейс» (пикер).
// light: фон светлый, поверх него текст должен быть ТЁМНЫМ (см. isLightBackground). Без этой
// пометки нежные градиенты выглядели бы пустыми: белые часы на бело-розовом фоне не видно.
export const WALLPAPER_PRESETS: { id: string; label: string; css: string; light?: boolean }[] = [
  { id: 'aurora',   label: 'Аврора',   css: 'var(--wallpaper-aurora)' },
  { id: 'ocean',    label: 'Океан',    css: 'var(--wallpaper-ocean)' },
  { id: 'sunset',   label: 'Закат',    css: 'var(--wallpaper-sunset)' },
  { id: 'lavender', label: 'Лаванда',  css: 'var(--wallpaper-lavender)' },
  { id: 'graphite', label: 'Графит',   css: 'var(--wallpaper-graphite)' },
  { id: 'indigo',   label: 'Индиго',   css: 'var(--wallpaper-indigo)' },
  { id: 'emerald',  label: 'Изумруд',  css: 'var(--wallpaper-emerald)' },
  { id: 'ember',    label: 'Пламя',    css: 'var(--wallpaper-ember)' },
  { id: 'plum',     label: 'Слива',    css: 'var(--wallpaper-plum)' },
  { id: 'midnight', label: 'Полночь',  css: 'var(--wallpaper-midnight)' },
  { id: 'peach',    label: 'Персик',   css: 'var(--wallpaper-peach)' },
  { id: 'mint',     label: 'Мята',     css: 'var(--wallpaper-mint)',    light: true },
  { id: 'sky',      label: 'Небо',     css: 'var(--wallpaper-sky)',     light: true },
  { id: 'blossom',  label: 'Цветение', css: 'var(--wallpaper-blossom)', light: true },
  { id: 'pearl',    label: 'Жемчуг',   css: 'var(--wallpaper-pearl)',   light: true },
];

// Светлый ли фон — от этого зависит цвет текста и плашек на вкладке.
// Для своего цвета считаем яркость по формуле восприятия (зелёный весит больше синего);
// фото и своя картинка всегда идут с затемнением, поэтому считаются тёмными.
export function isLightBackground(bg: NewTabSettings['background']): boolean {
  if (bg.kind === 'color') {
    const hex = bg.color.replace('#', '');
    if (hex.length !== 6) return false;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    // Порог 0.62, а не 0.5: тёмный текст читается и на средних тонах, а белый на них — уже нет.
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 && bg.dim < 0.2;
  }
  if (bg.kind === 'preset') {
    return !!WALLPAPER_PRESETS.find((p) => p.id === bg.preset)?.light && bg.dim < 0.2;
  }
  if (bg.kind === 'mesh') {
    const mesh = findMesh(bg.meshId);
    if (!mesh) return false;
    const dark = typeof document !== 'undefined'
      && document.documentElement.getAttribute('data-theme') === 'dark';
    return meshIsLight(adaptMeshToTheme(mesh, dark)) && bg.dim < 0.2;
  }
  return false;
}
export function presetCss(id: string): string {
  return WALLPAPER_PRESETS.find((p) => p.id === id)?.css ?? WALLPAPER_PRESETS[0]!.css;
}

const KEY = 'oblako-newtab-settings';
// Большое (сотни КБ) своё фото храним отдельным ключом, чтобы не таскать его в каждом
// load/save основного JSON (тот же приём, что WALLPAPER_CUSTOM_KEY в aiApps.tsx).
const CUSTOM_IMAGE_KEY = 'oblako-newtab-custom-image';
const EVENT = 'oblako-newtab-settings-changed';

// Слияние по секциям — терпимо к старому/частичному JSON (появились новые поля — берём дефолт).
function merge(raw: unknown): NewTabSettings {
  const d = DEFAULT_NEWTAB_SETTINGS;
  if (typeof raw !== 'object' || raw === null) return structuredClone(d);
  const r = raw as Record<string, Record<string, unknown>>;
  return {
    background: { ...d.background, ...(r.background ?? {}) },
    clock: { ...d.clock, ...(r.clock ?? {}) },
    greeting: { ...d.greeting, ...(r.greeting ?? {}) },
    search: { ...d.search, ...(r.search ?? {}) },
    quickLinks: { ...d.quickLinks, ...(r.quickLinks ?? {}) },
    weather: { ...d.weather, ...(r.weather ?? {}) },
    rates: { ...d.rates, ...(r.rates ?? {}) },
    crypto: { ...d.crypto, ...(r.crypto ?? {}) },
    sidebar: { ...d.sidebar, ...(r.sidebar ?? {}) },
  };
}

export function loadNewTabSettings(): NewTabSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? merge(JSON.parse(raw)) : structuredClone(DEFAULT_NEWTAB_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_NEWTAB_SETTINGS);
  }
}

export function saveNewTabSettings(s: NewTabSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* приватный режим/квота — настройка останется в памяти на эту сессию */ }
}

export function subscribeNewTabSettings(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  // storage-событие — на случай изменения из другой вкладки того же origin (напр. другой Hub).
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

// Своё фоновое фото (data-URL) — отдельно от основного JSON (см. CUSTOM_IMAGE_KEY).
export function getNewTabCustomImage(): string | null {
  try { return localStorage.getItem(CUSTOM_IMAGE_KEY); } catch { return null; }
}
export function setNewTabCustomImage(dataUrl: string | null): void {
  try {
    if (dataUrl) localStorage.setItem(CUSTOM_IMAGE_KEY, dataUrl);
    else localStorage.removeItem(CUSTOM_IMAGE_KEY);
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* см. saveNewTabSettings */ }
}

// ── Усадка своего фона ────────────────────────────────────────────────────────
// Фон клался в localStorage ровно таким, каким его выбрали. На живом профиле это оказалась
// фотография 6720×4480 — 3.5 МБ base64 и 115 МБ в РАСПАКОВАННОМ виде. Столько кэш картинок
// рендерера не держит, поэтому кадр декодировался заново почти на каждый показ новой вкладки:
// замерено 232 мс на декодирование (плюс blur, который тоже считается по полному разрешению).
// Отсюда и «странная задержка при клике на новую вкладку».
//
// 2560 по длинной стороне: фон лежит под затемнением и обычно под размытием, разглядеть в нём
// больше нечего, а цена — квадратичная по стороне. JPEG, а не PNG: прозрачность обоям не нужна.
const MAX_IMAGE_SIDE = 2560;
const IMAGE_QUALITY = 0.88;
// Порог одноразовой усадки: ~1 МБ base64. Ниже него возиться не с чем.
const SHRINK_TRIGGER = 1_000_000;

export async function shrinkBackgroundImage(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const probe = await createImageBitmap(blob);
  // Размеры снимаем ДО close(): у закрытого ImageBitmap они обнуляются.
  const { width, height } = probe;
  probe.close();
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  if (scale === 1) return dataUrl; // уже небольшая — перекодировать смысла нет

  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  // resizeWidth/Height у createImageBitmap — масштабирование самим декодером, без промежуточного
  // полноразмерного холста на 115 МБ.
  const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bmp.close(); return dataUrl; }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
}

// Одноразовая усадка уже сохранённого фона — чтобы чинить не только новые картинки, но и ту,
// что человек поставил раньше. Молча и в фоне: результат применится сам через EVENT.
let shrinkChecked = false;
export function ensureCustomImageShrunk(): void {
  if (shrinkChecked) return;
  shrinkChecked = true;
  const cur = getNewTabCustomImage();
  if (!cur || cur.length <= SHRINK_TRIGGER) return;
  void shrinkBackgroundImage(cur)
    .then((small) => { if (small.length < cur.length) setNewTabCustomImage(small); })
    .catch(() => { /* не вышло — остаёмся с исходной картинкой, это не повод ломать вкладку */ });
}
