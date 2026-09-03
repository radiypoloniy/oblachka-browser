// Сколько израсходовано на подключениях: запросы, токены, деньги.
//
// ⚠️ ДЕНЬГИ ЗНАЕТ НЕ БРАУЗЕР, А ПРОВАЙДЕР. Цена зависит от модели, тарифа, скидок и кэша промпта, и
// прайс-лист внутри браузера устарел бы раньше следующей версии — ровно та же причина, по которой
// здесь нет каталога моделей. Поэтому стоимость мы НЕ СЧИТАЕМ, а только принимаем, если провайдер
// сам её вернул (так делает OpenRouter). Не вернул — честно говорим «провайдер не сообщает» и
// показываем токены, а не выдуманное число.
//
// ⚠️ `costKnown` отдельным полем, а не «cost > 0». Ноль бывает настоящим: бесплатная модель стоит
// ровно ноль, и в этом случае «$0» — правда, а «неизвестно» — вымысел.
//
// ⚠️ Модуль под проверкой (scripts/ai-usage-check.mjs) и потому без значимых импортов: она гоняется
// голым node, а он требует расширения в пути, которого tsc с эмитом не примет.

export interface AiUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  /** Доллары. Осмысленно только вместе с costKnown. */
  cost: number;
  /** Провайдер хоть раз сообщил стоимость. */
  costKnown: boolean;
  /** С какого момента считаем. */
  since: number;
}

export interface UsageDelta {
  promptTokens?: number;
  completionTokens?: number;
  /** Только если провайдер вернул её в ответе. undefined — не сообщил. */
  cost?: number;
}

export function emptyUsage(now: number): AiUsage {
  return { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, costKnown: false, since: now };
}

/**
 * Прибавить один ответ.
 *
 * ⚠️ Запрос считается ВСЕГДА, даже когда провайдер не вернул ни одного числа о токенах. Половина
 * совместимых шлюзов не отдаёт usage вовсе, и «0 запросов» на живом подключении читалось бы как
 * поломка учёта, а не как молчание провайдера.
 */
export function addUsage(prev: AiUsage | undefined, delta: UsageDelta, now: number): AiUsage {
  const base = prev ?? emptyUsage(now);
  const gotCost = typeof delta.cost === 'number' && Number.isFinite(delta.cost);
  return {
    requests: base.requests + 1,
    promptTokens: base.promptTokens + nonNegative(delta.promptTokens),
    completionTokens: base.completionTokens + nonNegative(delta.completionTokens),
    cost: base.cost + (gotCost ? Math.max(0, delta.cost as number) : 0),
    costKnown: base.costKnown || gotCost,
    since: base.since,
  };
}

function nonNegative(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/** Итог по всем подключениям. `since` — самое раннее: считаем с того дня, когда начали. */
export function sumUsage(list: readonly AiUsage[]): AiUsage {
  if (list.length === 0) return emptyUsage(0);
  return list.reduce((a, b) => ({
    requests: a.requests + b.requests,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    cost: a.cost + b.cost,
    costKnown: a.costKnown || b.costKnown,
    since: Math.min(a.since, b.since),
  }));
}

export function totalTokens(u: AiUsage): number {
  return u.promptTokens + u.completionTokens;
}

/**
 * Токены человеку.
 *
 * ⚠️ Порог сокращения — десять тысяч, а не тысяча. «1,2 тыс.» вместо «1240» отнимает точность
 * ровно там, где она ещё нужна: на первых сотнях запросов человек сверяет число со счётом у
 * провайдера. Дальше точность всё равно теряет смысл — счёт идёт на миллионы.
 */
export function formatTokens(n: number): string {
  if (n < 10_000) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (n < 1_000_000) return `${trim(n / 1000)} тыс.`;
  return `${trim(n / 1_000_000)} млн`;
}

function trim(v: number): string {
  return v.toFixed(1).replace(/\.0$/, '').replace('.', ',');
}

/**
 * Деньги человеку.
 *
 * ⚠️ Четыре знака после запятой на мелких суммах, а не два. Один ответ у большинства моделей стоит
 * доли цента, и «$0,00» на экране означало бы «бесплатно» — то есть враньё в самом чувствительном
 * месте.
 */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4).replace('.', ',')}`;
  if (usd < 1) return `$${usd.toFixed(3).replace('.', ',')}`;
  return `$${usd.toFixed(2).replace('.', ',')}`;
}
