// Тело своего виджета — отдельно от JSON раскладки стола: srcdoc легко раздувается,
// как своё фото фона (см. CUSTOM_IMAGE_KEY в settings.ts).

import { sanitizeGenHtml, pickGenFacts, type GenFactId } from '../../shared/genWidget';

const PREFIX = 'oblako-desktop-gen-';
const STATE_PREFIX = 'oblako-desktop-gen-state-';
const INDEX_KEY = 'oblako-desktop-gen-index';
const EVENT = 'oblako-desktop-gen-changed';
const DRAFT_ID = 'gen-draft';

export interface GenRecord {
  html: string;
  facts: GenFactId[];
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
      photo: o.photo === true,
      photoData: typeof o.photoData === 'string' && o.photoData.startsWith('data:image/') ? o.photoData : undefined,
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
      photo: rec.photo === true,
      photoData: rec.photoData ?? prev?.photoData,
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
