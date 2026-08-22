// Тело своего виджета — отдельно от JSON раскладки стола: srcdoc легко раздувается,
// как своё фото фона (см. CUSTOM_IMAGE_KEY в settings.ts).

import { sanitizeGenHtml, pickGenFacts, parseGenClockWrite, isGenMode, type GenFactId, type GenClock, type GenMode } from '../../shared/genWidget';

const PREFIX = 'oblako-desktop-gen-';
const STATE_PREFIX = 'oblako-desktop-gen-state-';
const PHOTO_PREFIX = 'oblako-desktop-gen-photo-';
const CLOCK_PREFIX = 'oblako-desktop-gen-clock-';
const INDEX_KEY = 'oblako-desktop-gen-index';
const EVENT = 'oblako-desktop-gen-changed';
const DRAFT_ID = 'gen-draft';
const PHOTO_SIDE = 720;

export interface GenRecord {
  html: string;
  facts: GenFactId[];
  /** Кто рисует плитку (см. pickGenMode). У записей, собранных до появления поля, его нет —
   *  тогда режим считается на месте теми же правилами, и «Пересобрать» проставит его навсегда. */
  mode?: GenMode;
  photo?: boolean;
  photoData?: string;
  phrase?: string;
  title?: string;
  size?: { w: number; h: number };
}

export interface GenLibraryItem {
  id: string;
  title: string;
  phrase: string;
  size: { w: number; h: number };
}

export function genStorageKey(id: string): string {
  return PREFIX + id;
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]): void {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(ids.slice(0, 40))); } catch { /* квота */ }
}

export function loadGenRecord(id: string): GenRecord | null {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(PREFIX + id);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    const html = typeof o.html === 'string' ? sanitizeGenHtml(o.html) : '';
    if (!html) return null;
    const size = o.size && typeof o.size === 'object'
      ? o.size as { w?: unknown; h?: unknown }
      : null;
    return {
      html,
      facts: pickGenFacts(o.facts),
      mode: isGenMode(o.mode) ? o.mode : undefined,
      photo: o.photo === true,
      photoData: loadPhoto(id) ?? (typeof o.photoData === 'string' && o.photoData.startsWith('data:image/') ? o.photoData : undefined),
      phrase: typeof o.phrase === 'string' ? o.phrase.slice(0, 200) : undefined,
      title: typeof o.title === 'string' ? o.title.slice(0, 28) : undefined,
      size: size && typeof size.w === 'number' && typeof size.h === 'number'
        ? { w: size.w, h: size.h }
        : undefined,
    };
  } catch {
    return null;
  }
}

export function saveGenRecord(id: string, rec: GenRecord): void {
  if (!id) return;
  try {
    const prev = loadGenRecord(id);
    localStorage.setItem(PREFIX + id, JSON.stringify({
      html: sanitizeGenHtml(rec.html),
      facts: pickGenFacts(rec.facts),
      mode: rec.mode ?? prev?.mode,
      photo: rec.photo === true,
      phrase: rec.phrase ?? prev?.phrase,
      title: rec.title ?? prev?.title,
      size: rec.size ?? prev?.size,
    }));
    if (id !== DRAFT_ID) {
      const idx = readIndex();
      if (!idx.includes(id)) writeIndex([id, ...idx]);
    }
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* квота — плитка останется пустой до следующего сохранения */ }
}

export function deleteGenRecord(id: string): void {
  if (!id) return;
  try {
    localStorage.removeItem(PREFIX + id);
    localStorage.removeItem(STATE_PREFIX + id);
    localStorage.removeItem(PHOTO_PREFIX + id);
    localStorage.removeItem(CLOCK_PREFIX + id);
    writeIndex(readIndex().filter((x) => x !== id));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* нет */ }
}

export function listGenLibrary(): GenLibraryItem[] {
  return readIndex().flatMap((id) => {
    const rec = loadGenRecord(id);
    if (!rec) return [];
    return [{
      id,
      title: rec.title || 'Свой виджет',
      phrase: rec.phrase || '',
      size: rec.size ?? { w: 2, h: 2 },
    }];
  });
}

export function loadGenState(id: string): string {
  if (!id) return '';
  try { return localStorage.getItem(STATE_PREFIX + id) ?? ''; } catch { return ''; }
}

export function saveGenState(id: string, value: string): void {
  if (!id) return;
  try { localStorage.setItem(STATE_PREFIX + id, value); } catch { /* квота */ }
  const parsed = parseGenClockWrite(value, Date.now());
  if (parsed === 'stop') clearGenClock(id);
  else if (parsed) saveGenClock(id, parsed);
}

export function loadGenClock(id: string): GenClock | null {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(CLOCK_PREFIX + id);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<GenClock>;
    if (typeof o.durationMs !== 'number') return null;
    return {
      endAt: typeof o.endAt === 'number' ? o.endAt : 0,
      durationMs: o.durationMs,
      leftMs: typeof o.leftMs === 'number' ? o.leftMs : o.durationMs,
      beeped: o.beeped === true,
    };
  } catch {
    return null;
  }
}

export function saveGenClock(id: string, clock: GenClock): void {
  if (!id) return;
  try {
    localStorage.setItem(CLOCK_PREFIX + id, JSON.stringify(clock));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* квота */ }
}

export function clearGenClock(id: string): void {
  if (!id) return;
  try {
    localStorage.removeItem(CLOCK_PREFIX + id);
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* нет */ }
}

export function listGenClockIds(): string[] {
  return readIndex().filter((id) => !!loadGenClock(id));
}

export function subscribeGenStore(cb: () => void): () => void {
  const handler = (): void => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

function loadPhoto(id: string): string | undefined {
  try {
    const raw = localStorage.getItem(PHOTO_PREFIX + id);
    return raw && raw.startsWith('data:image/') ? raw : undefined;
  } catch {
    return undefined;
  }
}

function bump(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Ужимает и кладёт фото отдельно от HTML — иначе localStorage молча отказывается. */
export async function storeGenPhoto(id: string, dataUrl: string): Promise<boolean> {
  if (!id || !dataUrl.startsWith('data:image/')) return false;
  try {
    const small = await shrinkWidgetPhoto(dataUrl);
    localStorage.setItem(PHOTO_PREFIX + id, small);
    bump();
    return true;
  } catch {
    try {
      const smaller = await shrinkWidgetPhoto(dataUrl, 480, 0.7);
      localStorage.setItem(PHOTO_PREFIX + id, smaller);
      bump();
      return true;
    } catch {
      return false;
    }
  }
}

async function shrinkWidgetPhoto(dataUrl: string, side = PHOTO_SIDE, quality = 0.82): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;
  const scale = Math.min(1, side / Math.max(width, height));
  if (scale === 1 && blob.size < 180_000) {
    bmp.close();
    return dataUrl;
  }
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const resized = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  bmp.close();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { resized.close(); return dataUrl; }
  ctx.drawImage(resized, 0, 0);
  resized.close();
  return canvas.toDataURL('image/jpeg', quality);
}
