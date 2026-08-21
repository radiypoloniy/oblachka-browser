// Тело своего виджета — отдельно от JSON раскладки стола: srcdoc легко раздувается,
// как своё фото фона (см. CUSTOM_IMAGE_KEY в settings.ts).

import { sanitizeGenHtml, pickGenFacts, type GenFactId } from '../../shared/genWidget';

const PREFIX = 'oblako-desktop-gen-';
const STATE_PREFIX = 'oblako-desktop-gen-state-';
const EVENT = 'oblako-desktop-gen-changed';

export interface GenRecord {
  html: string;
  facts: GenFactId[];
  photo?: boolean;
}

export function genStorageKey(id: string): string {
  return PREFIX + id;
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
    return { html, facts: pickGenFacts(o.facts), photo: o.photo === true };
  } catch {
    return null;
  }
}

export function saveGenRecord(id: string, rec: GenRecord): void {
  if (!id) return;
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify({
      html: sanitizeGenHtml(rec.html),
      facts: pickGenFacts(rec.facts),
      photo: rec.photo === true,
    }));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* квота — плитка останется пустой до следующего сохранения */ }
}

export function deleteGenRecord(id: string): void {
  if (!id) return;
  try {
    localStorage.removeItem(PREFIX + id);
    localStorage.removeItem(STATE_PREFIX + id);
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* нет */ }
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
