import type { CompareAdvice, CompareProduct, CompareRow } from './tabCompare';

export interface CompareSnapshot {
  version: 1; id: string; createdAt: number; updatedAt: number;
  products: CompareProduct[]; rows: CompareRow[]; advice: CompareAdvice | null;
  via: string | null; connectionId: string;
}
export interface CompareArchiveEntry {
  id: string; createdAt: number; updatedAt: number; title: string; summary: string;
  products: { title: string; url: string }[]; via: string | null; hasAdvice: boolean;
}
export interface CompareArchivePage { entries: CompareArchiveEntry[]; total: number; hasMore: boolean }

export function compareArchiveEntry(snapshot: CompareSnapshot): CompareArchiveEntry {
  return { id: snapshot.id, createdAt: snapshot.createdAt, updatedAt: snapshot.updatedAt,
    title: snapshot.advice?.headline ?? snapshot.products.map(p => p.title).join(' · ').slice(0, 160),
    summary: snapshot.advice?.summary ?? 'Исходные характеристики сохранены. Советы можно создать после подключения модели.',
    products: snapshot.products.map(p => ({ title: p.title, url: p.url })), via: snapshot.via, hasAdvice: !!snapshot.advice };
}
