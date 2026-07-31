// Настройки минималистичной новой вкладки (в духе Bonjourr). Живут в localStorage: и сама вкладка
// (Hub → NewTab), и раздел настроек «Интерфейс» — в ОДНОМ рендерере (index.html, origin
// oblako-chrome://localhost), поэтому общий localStorage без IPC. Тот же приём персистентности
// визуального состояния, что уже используется в aiApps.tsx (обои/иконки домашнего экрана).
//
// Живое применение: saveNewTabSettings шлёт window-событие, на которое подписана открытая вкладка
// (subscribeNewTabSettings) — правки в настройках видны сразу, без перезагрузки.

export type BackgroundKind = 'preset' | 'color' | 'custom' | 'photo';

export interface NewTabSettings {
  background: {
    kind: BackgroundKind;
    preset: string;   // id из WALLPAPER_PRESETS (см. NewTab.tsx) — для kind==='preset'
    color: string;    // hex — для kind==='color'
    dim: number;      // 0..0.8 — затемняющий оверлей поверх фона (читаемость текста)
    blur: number;     // 0..40 px — размытие фона
  };
  clock: { show: boolean; seconds: boolean; hour24: boolean; date: boolean };
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
}

export const DEFAULT_NEWTAB_SETTINGS: NewTabSettings = {
  background: { kind: 'preset', preset: 'aurora', color: '#1e1e24', dim: 0.28, blur: 0 },
  clock: { show: true, seconds: false, hour24: true, date: true },
  greeting: { show: true, name: '' },
  search: { show: true },
  quickLinks: { show: true, count: 8, source: 'top', custom: [] },
  weather: { show: false, city: '', units: 'c' },
  rates: { show: false, codes: ['USD', 'EUR'] },
};

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

// Пресеты фона — те же градиент-токены, что у обоев домашнего экрана (tokens/apps.css). Общий
// список для вкладки (рендер) и раздела «Интерфейс» (пикер).
export const WALLPAPER_PRESETS: { id: string; label: string; css: string }[] = [
  { id: 'aurora',   label: 'Аврора',  css: 'var(--wallpaper-aurora)' },
  { id: 'ocean',    label: 'Океан',   css: 'var(--wallpaper-ocean)' },
  { id: 'sunset',   label: 'Закат',   css: 'var(--wallpaper-sunset)' },
  { id: 'lavender', label: 'Лаванда', css: 'var(--wallpaper-lavender)' },
  { id: 'graphite', label: 'Графит',  css: 'var(--wallpaper-graphite)' },
];
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
