import type { CompareSnapshot, CompareArchiveEntry } from './compareArchive';
import type { CompareProduct } from './tabCompare';
import { parseCompareAdvice } from './compareAdvice';

const object = (x: unknown): Record<string, unknown> | null => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null;
const text = (x: unknown, max = 1000): x is string => typeof x === 'string' && x.length <= max;
const time = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 8.64e15;
const url = (x: unknown): x is string => { if (!text(x, 32768)) return false; try { return ['http:', 'https:'].includes(new URL(x).protocol); } catch { return false; } };
function invalid(): never { throw new Error('Сохранённое сравнение повреждено или имеет неподдерживаемый формат'); }
export function parseCompareArchiveEntry(value: unknown): CompareArchiveEntry {
  const e = object(value);
  if (!e || !text(e.id, 100) || !e.id || !time(e.createdAt) || !time(e.updatedAt) || !text(e.title, 200) || !text(e.summary, 1000)
    || !(e.via === null || text(e.via, 200)) || typeof e.hasAdvice !== 'boolean' || !Array.isArray(e.products) || e.products.length < 2 || e.products.length > 5) return invalid();
  const products = e.products.map(p => { const v = object(p); if (!v || !text(v.title, 180) || !url(v.url)) return invalid(); return { title: v.title, url: v.url }; });
  return { id: e.id, createdAt: e.createdAt, updatedAt: e.updatedAt, title: e.title, summary: e.summary, products, via: e.via, hasAdvice: e.hasAdvice };
}
export function parseCompareSnapshot(value: unknown): CompareSnapshot {
  const s = object(value);
  if (!s || s.version !== 1 || !text(s.id, 100) || !s.id || !time(s.createdAt) || !time(s.updatedAt) || !text(s.connectionId, 200)
    || !(s.via === null || text(s.via, 200)) || !Array.isArray(s.products) || s.products.length < 2 || s.products.length > 5 || !Array.isArray(s.rows) || s.rows.length > 60) return invalid();
  const products: CompareProduct[] = s.products.map(p => {
    const v = object(p);
    if (!v || !text(v.tabId, 100) || !url(v.url) || !text(v.title, 180) || !text(v.category, 160) || !time(v.capturedAt)
      || !text(v.note) || !['structured', 'page'].includes(String(v.method)) || !Array.isArray(v.facts) || v.facts.length > 36 || !v.facts.length) return invalid();
    const facts = v.facts.map(f => {
      const fact = object(f);
      if (!fact || !Number.isInteger(fact.id) || (fact.id as number) < 1 || !text(fact.label, 80) || !text(fact.value, 220) || !text(fact.quote, 250)) return invalid();
      return { id: fact.id as number, label: fact.label, value: fact.value, quote: fact.quote };
    });
    if (new Set(facts.map(f => f.id)).size !== facts.length) return invalid();
    return { tabId: v.tabId, url: v.url, title: v.title, category: v.category, capturedAt: v.capturedAt, method: v.method as 'structured' | 'page', note: v.note, facts };
  });
  const rows = s.rows.map(r => {
    const row = object(r); if (!row || !text(row.label, 80) || !Array.isArray(row.cells) || row.cells.length !== products.length) return invalid();
    const cells = row.cells.map((cell, i) => {
      if (cell === null) return null;
      const fact = object(cell), original = products[i].facts.find(f => f.id === fact?.id);
      if (!original || original.value !== fact?.value) return invalid();
      return original;
    });
    return { label: row.label, cells };
  });
  const advice = s.advice === null ? null : parseCompareAdvice({ advice: s.advice }, products);
  return { version: 1, id: s.id, createdAt: s.createdAt, updatedAt: s.updatedAt, connectionId: s.connectionId, via: s.via, products, rows, advice };
}
