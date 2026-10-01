import type { JsonSchema } from './aiSchema';

export const INSIGHTS = {
  config: 'page-insights:config', set: 'page-insights:set', changed: 'page-insights:changed',
  watch: 'page-insights:watch', state: 'page-insights:state', run: 'page-insights:run', source: 'page-insights:source',
} as const;
export const INSIGHTS_MAX = 5;
export const INSIGHTS_COOLDOWN = 10 * 60_000;
export interface InsightsConfig {
  enabled: boolean;
  collapsed: boolean;
  connectionId: string | null;
  allowRemote: boolean;
  dailyLimit: number;
}
export const DEFAULT_INSIGHTS: InsightsConfig = {
  enabled: true, collapsed: false, connectionId: null, allowRemote: false, dailyLimit: 12,
};
export interface PageInsight { title: string; text: string; kind: string; quote: string; }
export type InsightsPhase = 'off' | 'setup' | 'sleep' | 'idle' | 'reading' | 'ready' | 'stale' | 'limit' | 'error';
export interface InsightsState {
  tabId: string | null;
  phase: InsightsPhase;
  cards: PageInsight[];
  via: { label: string; local: boolean } | null;
  note: string;
}
export interface InsightsApi {
  pageInsightsConfig(): Promise<InsightsConfig>;
  setPageInsightsConfig(patch: Partial<InsightsConfig>): Promise<InsightsConfig>;
  onPageInsightsConfig(cb: (config: InsightsConfig) => void): () => void;
}
export function normalizeInsights(value: unknown, base = DEFAULT_INSIGHTS): InsightsConfig {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : base.enabled,
    collapsed: typeof v.collapsed === 'boolean' ? v.collapsed : base.collapsed,
    connectionId: v.connectionId === null || typeof v.connectionId === 'string' ? v.connectionId : base.connectionId,
    allowRemote: typeof v.allowRemote === 'boolean' ? v.allowRemote : base.allowRemote,
    dailyLimit: typeof v.dailyLimit === 'number' && Number.isFinite(v.dailyLimit)
      ? Math.max(1, Math.min(100, Math.floor(v.dailyLimit))) : base.dailyLimit,
  };
}
export interface InsightFragment { id: number; text: string; }
export function selectInsightFragments(text: string): InsightFragment[] {
  // Длинные абзацы делим, иначе вся статья без переносов превращалась в один обрезок.
  const blocks = [...new Set(text.split(/\n+/).flatMap(s => {
    const clean = s.replace(/\s+/g, ' ').trim();
    return clean.match(/.{1,900}(?:\s|$)|.{1,900}/g)?.map(chunk => chunk.trim()) ?? [];
  }).filter(s => s.length >= 45))];
  const ranked = blocks.map((text, i) => ({ text, i, score: (i < 2 ? 4 : 0) +
    (/\d/.test(text) ? 2 : 0) + (/важн|исключ|не вход|отмен|срок|огранич|however|except|must|deadline|limit/i.test(text) ? 3 : 0) }));
  // Половина бюджета — равномерный обзор, половина — условия и численные факты.
  const chosen: typeof ranked = [];
  let size = 0;
  const add = (block: typeof ranked[number]) => {
    if (chosen.includes(block) || size + block.text.length > 7600 || chosen.length >= 20) return;
    chosen.push(block); size += block.text.length;
  };
  for (let i = 0; i < Math.min(4, ranked.length); i++) add(ranked[Math.round(i * (ranked.length - 1) / 3)]);
  for (const block of [...ranked].sort((a, b) => b.score - a.score || a.i - b.i)) add(block);
  return chosen.sort((a, b) => a.i - b.i).map((block, i) => ({ id: i + 1, text: block.text }));
}
export const INSIGHTS_SCHEMA: JsonSchema = {
  type: 'object', properties: { cards: { type: 'array', minItems: 1, maxItems: INSIGHTS_MAX, items: {
    type: 'object', properties: {
      title: { type: 'string', minLength: 1 }, text: { type: 'string', minLength: 1 }, kind: { type: 'string', minLength: 1 },
      source: { type: 'integer', minimum: 1 },
    }, required: ['title', 'text', 'kind', 'source'], additionalProperties: false,
  } } }, required: ['cards'], additionalProperties: false,
};
export function validateInsights(raw: unknown, fragments: InsightFragment[]): PageInsight[] {
  if (!raw || typeof raw !== 'object' || !('cards' in raw) || !Array.isArray(raw.cards)) throw new Error('Некорректный ответ модели');
  if (!raw.cards.length) throw new Error('Модель вернула пустой обзор');
  const cards: PageInsight[] = [];
  const seen = new Set<string>();
  for (const item of raw.cards) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if (typeof c.title !== 'string' || typeof c.text !== 'string' || typeof c.kind !== 'string') continue;
    const title = c.title.trim().slice(0, 90), text = c.text.trim().slice(0, 250);
    const source = fragments.find(f => f.id === c.source);
    if (!title || !text || !source) continue;
    // Источник выбирает модель, точную цитату берёт браузер: перефразирование не теряет карточку.
    const quote = source.text.slice(0, 200).trim();
    const key = title.toLocaleLowerCase();
    if (seen.has(key) || cards.some(card => card.quote === quote)) continue;
    seen.add(key); cards.push({ title, text, quote, kind: c.kind.trim().slice(0, 28) || 'Главное' });
    if (cards.length === INSIGHTS_MAX) break;
  }
  if (raw.cards.length && !cards.length) throw new Error('Все карточки ссылаются на неверные источники');
  return cards;
}
