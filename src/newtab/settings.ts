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
  clock: { show: boolean; seconds: boolean; hour24: boolean };
  greeting: { show: boolean; name: string };
  search: { show: boolean };
  quickLinks: {
    show: boolean;
    count: number;                 // сколько показывать при source==='top'
    source: 'top' | 'custom';      // топ-сайты из истории ИЛИ свой набор ссылок
    custom: { url: string; title: string }[]; // свои ссылки (source==='custom')
  };
  weather: { show: boolean; city: string; units: 'c' | 'f' };
}

export const DEFAULT_NEWTAB_SETTINGS: NewTabSettings = {
  background: { kind: 'preset', preset: 'aurora', color: '#1e1e24', dim: 0.28, blur: 0 },
  clock: { show: true, seconds: false, hour24: true },
  greeting: { show: true, name: '' },
  search: { show: true },
  quickLinks: { show: true, count: 8, source: 'top', custom: [] },
  weather: { show: false, city: '', units: 'c' },
};

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
