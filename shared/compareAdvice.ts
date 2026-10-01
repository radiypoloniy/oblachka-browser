import type { CompareAdvice, CompareProduct, CompareReference } from './tabCompare';

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
function references(value: unknown, products: CompareProduct[]): CompareReference[] {
  if (!Array.isArray(value)) return [];
  const found: CompareReference[] = [];
  for (const item of value.slice(0, 12)) {
    const ref = object(item);
    if (!ref || !Number.isInteger(ref.product) || !Number.isInteger(ref.fact)) continue;
    const product = ref.product as number, fact = ref.fact as number;
    if (product >= 0 && products[product]?.facts.some(f => f.id === fact) && !found.some(r => r.product === product && r.fact === fact)) found.push({ product, fact });
  }
  return found;
}
// Нельзя принять совет без проверяемых исходных фактов. Текст — вывод модели,
// а раскрываемые цитаты и ссылки берутся из исходного снимка, никогда из её ответа.
export function parseCompareAdvice(value: unknown, products: CompareProduct[]): CompareAdvice {
  const output = object(value), advice = object(output?.advice);
  if (!advice) throw new Error('Модель не вернула разбор. Исходные данные доступны.');
  const refs = references(advice.refs, products), headline = text(advice.headline, 100), summary = text(advice.summary, 600);
  if (!headline || !summary || new Set(refs.map(r => r.product)).size < 2) throw new Error('В разборе нет оснований для сравнения. Исходные данные доступны.');
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\s.!?]+$/g, '').trim();
  const labels = new Set(products.flatMap(p => [p.title, ...p.facts.flatMap(f => [f.label, f.value])]).map(normalize));
  if (normalize(summary) === normalize(headline) || labels.has(normalize(summary))) throw new Error('Модель повторила данные вместо объяснения различий. Исходные данные доступны.');
  const scenarios = new Set<string>();
  const cards = (Array.isArray(advice.cards) ? advice.cards : []).slice(0, 3).flatMap(value => {
    const card = object(value); if (!card || !Number.isInteger(card.product)) return [];
    const product = card.product as number, refs = references(card.refs, products);
    const scenario = text(card.scenario, 60), reason = text(card.reason, 350), limitation = text(card.limitation, 220);
    if (!products[product] || !scenario || !reason || !limitation || !refs.some(r => r.product === product)
      || labels.has(normalize(reason)) || labels.has(normalize(limitation)) || normalize(reason) === normalize(limitation) || scenarios.has(normalize(scenario))) return [];
    scenarios.add(normalize(scenario));
    return [{ scenario, product, reason, limitation, refs }];
  });
  if (!cards.length) throw new Error('Советы не подтверждены найденными данными. Исходные данные доступны.');
  const caveats = (Array.isArray(advice.caveats) ? advice.caveats : []).slice(0, 2).map(v => text(v, 350)).filter(Boolean);
  return { headline, summary, refs, cards, caveats };
}
