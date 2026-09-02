// Общее для трёх облачных адаптеров: чтение потока, разбор чужого JSON, коды отказа.
//
// ⚠️ Вынесено не «чтобы не повторяться», а потому что это места, где ошибка тихая. Чтение потока
// одинаково у всех и одинаково ломается (см. shared/sseParse.ts). Обращение к чужому ответу как к
// известной структуре роняет адаптер на первом же нестандартном шлюзе — а «нестандартный шлюз» это
// половина списка совместимых. Коды отказа обязаны совпадать у всех трёх, иначе интерфейс не
// сможет одинаково реагировать на «ключ не принят» от OpenAI и от Anthropic.

import { createSseParser, type SseEvent } from '../../../shared/sseParse';
import { ProviderError } from '../Provider';

/** Прочитать SSE-ответ до конца, отдавая события по мере прихода. */
export async function readSse(
  res: Response,
  onEvent: (ev: SseEvent) => void,
  abort?: AbortSignal,
): Promise<void> {
  const body = res.body;
  if (!body) throw new ProviderError('provider', 'Поток пуст');

  const parser = createSseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) onEvent(ev);
    }
    for (const ev of parser.flush()) onEvent(ev);
  } catch (e) {
    if (abort?.aborted) throw new ProviderError('aborted', 'Прервано');
    throw new ProviderError('provider', e instanceof Error ? e.message : String(e));
  } finally {
    reader.releaseLock();
  }
}

/**
 * Разобрать данные события, не роняя весь ответ на одном битом куске.
 *
 * ⚠️ Возврат null вместо исключения — осознанно. Остальные куски пришли целыми, человек уже видит
 * их на экране, и уронить из-за одного повреждённого чанка весь ответ было бы хуже, чем потерять
 * этот чанк.
 */
export function parseEventJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Ответ об ошибке → код, различимый для интерфейса.
 *
 * ⚠️ Текст провайдера сохраняется в message, но напрямую человеку не показывается: там встречается
 * и простыня на десять строк, и — у некоторых шлюзов — эхо запроса вместе с ключом. Что показать,
 * решает верхний слой, у него для этого есть код.
 */
export async function httpError(res: Response, label: string): Promise<ProviderError> {
  const body = await res.text().catch(() => '');
  const short = body.slice(0, 300);
  if (res.status === 401 || res.status === 403) return new ProviderError('no-key', `«${label}» не принял ключ (${res.status})`);
  if (res.status === 429) return new ProviderError('rate-limited', `«${label}»: слишком много запросов (429)`);
  // 413 — запрос не влез целиком; 400 с упоминанием контекста или токенов — то же самое, но
  // словами провайдера. Различать их человеку незачем: действие одно — сократить запрос.
  if (res.status === 413 || (res.status === 400 && /context|token/i.test(short))) {
    return new ProviderError('context', `«${label}»: запрос не помещается в контекст модели`);
  }
  return new ProviderError('provider', `«${label}» ответил ${res.status}: ${short}`);
}

/** Сетевой отказ → код. Прерывание человеком отличается от «сеть недоступна». */
export function networkError(e: unknown, abort?: AbortSignal): ProviderError {
  if (abort?.aborted) return new ProviderError('aborted', 'Прервано');
  return new ProviderError('unreachable', e instanceof Error ? e.message : 'Сеть недоступна');
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// ── Безопасные доставалки из чужого JSON ───────────────────────────────────────
// Ответы провайдеров — не наша структура, и обращаться к ним как к известной нельзя: у шлюзов
// поля пропадают, переименовываются и приезжают null. `any` тут не нужен, хватает unknown.

export function pick(v: unknown, pathParts: readonly string[]): unknown {
  let cur = v;
  for (const p of pathParts) {
    if (Array.isArray(cur)) { cur = cur[Number(p)]; continue; }
    if (typeof cur !== 'object' || cur === null) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur ?? null;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function arr(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}
